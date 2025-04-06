import { EditorPlugin, ui } from "@wonderlandengine/editor-api";

import { WorkQueue, main } from "./mcp-server.js";

const PORT = 3000;
const CONFIG_EXAMPLE = `    "wonderland-editor-mcp": {
      "url": "http://localhost:${PORT}/sse"
    }
`;

/* This is an example of a Wonderland Editor plugin */
export default class Index extends EditorPlugin {
  queue!: WorkQueue;
  commandsCount = 0;

  constructor() {
    super();
    this.name = "MCP Server";
    this.queue = new WorkQueue();

    main({ port: PORT, queue: this.queue }).catch((error) => {
      console.error("Server error:", error);
    });
  }

  draw() {
    ui.text(`Status: running, commands run: ${this.commandsCount}.`);
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
