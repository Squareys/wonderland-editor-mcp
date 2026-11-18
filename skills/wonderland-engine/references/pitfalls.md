# Pitfalls: symptom → fix

Look up the symptom, apply the fix. Where a topic is explained in full elsewhere,
the entry links there.

## Editor process

| Symptom | Fix |
| --- | --- |
| Linux: exit code 139 right after "Running in windowless mode" | No X11 display. Set `DISPLAY`, or run under `xvfb-run -a` ([setup.md](setup.md), step 7). |
| Linux with NVIDIA: exit 139 after "Initializing Plugin: PluginsView" | `__GL_THREADED_OPTIMIZATIONS=0` ([setup.md](setup.md), step 7). |
| `[mcp][error] ... EADDRINUSE` | Another editor holds the port. Stop that one by its PID, or give the new editor other ports ([setup.md](setup.md), "Running beside another editor"). |
| Flatpak `npm`: "Cannot find module .../node_modules/npm/index.js" | Add `--env=NPM_CLI_JS=/app/share/wonderlandengine/npm/index.js` ([setup.md](setup.md), step 6). |
| Cannot find the editor process to stop it | The process is named `Main` (the first one `WonderlandEditor`), so `pkill WonderlandEditor` misses it. Find it by port (`ss -ltnp \| grep :<mcp port>`) or, for `--create` (opens no ports), with `pgrep -f <project path>`; then `kill <pid>`. `flatpak kill com.wonderlandengine.editor` stops **all** editors. |
| Crash "munmap_chunk(): invalid pointer" or "Cork buffer must not be acquired ..." at "Reloading clients" | A browser was still loading the preview during repackaging ([visual-check.md](visual-check.md), "No browser connected while you edit"). |
| New JavaScript components are not registered | The editor watches `js/` only if it existed at start. Restart the editor once. |

**Never close or restart an editor the user may be working in** (a GI bake may be
running, and it ends silently with the editor). Ask first and wait for the answer.

## Project file and new projects

| Symptom | Fix |
| --- | --- |
| Your `.wlp` edit is gone or the project no longer loads | Never edit the `.wlp` while the editor runs; it overwrites the file on save. Use the MCP tools. Only exception: enabling the plugin with the editor stopped ([setup.md](setup.md), step 6). |
| Changes lost after the editor stopped | They were only in memory and `.autosave/`. Call `save_project` after every step. |
| New project: "Left and right eye objects need to be set", then "View object could not be detected" | Disable VR (or set the eye objects), add a camera and a sun ([setup.md](setup.md), step 8). |
| `--create` keeps running | Expected. Stop it once the `.wlp` exists. It writes no `package.json`; run `npm init -y`. |
| After renaming the project: "Found probe volume scenario with no filename. Ensure it is compiled", GI gone | The cache folder follows the project name. Copy the bake into the new folder ([visual-quality.md](visual-quality.md), "Keep the bake"). |

## MCP connection

| Symptom | Fix |
| --- | --- |
| "Must call initialize first" or "Not initialized" | Another client initialized and took over the single session. Reconnect; never probe while another agent is connected. |
| Tools missing after setup | Most clients load MCP servers only at start. Restart or reload the client. |
| Connection refused | The editor is not running, the project is not open, plugin execution is off, or the port differs ([connect.md](connect.md)). |

## Importing and layout

| Symptom | Fix |
| --- | --- |
| PBR models look dull or plastic | Imported as Phong. Set `editor.importPhysicalAsPhongMaterials = false` before importing, or switch the materials' `pipeline` to "Physical Opaque Textured". |
| Model huge or tiny | Units differ. Always scale from the measured bounds. |
| Model floats or is offset | The pivot is not at the base or center. Use the placement formula ([layout.md](layout.md)). |
| Footprint wrong after rotating | Rotation changes the footprint. Re-measure with `compute_object_bounds`. |
| Stray cameras or lights in the scene | Imports bring their own. Delete them from the container. |
| A wall or prop stands at the origin, inside the scene | A forgotten template container. Place or delete every container ([layout.md](layout.md)). |
| Duplicate images, textures and materials after importing a kit | Each file imports its own copy of a shared texture. Point meshes at one material; no tool deletes resources ([tools.md](tools.md), `import_scenes`). |
| `query_resources` floods the context | Filter by name and use `paths`, or use `query_scene_tree`. |
| Cube looks twice as big as expected | `p1` is 2 m wide. The plane `p0` lies in XY and faces +Z. |

## Rendering and baking

| Symptom | Fix |
| --- | --- |
| Effect switched on but no visible change | The pipeline feature is missing (`TONEMAPPING`, `GLOBAL_ILLUMINATION`, `GLOBAL_ILLUMINATION_PROBE_VOLUME`, `SSAO`, `WITH_EMISSIVE`) ([visual-quality.md](visual-quality.md)). |
| "Environment is enabled, but a failure occurred during baking" | Set `rendering.environment.material` to the sky material. In a window, package once more. Windowless editors cannot bake the sky ([visual-quality.md](visual-quality.md), "Sky environment bake"). |
| Shadows stop a few meters from the camera | Raise the sun's `shadowRange` (default 10 m) to the scene diagonal plus margin. |
| All GI probes black | Someone ran `--bake gi` on the command line (writes zeros in 1.6.1). Bake in the editor window. |
| `--bake gi` says "No probe volume scenario configured" | Create a `probeVolumeScenarios` resource and set `gi.probeVolume.scenario`. Then bake in the window anyway. |
| Dark or bright patches where characters stood at bake time | Moving objects were baked. Set `hiddenForLightBaking: true` on their whole hierarchy and re-bake. |
| Interiors dark after a GI bake | Sun too weak or not entering through openings; point lights do not bake ([visual-quality.md](visual-quality.md), "Light sources for the bake"). |
| Windowless packaging fails: "Found probe volume scenario with no filename" | Package GI projects from an editor with a window. |
| Meshlets on, but no effect or packaging errors | Both the pipeline and every mesh drawn with it need `meshlets: true`. |
| Textures missing, or packaging fails with many large textures | Texture atlas full. Increase `rendering.textureAtlasSize` and `rendering.compressedTextureAtlasSize` (cheap: sparse virtual texture). |
| Everything glows | Bloom `threshold` below 1. |

## Publishing

| Symptom | Fix |
| --- | --- |
| `publish_page`: "This project is already published as ..." | The project has a `deployment.json` and you passed another `pageName`. Call it without `pageName`. Publishing to another page needs the user to delete `deployment.json`; ask first. |
| `publish_status` stays at `waiting_for_confirmation` | The user has not confirmed. Give them `confirmUrl`. After 15 minutes the publish fails; start a new one. |
| `ERR_REQUIRE_ESM` from `@wonderlandcloud/cli` | CLI 0.2.36 on Node.js 18. Use `@wonderlandcloud/cli@0.2.37` or newer. |
| `SELF_SIGNED_CERT_IN_CHAIN` | A server certificate chain the editor's Node.js 18 does not trust (happened 14-18 November 2026, fixed on the server). The `publish_page` tool trusts the system CA bundle as well. Report it to the user. |
| Published page loads an empty page | `deploy/index.html` was empty or missing at upload time (packaging still running, or failed). Wait for "Packaging successful!", check the file, publish again. |
| New page does not load | The domain's SSL certificate takes a few minutes, up to 30 minutes. |
