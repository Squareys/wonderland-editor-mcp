---
name: wonderland-engine
description: Build and improve Wonderland Engine (WLE) web 3D projects through the Wonderland Editor MCP plugin. Use when asked to install Wonderland Engine, set up a project, connect to the editor's MCP server, import models, lay out a scene, or improve how a scene looks or performs (bloom, global illumination probe volumes, sky and environment lighting, meshlets, mesh simplification, texture atlas).
---

# Wonderland Engine via MCP

Wonderland Engine is a native editor that packages web 3D apps (WebGL2/WASM). The
Wonderland Editor MCP plugin (`@wonderlandengine/mcp-plugin`) runs inside the editor
and exposes its project data as MCP tools. You change the open project through these
tools; the editor saves, packages and live-reloads the result.

**Discard your assumptions about web projects.** Wonderland Engine handles load
time and runtime optimization (compression, streaming, texture atlas, batching)
so that its projects can be treated like native projects in terms of texture and
vertex budgets. Do not downscale assets, avoid effects or keep scenes small just
because the result runs in a browser; use the budgets you would use for a native
engine on the same target device.

## Pick your track first

This skill has two tracks. Choose once, at the start, and stay on it.

- **Track A (frontier models, e.g. Claude Opus):** read the "Core rules" and the
  reference files as needed, then plan and act in larger steps.
- **Track B (smaller or mid-size models, e.g. DeepSeek V4):** follow the
  step-by-step worksheets. Do one step per turn of thinking, write down every
  intermediate number, and never skip the check at the end of a step. Use
  [references/stepwise-layout.md](references/stepwise-layout.md) for every scene
  layout task, even small ones.

If you are unsure which track you are on, use Track B. It is slower but safe.

## What to read when

| Task | Read |
| --- | --- |
| Nothing installed yet, or the MCP tools are missing | [references/setup.md](references/setup.md) |
| Connecting a coding agent (transport, URL, port) | [references/connect.md](references/connect.md) |
| Tool names, arguments, return shapes | [references/tools.md](references/tools.md) |
| Importing models and placing them in the scene | [references/layout.md](references/layout.md) (Track A) or [references/stepwise-layout.md](references/stepwise-layout.md) (Track B) |
| Making the scene look good or run fast | [references/visual-quality.md](references/visual-quality.md) |
| Animating characters, writing JavaScript components, camera sequences | [references/animation-and-code.md](references/animation-and-code.md) |
| Checking what the scene looks like (screenshots) | [references/visual-check.md](references/visual-check.md) |
| Publishing the project on the web (Wonderland Cloud Pages). Always ask the user "unlisted or public?" first, and add a social card | [references/publish.md](references/publish.md) |
| Something went wrong | [references/pitfalls.md](references/pitfalls.md) |

## Core rules

1. **Change the project only through the MCP tools.** Never edit the `.wlp` project
   file by hand while the editor runs: the editor holds the project in memory and
   overwrites the file on its next save, and a malformed edit can stop the project
   from loading. The only exception is a documented edge case in
   [references/pitfalls.md](references/pitfalls.md), and then only with the editor
   closed.
2. **Keep the user watching.** As soon as the editor runs with its web server, call
   `open_preview` (or open `http://localhost:8080`, the `editor.serverPort`
   setting, yourself). Do this also when the editor runs with `--windowless`: the
   browser is then the user's only view of the scene. Every MCP change triggers a
   repackage, and the page reloads by itself.
3. **Look at your result.** After each import, layout step or lighting change, take
   a screenshot of the preview and check it against your plan before you report
   success ([references/visual-check.md](references/visual-check.md)).
4. **Save.** Changes live only in the editor's memory until you call
   `save_project`. Save after every finished step and before stopping the editor.
5. **Import, measure, then place.** Every imported model goes through the same loop:
   `import_scenes` → read the returned bounds → compute scale and position → apply
   with `modify_objects` → confirm with `compute_object_bounds`. Never guess a scale
   or a position. Track every placed object's footprint, walls and pillars
   included, so nothing overlaps (see the layout reference). A character standing
   inside a wall is the most visible layout error; never ship it.
6. **Batch tool calls.** Every tool takes arrays. Import all files in one
   `import_scenes` call, change all objects in one `modify_objects` call, measure
   all objects in one `compute_object_bounds` call. One call per object is slow
   and keeps the user waiting.
7. **Query narrowly.** Use `includeFilter`, `excludeFilter` and `paths` with
   `query_resources`. Listing every object of a large scene floods your context;
   `query_scene_tree` gives a compact overview of the hierarchy instead.
8. **Read settings before you write them.** Call `query_settings` with the paths you
   plan to change, so you know the exact names and current values in this editor
   version, then call `modify_settings`.
9. **Report progress.** During setup, tell the user which step you are on and how
   many are left ("Step 6 of 8: installing the plugin").
10. **Do not start a second editor for the same project or on ports already in use.**
   If the MCP tools respond, the editor already runs. Start one yourself only during
   setup, when the user asks, or for a different project on other ports (setup.md,
   "Running beside another editor").

## Finishing a scene change

When a task is done, go through this list before you report:

1. Final overlap check over all objects (layout reference).
2. Screenshots from more than one viewpoint, compared with the plan
   (visual-check reference).
3. `save_project`.
4. **GI re-bake.** If the project uses a GI probe volume
   (`gi.probeVolume.enabled`) and you moved, added or removed static geometry or
   lights since the last bake, the baked lighting is out of date. It still looks
   plausible, so it is easy to miss. Ask the user to press Bake now, once, and
   monitor it (visual-quality reference, "Bake"). Before that, make sure
   everything animated or moving has `hiddenForLightBaking: true`. Also check that
   the probe volume still encloses the whole scene; resize it first if the scene
   grew.
5. Report what changed, with the final screenshot.

## Coordinate system

- Y is up. Units are meters.
- Rotations are quaternions `[x, y, z, w]`. A yaw (turn around Y) by angle `a` is
  `[0, sin(a/2), 0, cos(a/2)]`; 90° is `[0, 0.7071, 0, 0.7071]`, 180° is `[0, 1, 0, 0]`.
- Bounds are axis-aligned boxes `{min: [x, y, z], max: [x, y, z]}`.
