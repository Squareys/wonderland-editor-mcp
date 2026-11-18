import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { data, tools, workspace } from "@wonderlandengine/editor-api";
import { loadCloudClient } from "./cloud-client.js";
import { installExtraCaCertificates } from "./tls.js";

const API_URL = "https://api.wonderlandengine.com";
const COMMANDER_URL = "https://cloud.wonderland.dev";
const POLL_INTERVAL_MS = 5000;
const CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;

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
  await tools.packageProject();

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

  const { CloudClient } = loadCloudClient();
  const client = new CloudClient(
    { WLE_CREDENTIALS: token, WORK_DIR: workspace.root, COMMANDER_URL },
    "page"
  );
  const isPublic = access === "public";

  let page: any;
  if (hasConfig) {
    /* Never fall back to creating a new page for a published project */
    page = await client.page.update(
      workspace.deployPath,
      pageName,
      isPublic,
      withThreads
    );
  } else {
    /* A previous run may have created the page without finishing, e.g. if
     * the editor closed during the upload. Adopt it instead of failing. */
    const existing = await client.page.get(pageName).catch(() => null);
    page =
      existing && existing.ownedByMe
        ? await client.page.update(
            workspace.deployPath,
            pageName,
            isPublic,
            withThreads
          )
        : await client.page.create(
            workspace.deployPath,
            pageName,
            isPublic,
            withThreads
          );
  }

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
