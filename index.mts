import { EditorPlugin, ui } from "@wonderlandengine/editor-api";

import { WorkQueue, main, shutdown } from "./mcp-server.js";

const PORT = 3000;
const CONFIG_EXAMPLE = `    "wonderland-editor-mcp": {
      "url": "http://localhost:${PORT}/sse"
    }
`;

/* This is an example of a Wonderland Editor plugin */
export default class Index extends EditorPlugin {
  queue!: WorkQueue;
  commandsCount = 0;
  status = "running";

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
      "Copy the following config into Cursor\n" +
        "or any other client that supports MCP via SSE transport:"
    );
    ui.text('{\n  "mcpServers": {');
    ui.inputText("", CONFIG_EXAMPLE);
    ui.text("  }\n}\n");

    /* Consume all functions in the queue */
    while (this.queue.pop()) ++this.commandsCount;
  }
}
