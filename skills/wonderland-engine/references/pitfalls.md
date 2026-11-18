# Pitfalls and fixes

## Project file

- **Do not edit the `.wlp` file while the editor runs.** The editor keeps the
  project in memory and overwrites the file on save. Use the MCP tools.
- **The one exception: enabling the plugin in a project without an editor window.**
  Plugin execution needs an entry in the project file. With the editor **stopped**,
  add it to the top-level `plugins` object:

  ```json
  "plugins": { "@wonderlandengine/mcp-plugin": { "enable": true } }
  ```

  In the editor window, "Views > Plugins" does the same.
- **Save.** Changes are kept in memory and in `.autosave/` only. Call
  `save_project` after each finished step, and always before stopping the editor.

## New projects

A project made with `--create` has no camera, and VR enabled without eye objects.
The first packaging fails with "Left and right eye objects need to be set" and then
"View object could not be detected". Fix:

1. `modify_settings {"changeSettings": {"xr": {"vr": {"enable": false}}}}` (unless
   the user wants VR).
2. Add a camera: an object with a `view` component, e.g. at `[0, 1.6, 4]`.
3. Add a light (a `sun` light) so the scene is not black.

`--create` also keeps running instead of exiting; stop the editor once the `.wlp`
exists. It does not write `package.json`; create one with `npm init -y` before
installing the plugin.

## Editor process

- **Only one editor per port.** A second editor cannot bind port 3020 (MCP) or 8080
  (preview). The log then shows `[mcp][error] ... EADDRINUSE`. Stop the old one.
- **Stopping the Flatpak editor:** `flatpak kill com.wonderlandengine.editor`. The
  process is named `Main`, so `pkill WonderlandEditor` misses it.
- **Linux, `--windowless` crashes with exit code 139** right after "Running in
  windowless mode": no X11 display. Set `DISPLAY`, or run under `xvfb-run -a`.
- **Linux with NVIDIA, the editor crashes at startup** (after
  "Initializing Plugin: PluginsView"): disable NVIDIA's threaded optimizations,
  `__GL_THREADED_OPTIMIZATIONS=0`. For Flatpak, permanently:
  `flatpak override --user --env=__GL_THREADED_OPTIMIZATIONS=0 com.wonderlandengine.editor`.
- **Flatpak `npm` fails** with "Cannot find module .../node_modules/npm/index.js":
  add `--env=NPM_CLI_JS=/app/share/wonderlandengine/npm/index.js` to
  `flatpak run --command=npm ...`.

## MCP connection

- **Only one MCP client at a time.** A second client's `initialize` replaces the
  first client's session. Symptoms: "Must call initialize first", "Not
  initialized". Reconnect, and do not run probes while another agent is connected.
- **Tools missing after setup:** most clients only load MCP servers at start.
  Restart or reload the client.

## Importing

- **PBR models look dull or plastic:** they were imported as Phong because
  `editor.importPhysicalAsPhongMaterials` is `true` by default. Set it to `false`
  before importing, or switch the materials' `pipeline` to "Physical Opaque
  Textured" afterwards.
- **The model is huge or tiny:** units differ between tools (centimeters vs
  meters). Always scale from the measured bounds; never assume a model is in
  meters.
- **The model floats or is offset:** the pivot is not at the base or center. Use
  the placement formula from the layout reference.
- **Rotation changes the footprint.** Re-measure with `compute_object_bounds`
  after rotating.
- **Imports bring their own cameras and lights.** Check the children of the
  container and delete them if they are not wanted.

## Rendering

- **Packaging fails with "Environment is enabled, but a failure occurred during
  baking":** set `rendering.environment.material` to the sky material.
- **Shadows stop a few meters from the camera:** the sun's `shadowRange` (default
  10 m) is smaller than the scene. Set it to the scene's size (diagonal plus
  margin) via `modifyComponents` on the sun's `light` component.
- **Effects have no visible effect:** the pipeline feature is missing
  (`TONEMAPPING`, `GLOBAL_ILLUMINATION`, `GLOBAL_ILLUMINATION_PROBE_VOLUME`,
  `SSAO`). See the visual-quality reference.
- **Meshlets enabled on a pipeline but not on its meshes:** every mesh drawn with
  a meshlet pipeline needs `meshlets: true` on the mesh resource as well.
- **`--bake gi` says "No probe volume scenario configured":** create a
  `probeVolumeScenarios` resource and set `gi.probeVolume.scenario` to its id.
- **`--bake gi` on the command line produces empty GI data** (1.6.1, all
  platforms): it reports success, but the probes are black, and it overwrites a
  good bake in `cache/project/scenario.data.bin` and `irradiance.bin`. Bake in the
  editor window; windowless `--package` reuses that bake.
- **Dark or bright patches where characters stood at bake time:** animated or
  moving objects were included in the GI bake. Set `hiddenForLightBaking: true` on
  them (all objects of the hierarchy) and re-bake.
- **All GI probes are black after a bake:** someone ran `--bake gi` on the command
  line. Bake again in the editor window.
- **`--bake env` with the sky mode is not supported on the command line.** The sky
  environment bakes during packaging instead.
- **Textures missing or packaging fails with many large textures:** the texture
  atlas is full. Increase `rendering.textureAtlasSize` and
  `rendering.compressedTextureAtlasSize`. The atlas is a sparse virtual texture,
  so a larger atlas is cheap.

## Querying

- `query_resources` with no filters on a large scene returns everything. Filter by
  name and use `paths`.
- The `PrimitiveCube` mesh (`p1`) is 2 m wide, not 1 m. The plane `p0` lies in XY
  and faces +Z.

## Publishing

- **`SELF_SIGNED_CERT_IN_CHAIN` when publishing:** a server certificate chains to a
  root that the editor's Node.js 18 does not know (this happened from 14 to
  18 November 2026 for `cloud.wonderland.dev`). The editor's Node.js ignores
  `NODE_EXTRA_CA_CERTS`. The `publish_page` MCP tool adds the system CA bundle and
  the SSL.com 2022 root to its requests, so use it. Report the error to the user;
  the lasting fix is on the server.
- **`ERR_REQUIRE_ESM` from `@wonderlandcloud/cli`:** version 0.2.36 loads the
  ESM-only `uuid@13` with `require()`, which fails on Node.js older than 20.19 and
  on Node.js 18. Run the CLI with system Node.js 20 or newer (22 or newer to be
  safe). The `publish_page` tool works around this.
- **`publish_page` fails with "This project is already published as ...":** the
  project has a `deployment.json` and you passed a different `pageName`. A
  published project is always updated, never published a second time. Call
  `publish_page` without `pageName`. To publish to a different page, the user has
  to delete `deployment.json`. Ask first.
- **`publish_status` stays at `waiting_for_confirmation`:** the user has not
  confirmed in the browser. Give them `confirmUrl`. After 5 minutes the publish
  fails and you start a new one.
