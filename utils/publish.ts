import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { data, tools, workspace } from "@wonderlandengine/editor-api";
import {
  uploadPage,
  type UploadedPage,
  type UploadParams,
} from "./cloud-client.js";
import { installExtraCaCertificates } from "./tls.js";

const API_URL = "https://api.wonderlandengine.com";
const COMMANDER_URL = "https://cloud.wonderland.dev";
const POLL_INTERVAL_MS = 5000;
const CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

/** Page names accepted by Wonderland Cloud (same rule as @wonderlandcloud/cli) */
const PAGE_NAME_REGEX = /^[a-z](([a-z]|\d)-?([a-z]|\d)?){0,20}[a-z]$/;

export type AccessType = "public" | "unlisted";

/**
 * Persisted publish state, shared with the editor's built-in publish plugin.
 * Both write `deployment.json` in the project root in this format, so that
 * either of them updates the same page instead of creating a second one.
 */
interface DeploymentConfig {
  projectLocation: string;
  projectName: string;
  projectDomain: string;
  accessType: AccessType;
  withThreads: boolean;
}

export type PublishStatus =
  | "idle"
  | "packaging"
  | "waiting_for_confirmation"
  | "uploading"
  | "done"
  | "failed";

export interface PublishState {
  status: PublishStatus;
  pageName?: string;
  url?: string;
  access?: AccessType;
  /** URL the user has to open to confirm, while waiting for confirmation */
  confirmUrl?: string;
  /** Whether this run creates a new page or updates the existing one */
  operation?: "create" | "update";
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

let state: PublishState = { status: "idle" };

const configPath = () => join(workspace.root, "deployment.json");

function readConfig(): DeploymentConfig | null {
  const p = configPath();
  if (!existsSync(p)) return null;
  const text = readFileSync(p, { encoding: "utf8" });
  return text ? (JSON.parse(text) as DeploymentConfig) : null;
}

function writeConfig(page: any, withThreads: boolean) {
  const config: DeploymentConfig = {
    projectLocation: relative(workspace.root, workspace.deployPath),
    projectName: page.projectName,
    projectDomain: page.projectDomain,
    accessType: page.accessType,
    withThreads,
  };
  writeFileSync(configPath(), JSON.stringify(config));
}

function slugify(name: string): string | null {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+$/, "")
    .slice(0, 22)
    .replace(/[^a-z]+$/, "");
  return PAGE_NAME_REGEX.test(slug) ? slug : null;
}

function editorUserAgent() {
  const v = (data.settings as any)?.project?.version ?? [0, 0, 0, 0];
  return `WonderlandEditor/${v[0]}.${v[1]}.${v[2]}${v[3] ? "-rc" + v[3] : ""}`;
}

const isBusy = () =>
  state.status === "packaging" ||
  state.status === "waiting_for_confirmation" ||
  state.status === "uploading";

export function getPublishState(): PublishState {
  const config = readConfig();
  return {
    ...state,
    pageName: state.pageName ?? config?.projectName,
    url:
      state.url ??
      (config?.projectDomain ? `https://${config.projectDomain}` : undefined),
  };
}

/**
 * Start publishing the project to Wonderland Cloud Pages.
 *
 * Returns immediately; the user confirms in the browser, then the upload runs
 * in the background. Poll with {@link getPublishState}.
 *
 * Only one publish runs at a time. A project that was published before
 * (`deployment.json` exists) is always updated, never published to a second
 * page.
 */
export function startPublish(options: {
  pageName?: string;
  access?: AccessType;
}): PublishState {
  if (isBusy()) return getPublishState();

  const config = readConfig();
  let pageName: string;
  if (config?.projectName) {
    /* The server may have appended a suffix to the requested name */
    const sameName =
      !options.pageName ||
      options.pageName === config.projectName ||
      config.projectName.startsWith(options.pageName + "-");
    if (!sameName) {
      throw new Error(
        `This project is already published as "${config.projectName}" ` +
          `(see deployment.json). Publishing updates that page. To publish ` +
          `to a different page, the user has to remove deployment.json first.`
      );
    }
    pageName = config.projectName;
  } else {
    const candidate =
      options.pageName ?? slugify((data.settings as any)?.project?.name ?? "");
    if (!candidate || !PAGE_NAME_REGEX.test(candidate)) {
      throw new Error(
        `Invalid page name "${candidate ?? ""}". Use 2-22 lowercase letters, ` +
          `digits and single hyphens, starting and ending with a letter.`
      );
    }
    pageName = candidate;
  }

  /* A first publish needs an explicit choice: making a page public is the
   * user's decision, never a silent default. Updates keep the access stored
   * in deployment.json unless a new one is given. */
  if (!config && !options.access) {
    throw new Error(
      "access is required for a first publish. Ask the user whether the " +
        'page should be unlisted or public, then pass access.'
    );
  }
  const access: AccessType =
    options.access ?? config?.accessType ?? "unlisted";
  const withThreads =
    (data.settings as any)?.editor?.serverCOEP === "require-corp";

  state = {
    status: "packaging",
    pageName,
    access,
    operation: config ? "update" : "create",
    startedAt: new Date().toISOString(),
  };

  run(pageName, access, withThreads, !!config).catch((e) => {
    state = {
      ...state,
      status: "failed",
      confirmUrl: undefined,
      error: String(e?.message ?? e),
      finishedAt: new Date().toISOString(),
    };
    console.error("[mcp][publish]", e);
  });

  return getPublishState();
}

async function run(
  pageName: string,
  access: AccessType,
  withThreads: boolean,
  hasConfig: boolean
) {
  installExtraCaCertificates();
  await packageForUpload();

  /* One-time token, confirmed by the user in the browser */
  const actionId = await fetch(`${API_URL}/auth/action`, {
    method: "POST",
    headers: {
      "User-Agent": editorUserAgent(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "createToken",
      parameters: { projectName: (data.settings as any)?.project?.name },
    }),
    redirect: "follow",
  }).then(async (r) => {
    if (!r.ok) throw new Error(`Could not request a token: HTTP ${r.status}`);
    return (await r.text()).trim();
  });

  const confirmUrl = `https://wonderlandengine.com/account/?actionId=${actionId}`;
  state = { ...state, status: "waiting_for_confirmation", confirmUrl };
  tools.openBrowser(confirmUrl);

  const token = await pollToken(actionId);
  state = { ...state, status: "uploading", confirmUrl: undefined };

  const page = await upload({
    token,
    pageName,
    deployPath: workspace.deployPath,
    workDir: workspace.root,
    isPublic: access === "public",
    withThreads,
    /* Never fall back to creating a new page for a published project. Without
     * deployment.json, a previous run may have created the page without
     * finishing, e.g. if the editor closed during the upload: adopt it. */
    mode: hasConfig ? "update" : "auto",
    commanderUrl: COMMANDER_URL,
  });

  writeConfig(page, withThreads);
  state = {
    ...state,
    status: "done",
    pageName: page.projectName,
    url: `https://${page.projectDomain}`,
    access: page.accessType,
    finishedAt: new Date().toISOString(),
  };
}

function pollToken(actionId: string): Promise<string> {
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      try {
        if (Date.now() > deadline) {
          clearInterval(timer);
          reject(new Error("Timed out waiting for confirmation in the browser."));
          return;
        }
        const result = await fetch(`${API_URL}/auth/action/${actionId}/result`, {
          headers: { "User-Agent": editorUserAgent() },
          redirect: "follow",
        }).then((r) => (r.ok ? r.json() : null));
        if (result?.token) {
          clearInterval(timer);
          resolve(result.token);
        }
      } catch {
        /* Not confirmed yet or temporary network error, keep polling */
      }
    }, POLL_INTERVAL_MS);
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const WORKER_PATH = fileURLToPath(new URL("./publish-worker.js", import.meta.url));

/**
 * Upload in a separate Node.js process if one is available, else in the
 * editor's process. The editor's embedded Node.js only services its event
 * loop between editor frames (rarely while the window is unfocused), which
 * made compressing a 10 MB deploy folder take 23 s instead of 0.3 s.
 */
async function upload(params: UploadParams): Promise<UploadedPage> {
  const node = existsSync(WORKER_PATH) ? await findNode() : null;
  if (!node) {
    console.log("[mcp][publish] no Node.js executable found, uploading in the editor");
    return uploadPage(params);
  }
  console.log(`[mcp][publish] uploading with ${node}`);
  return runWorker(node, params);
}

let nodeSearch: Promise<string | null> | null = null;

/**
 * Find a Node.js executable to run the publish worker with.
 *
 * The editor embeds Node.js as a library, so process.execPath is the editor's
 * own executable (e.g. /app/bin/WonderlandEditor in the Flatpak,
 * WonderlandEditor.exe on Windows), not a node binary. Editor installs ship a
 * `node` launcher next to it or in a sibling `bin` folder (the Flatpak has
 * /app/bin/node). If execPath already is a node binary, that is used. The
 * last resort is `node` on PATH. Every candidate has to answer `--version`.
 */
function findNode(): Promise<string | null> {
  if (!nodeSearch) nodeSearch = searchNode();
  return nodeSearch;
}

async function searchNode(): Promise<string | null> {
  const exe = process.platform === "win32" ? "node.exe" : "node";
  const execDir = dirname(process.execPath);
  const candidates: string[] = [];
  if (/^node(\.exe)?$/i.test(basename(process.execPath)))
    candidates.push(process.execPath);
  candidates.push(join(execDir, exe), join(dirname(execDir), "bin", exe));
  if (process.platform === "linux") candidates.push("/app/bin/node");

  for (const candidate of new Set(candidates)) {
    if (existsSync(candidate) && (await nodeVersion(candidate))) return candidate;
  }
  return (await nodeVersion("node")) ? "node" : null;
}

/** Version printed by `<path> --version`, or null if it does not run */
function nodeVersion(path: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      path,
      ["--version"],
      { timeout: 10000, windowsHide: true },
      (error, stdout) => {
        const version = String(stdout ?? "").trim();
        resolve(!error && /^v\d+\./.test(version) ? version : null);
      }
    );
  });
}

/** Run utils/publish-worker.js and return the page it reports */
function runWorker(node: string, params: UploadParams): Promise<UploadedPage> {
  /* The token is only passed in the environment, never on the command line
   * or in log output */
  const redact = (line: string) => line.split(params.token).join("***");
  const child = spawn(node, [WORKER_PATH], {
    cwd: params.workDir,
    env: {
      ...process.env,
      WLE_CREDENTIALS: params.token,
      WLE_PUBLISH_PAGE_NAME: params.pageName,
      WLE_PUBLISH_DEPLOY_PATH: params.deployPath,
      WLE_PUBLISH_WORK_DIR: params.workDir,
      WLE_PUBLISH_PUBLIC: params.isPublic ? "1" : "0",
      WLE_PUBLISH_THREADS: params.withThreads ? "1" : "0",
      WLE_PUBLISH_MODE: params.mode,
      WLE_PUBLISH_COMMANDER_URL: params.commanderUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let result: string | null = null;
  let lastStderr = "";
  createInterface({ input: child.stdout! }).on("line", (line) => {
    if (line.startsWith("RESULT ") || line.startsWith("ERROR ")) {
      result = line;
    } else if (line.trim()) {
      console.log("[mcp][publish]", redact(line));
    }
  });
  createInterface({ input: child.stderr! }).on("line", (line) => {
    if (!line.trim()) return;
    lastStderr = redact(line);
    console.log("[mcp][publish]", lastStderr);
  });

  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, UPLOAD_TIMEOUT_MS);

    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not start the upload process: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new Error(
            `Upload timed out after ${UPLOAD_TIMEOUT_MS / 60000} minutes. ` +
              `Publish again to retry.`
          )
        );
      } else if (result?.startsWith("RESULT ")) {
        try {
          resolve(JSON.parse(result.slice("RESULT ".length)));
        } catch (e) {
          reject(new Error(`Invalid upload result: ${redact(result)}`));
        }
      } else if (result?.startsWith("ERROR ")) {
        reject(new Error(redact(result.slice("ERROR ".length))));
      } else {
        reject(
          new Error(
            `Upload process exited with code ${code} without a result` +
              (lastStderr ? `: ${lastStderr}` : ".")
          )
        );
      }
    });
  });
}

/**
 * Package the project and make sure the deploy folder is complete before it is
 * uploaded. Another packaging run (triggered by a concurrent change) can be
 * active at the same time; packageProject() then fails with "already
 * packaging", and an upload during a run can catch half-written files (e.g.
 * an empty index.html). Retry until our own run succeeded, then wait until
 * index.html is non-empty and stable.
 */
async function packageForUpload() {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 10; ++attempt) {
    try {
      await tools.packageProject();
      lastError = null;
      break;
    } catch (e) {
      lastError = e;
      await delay(2000);
    }
  }
  if (lastError !== null)
    throw new Error(`Packaging failed, see the editor log (${String(lastError ?? "")}).`);

  const index = join(workspace.deployPath, "index.html");
  let lastSize = -1;
  for (let i = 0; i < 20; ++i) {
    const size = existsSync(index) ? statSync(index).size : 0;
    if (size > 0 && size === lastSize) return;
    lastSize = size;
    await delay(500);
  }
  throw new Error("deploy/index.html is missing or empty after packaging; not uploading.");
}

