# Wonderland Editor MCP Plugin

## Overview

The Wonderland Editor MCP Plugin runs a Model Context Protocol (MCP) server inside
Wonderland Editor, so that AI coding agents can inspect and change the open project:
import models, place objects, edit materials and settings, and save.

## Requirements

Wonderland Editor 1.5.0 or newer. The `save_project` tool needs 1.6.0 or newer.

## Configuration

### Project

Install the plugin into your project via "Views > Plugins > Project Scope", then
enable it. Alternatively, run `npm i -D @wonderlandengine/mcp-plugin` in the project
directory and enable the plugin in "Views > Plugins".

### AI agent client

Once the project is loaded and plugin execution is enabled, the MCP server runs with
the **Streamable HTTP** transport on:

```
http://localhost:3020/mcp
```

Set the environment variable `WLE_MCP_PORT` for the editor to use a different port.

Most clients accept a configuration like:

```json
{
  "mcpServers": {
    "wonderland-editor": {
      "url": "http://localhost:3020/mcp"
    }
  }
}
```

The server accepts one client session at a time; a new client replaces the previous
one.

If your client only supports stdio, wrap the server:

```sh
npx -y supergateway --streamableHttp http://localhost:3020/mcp
```

On Windows, clients that cannot start `npx` directly need
`cmd /c npx -y supergateway --streamableHttp http://localhost:3020/mcp`.

## Tools

| Tool | Purpose |
| --- | --- |
| `query_resources` | List objects, meshes, materials, pipelines and other resources, with filters |
| `query_settings` | Read project settings |
| `query_component_types` | List component types and their properties |
| `query_scene_tree` | Compact indented object hierarchy with component types |
| `modify_objects` | Create or change objects and their components; unknown keys are rejected |
| `duplicate_objects` | Deep-copy objects with descendants and components, placed per copy |
| `modify_resources` | Create or change other resources |
| `modify_settings` | Change project settings |
| `delete_objects` | Delete objects |
| `import_scenes` | Import GLB, FBX, glTF, OBJ, PLY; returns bounds for scaling |
| `import_files` | Import images and other files |
| `compute_mesh_bounds` | Bounds of meshes |
| `compute_object_bounds` | Bounds of object hierarchies, in world (default) or parent space |
| `find_overlaps` | Pairs of objects whose world-space bounds intersect or are too close |
| `save_project` | Save the project file (Wonderland Editor 1.6.0+) |
| `open_preview` | Open the live preview in the default browser |
| `publish_page` | Publish the project to Wonderland Cloud Pages. The user confirms in the browser |
| `publish_status` | State of the current or last publish: packaging, waiting for confirmation, uploading, done, failed |

## Agent skill

[`skills/wonderland-engine`](skills/wonderland-engine/SKILL.md) is an agent skill
that teaches coding agents to install Wonderland Engine, set up a project with this
plugin, lay out scenes, and use the engine's rendering features well.
