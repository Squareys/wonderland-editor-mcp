/**
 * Standalone Node.js script that uploads the deploy folder to Wonderland Cloud
 * Pages. Spawned by publish.ts, because the editor's embedded Node.js only
 * services its event loop between editor frames, which makes compressing and
 * uploading many times slower than in a separate process.
 *
 * Parameters come from environment variables (the token is never passed on
 * the command line):
 * - WLE_CREDENTIALS: one-time Wonderland Cloud token
 * - WLE_PUBLISH_PAGE_NAME, WLE_PUBLISH_DEPLOY_PATH, WLE_PUBLISH_WORK_DIR
 * - WLE_PUBLISH_PUBLIC, WLE_PUBLISH_THREADS: "1" or "0"
 * - WLE_PUBLISH_MODE: "create", "update" or "auto"
 * - WLE_PUBLISH_COMMANDER_URL
 *
 * Output: log lines of the CLI library, then exactly one final line, either
 * `RESULT <json>` with the page (projectName, projectDomain, accessType) and
 * exit code 0, or `ERROR <message>` and exit code 1.
 */
import { loadCloudClient, uploadPage, type UploadMode } from "./cloud-client.js";
import { installExtraCaCertificates } from "./tls.js";

const MODES: UploadMode[] = ["create", "update", "auto"];

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function finish(line: string, code: number) {
  /* Exit only after the line is flushed; pipes are asynchronous on Windows */
  process.stdout.write(line + "\n", () => process.exit(code));
}

async function main() {
  const token = required("WLE_CREDENTIALS");
  delete process.env.WLE_CREDENTIALS;
  const mode = required("WLE_PUBLISH_MODE") as UploadMode;
  if (!MODES.includes(mode)) throw new Error(`Invalid WLE_PUBLISH_MODE "${mode}"`);
  const params = {
    token,
    pageName: required("WLE_PUBLISH_PAGE_NAME"),
    deployPath: required("WLE_PUBLISH_DEPLOY_PATH"),
    workDir: required("WLE_PUBLISH_WORK_DIR"),
    isPublic: process.env.WLE_PUBLISH_PUBLIC === "1",
    withThreads: process.env.WLE_PUBLISH_THREADS === "1",
    mode,
    commanderUrl: required("WLE_PUBLISH_COMMANDER_URL"),
  };

  installExtraCaCertificates();
  loadCloudClient();
  const page = await uploadPage(params);
  return {
    projectName: page.projectName,
    projectDomain: page.projectDomain,
    accessType: page.accessType,
  };
}

main().then(
  (page) => finish(`RESULT ${JSON.stringify(page)}`, 0),
  (e) => {
    const message = String(e?.message ?? e).replace(/\s*\n\s*/g, " ");
    finish(`ERROR ${message}`, 1);
  }
);
