import Module, { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);

let cloud: any = null;

/**
 * Load @wonderlandcloud/cli lazily.
 *
 * The package requires `uuid` v13, which is ESM-only and cannot be require()d
 * on the editor's Node.js 18 runtime (ERR_REQUIRE_ESM). The package only uses
 * `uuid.v4()` for request ids, so if loading fails for that reason, we load it
 * again with `uuid` redirected to `crypto.randomUUID()`.
 *
 * Remove this workaround once @wonderlandcloud/cli no longer depends on an
 * ESM-only uuid.
 */
export function loadCloudClient(): any {
  if (cloud) return cloud;
  try {
    cloud = require("@wonderlandcloud/cli");
    return cloud;
  } catch (e: any) {
    if (e?.code !== "ERR_REQUIRE_ESM") throw e;
  }

  /* Drop partially loaded modules of the failed attempt */
  for (const key of Object.keys(require.cache)) {
    if (key.includes("@wonderlandcloud")) delete require.cache[key];
  }

  const M = Module as any;
  const originalLoad = M._load;
  M._load = function (request: string, ...rest: any[]) {
    if (request === "uuid") return { v4: () => randomUUID() };
    return originalLoad.call(this, request, ...rest);
  };
  try {
    cloud = require("@wonderlandcloud/cli");
  } finally {
    M._load = originalLoad;
  }
  return cloud;
}

/**
 * How {@link uploadPage} picks between creating and updating a page:
 * - `create`: create a new page,
 * - `update`: update the existing page, never create one,
 * - `auto`: update the page if it exists and is owned by the user (e.g. a
 *   previous run created it without finishing), else create it.
 */
export type UploadMode = "create" | "update" | "auto";

export interface UploadParams {
  /** One-time Wonderland Cloud token */
  token: string;
  pageName: string;
  deployPath: string;
  workDir: string;
  isPublic: boolean;
  withThreads: boolean;
  mode: UploadMode;
  commanderUrl: string;
}

/** Page object as returned by the Wonderland Cloud API (fields we use) */
export interface UploadedPage {
  projectName: string;
  projectDomain: string;
  accessType: "public" | "unlisted";
}

/**
 * Upload the deploy folder to Wonderland Cloud Pages. Has no dependency on
 * the editor API, so it runs both in the editor and in the standalone
 * publish worker.
 */
export async function uploadPage(params: UploadParams): Promise<UploadedPage> {
  const { CloudClient } = loadCloudClient();
  const client = new CloudClient(
    {
      WLE_CREDENTIALS: params.token,
      WORK_DIR: params.workDir,
      COMMANDER_URL: params.commanderUrl,
    },
    "page"
  );
  const { deployPath, pageName, isPublic, withThreads } = params;

  let mode = params.mode;
  if (mode === "auto") {
    const existing = await client.page.get(pageName).catch(() => null);
    mode = existing && existing.ownedByMe ? "update" : "create";
  }
  return mode === "update"
    ? await client.page.update(deployPath, pageName, isPublic, withThreads)
    : await client.page.create(deployPath, pageName, isPublic, withThreads);
}
