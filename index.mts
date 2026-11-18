import { webcrypto } from "node:crypto";
import { EditorPlugin, ui, tools } from "@wonderlandengine/editor-api";

/* The editor's embedded Node.js 18 has no global `crypto`, which newer
 * versions of @modelcontextprotocol/sdk use (e.g. crypto.randomUUID()). */
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { main, shutdown } from "./server.js";
import { WorkQueue } from "./utils/work-queue.js";

const PORT = Number(process?.env?.WLE_MCP_PORT ?? 3020);
const CONFIG_EXAMPLE = `    "wonderland-editor-mcp": {
      "url": "http://localhost:${PORT}/mcp"
    }
`;

/* This is an example of a Wonderland Editor plugin */
export default class Index extends EditorPlugin {
  queue!: WorkQueue;
  commandsCount = 0;
  status = "running on port " + PORT;

  constructor() {
    super();
    this.name = "MCP Server";
    this.queue = new WorkQueue();

    main({ port: PORT, queue: this.queue }).then(
      () => {
        console.log("[mcp] server running on port", PORT);
      }
    ).catch((error) => {
      console.error("[mcp][error]", error.toString());
      this.status = "[error]" + error.toString();
    });
  }

  unload() {
    /* Shutdown server and allow rebinding the port when reloading */
    shutdown();
  }

  draw() {
    ui.text(`Status: ${this.status}`);
    ui.text(`Commands run: ${this.commandsCount}.`);
    ui.separator();
    ui.text(
      "Copy the following config into your config file\n" +
        "(any client that supports MCP via Streamable HTTP transport):"
    );
    ui.text('{\n  "mcpServers": {');
    ui.inputTextMultiline("instruction", CONFIG_EXAMPLE);
    ui.text("  }\n}\n");

    /* Backwards compatibility for Wonderland Editor < 1.4.6 */
    this.update();
  }

  update() {
    /* Consume all functions in the queue */
    if (!this.queue.empty) {
      const pending: Promise<void>[] = [];
      let p: Promise<void> | null;
      while ((p = this.queue.pop())) {
        pending.push(p);
        ++this.commandsCount;
      }
      /* Package once all commands finished (some, like imports, are async).
       * Defer to after the change handlers consumed the changes. */
      Promise.allSettled(pending).then(() =>
        setTimeout(() => {
          tools.packageProject().catch((e: unknown) => {
            /* Packaging errors are reported in the editor log already,
             * e.g. a missing view object. Don't crash the plugin. */
            console.warn("[mcp] packaging failed", e ?? "");
          });
        }, 0)
      );
    }
  }
}
