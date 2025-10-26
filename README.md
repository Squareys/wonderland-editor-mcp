# Wonderland Editor MCP Plugin

## Overview

The Wonderland Editor MCP Plugin facilitates interaction with the Model Context Protocol (MCP) within the Wonderland Engine, enhancing your development workflows with AI assistants.

## Requirements

To use this plugin, you need a nightly version or version 1.4.0+ of Wonderland Engine.

## Configuration

### Project

First, install the plugin into your project via the "Views > Plugins > Project" view.

### AI Agent Client

Once the project is loaded and plugin execution is enabled, the MCP server runs via SSE transport on
`http://localhost:3020/mcp`.

If you can't use SSE, because your client doesn't support it, you can wrap it like this:

```sh
# Wrap the mcp server via STDIO
npx -y supergateway --sse "http://localhost:3020/mcp"
```

#### Continue

On **Windows**:

```yml
- name: Wonderland Editor
  command: cmd
  args:
    - /c
    - npx
    - -y
    - supergateway
    - --streamableHttp
    - http://localhost:3020/sse
```

Other systems:

```yml
- name: Wonderland Editor
  command: npx
  args:
    - -y
    - supergateway
    - --streamableHttp
    - http://localhost:3020/mcp
```
