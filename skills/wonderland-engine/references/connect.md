# Connecting a coding agent to the editor

You know your own client's configuration format. This file lists only what is
specific to the Wonderland Editor MCP server.

## The server

| Property | Value |
| --- | --- |
| Transport | Streamable HTTP (MCP spec 2025-03-26 and later) |
| URL | `http://localhost:3020/mcp` |
| Methods | `POST /mcp` (requests), `GET /mcp` (server stream), `DELETE /mcp` (end session) |
| Port | `3020`, changed with the environment variable `WLE_MCP_PORT` in the editor's environment |
| Auth | None. It listens on localhost only. |
| Lifetime | Runs while the editor has the project open with plugin execution enabled |
| Sessions | One. A new `initialize` request replaces the previous session. |

The server is **not** SSE. Older plugin READMEs mention SSE; current versions only
speak Streamable HTTP.

**One client at a time.** Each new `initialize` closes the previous session, so two
agents (or an agent and the MCP inspector) connected at once keep disconnecting
each other. If your tool calls suddenly fail with "Must call initialize first" or
"Not initialized", another client connected; reconnect.

To use another port, start the editor with the variable set, e.g.
`WLE_MCP_PORT=3021 WonderlandEditor ...` or, with Flatpak,
`flatpak run --env=WLE_MCP_PORT=3021 com.wonderlandengine.editor ...`.

## Transport variations

Pick the first one your client supports.

### 1. Streamable HTTP (native, preferred)

Most JSON-based client configurations look like this:

```json
{
  "mcpServers": {
    "wonderland-editor": {
      "url": "http://localhost:3020/mcp"
    }
  }
}
```

Some clients need an explicit type, e.g. `"type": "http"` or
`"transport": "streamable-http"`. Use whatever your client calls Streamable HTTP.

### 2. stdio bridge (client supports only local commands)

Wrap the HTTP endpoint in a stdio process with `supergateway`:

```sh
npx -y supergateway --streamableHttp http://localhost:3020/mcp
```

Configure that command as a stdio server. On Windows, clients that cannot start
`npx` directly need `cmd /c npx -y supergateway --streamableHttp http://localhost:3020/mcp`.

`npx -y mcp-remote http://localhost:3020/mcp` is an alternative bridge.

### 3. SSE bridge (client supports only the old SSE transport)

Chain two bridges: Streamable HTTP to stdio, then stdio to SSE.

```sh
npx -y supergateway --port 3030 \
  --stdio "npx -y supergateway --streamableHttp http://localhost:3020/mcp"
```

Then point the client at `http://localhost:3030/sse`.

## Checking the connection

1. Call `query_settings` with `{"paths": ["project"]}`. It is cheap and returns the
   project name.
2. If the tools are missing: the editor is not running, the project is not open,
   plugin execution is disabled, or your client did not reload its configuration.
3. If the connection is refused on port 3020: check the editor log for
   `[mcp][error]`. Another program (or a second editor) may hold the port.
