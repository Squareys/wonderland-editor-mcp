import { EditorPlugin, ui } from "@wonderlandengine/editor-api";

import { main } from "./mcp-server.js";
const PORT = 3000;
const CONFIG_EXAMPLE = `
    "wonderland-editor-mcp": {
      "url": "http://localhost:${PORT}/sse"
    }
`;

/* This is an example of a Wonderland Editor plugin */
export default class Index extends EditorPlugin {
  /* The constructor is called when your plugin is loaded */
  constructor() {
    super();
    this.name = "MCP Server";

    main({ port: PORT }).catch((error) => {
      console.error("Server error:", error);
    });
  }

  /* Use this function for drawing UI */
  draw() {
    ui.text(`Status: running.`);
    ui.separator();
    ui.text(
      "Copy the following config into Cursor\n" +
        "or any other client that supports MCP via SSE transport:"
    );
    ui.text('{\n  "mcpServers": {');
    ui.inputText("", CONFIG_EXAMPLE);
    ui.text("  }\n}\n");
  }
}
