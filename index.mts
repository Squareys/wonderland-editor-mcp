import { EditorPlugin, ui } from "@wonderlandengine/editor-api";

import { main, shutdown } from "./server.js";
import { WorkQueue } from "./utils/work-queue.js";

const PORT = 3020;
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

    main({ port: PORT, queue: this.queue }).catch((error) => {
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

    /* Consume all functions in the queue */
    while (this.queue.pop()) ++this.commandsCount;
  }
}
