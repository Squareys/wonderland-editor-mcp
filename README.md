# Wonderland Editor MCP Plugin

## Overview

The Wonderland Editor MCP Plugin facilitates interaction with the Model Context Protocol (MCP) within the Wonderland Engine, enhancing your development workflows with AI assistants.

## Configuration

### Project

First, install the plugin into your project:

```ssh
// Clone this repository into the plugins folder of your project, or install via npm
npm i --save-dev path/to/repo

cd path/to/repo
npm i
npm run build
```

### AI Agent Client

Once the project is loaded and plugin execution is enabled, the MCP server runs via SSE transport on
`http://localhost:3000/sse`.

If you can't use SSE, because your client doesn't support it, you can wrap it like this:

```sh
# Wrap the mcp server via STDIO
npx -y supergateway --sse "https://localhost:3000"
```

## Features

- Primarily SSE transport, but comes with an npm command `@wonderlandengine/mcp-server` to wrap into
  STDIO with Supergateway.
- Modify and manage Wonderland Engine objects and resources dynamically.
- Import files into the editor.
