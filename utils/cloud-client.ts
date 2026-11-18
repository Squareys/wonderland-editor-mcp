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
