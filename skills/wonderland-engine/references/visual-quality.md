# Making the scene look good and run fast

Wonderland Engine targets the web, including phones and standalone VR headsets.
Every effect costs frame time. Turn effects on deliberately, then check the result
(see [visual-check.md](visual-check.md)).

## How effects are switched on

Most effects need **two** changes:

1. The project setting (`modify_settings`), e.g. `rendering.bloom.enabled`.
2. The matching **pipeline feature** on every pipeline that should use it
   (`modify_resources` on `pipelines`, `changeProperties.features`).

Find the pipelines your materials use:

```json
{"resourceType": "materials", "paths": ["name", "pipeline"]}
```

Then set features on those pipelines, typically "Physical Opaque" and
"Physical Opaque Textured":

```json
{"modifications": [{"resourceType": "pipelines", "id": "<id>", "changeProperties": {"features": {
  "TONEMAPPING": true, "GLOBAL_ILLUMINATION": true, "GLOBAL_ILLUMINATION_PROBE_VOLUME": true,
  "SSAO": true, "SHADOW_PCF": true }}}]}
```

Setting names change between editor versions. Read them with `query_settings`
first.

## Recommended baseline for a good-looking scene

Apply in this order, saving after each step:

| Step | What | How |
| --- | --- | --- |
| 1 | PBR materials | Before importing: `editor.importPhysicalAsPhongMaterials = false`. Otherwise glTF materials come in as Phong. For already imported materials, set `pipeline` to "Physical Opaque Textured"; their `Physical` values are already filled. |
| 2 | Sky | Create a material on the "AtmosphericSky" pipeline (`AtmosphericSky.direction` is the sun direction, `exposure` ~0.5). Set `rendering.sky = {enabled: true, material: <id>}`. |
| 3 | Environment lighting (image-based lighting) | `rendering.environment = {enabled: true, bakingMode: "sky", material: <same sky material>}` and pipeline feature `GLOBAL_ILLUMINATION`. The `material` is required, or packaging fails with "Environment is enabled, but a failure occurred during baking". The first packaging after enabling it can fail even in a window; package again (see the `--bake env` note below). |
| 4 | Sun | An object with a `light` component `{type: "sun", intensity: 3, shadows: true}`, rotated to match the sky's sun direction. Pipeline feature `SHADOW_PCF` softens shadows. |
| 4b | Shadow distance | The sun's `shadowRange` (default 10 m) limits how far from the camera shadows render; beyond it they stop. Set it to the largest distance the camera can see inside the scene (e.g. the room diagonal plus a margin: a 12 x 12 m hall needs about 20 m). Keep `cascadeCount` 4 so near shadows stay sharp. Update it whenever the scene grows. |
| 5 | Tonemapping | `rendering.hdr.tonemapping = "aces"` (or "khronos pbr neutral" for accurate product colors) and pipeline feature `TONEMAPPING`. Without the feature, bright areas clip. |
| 6 | Bloom | `rendering.bloom.enabled = true`. Pair it with emissive materials (`Physical.emissiveColor` above 1) and tonemapping. Keep `threshold` above 1 so only bright areas glow. |
| 7 | Ambient occlusion | `rendering.ssao.enabled = true` and pipeline feature `SSAO`. Grounds objects visually. |
| 8 | Global illumination | Probe volumes, below. |

## Global illumination with probe volumes

Probe volumes bake indirect light (light bouncing off surfaces) into probes, also
for moving and skinned objects. Use them for any scene with enclosed spaces, colored
surfaces, or where objects look pasted on.

1. Create a scenario: `modify_resources` with
   `{"resourceType": "probeVolumeScenarios", "changeProperties": {"name": "Default"}}`.
2. Configure the volume to enclose the scene:
   `gi.probeVolume = {enabled: true, scenario: "<id>", translation: [cx, cy, cz], scaling: [hx, hy, hz], minProbeSpacing: 0.5}`.
   `scaling` is half the size per axis. Take the scene bounds from your layout
   ledger and add a margin.

   The volume must enclose the floor. Probes at floor level or below catch the
   light that bounces off the ground, so extend the volume about 0.5 m below
   ground level, and leave a margin around the scene on all sides. Example, a
   12 x 12 m floor with objects up to about 2 m high:
   `translation: [0, 1.25, 0], scaling: [6.5, 1.75, 6.5]`. The volume then spans
   x and z from -6.5 to 6.5 and y from -0.5 to 3.0.
3. Turn on the pipeline feature `GLOBAL_ILLUMINATION_PROBE_VOLUME`.
3a. **Make the sun strong.** With probe volumes, interiors are lit mostly
   indirectly: sunlight comes in through windows and doors and bounces. A sun of
   intensity 3 leaves rooms dark; use a very strong sun (tens, tune by screenshot
   after a bake) aimed so it actually enters through the openings (direction from
   the opening to a floor spot inside). Control overall brightness with exposure,
   not by weakening the sun.

   **Check the sun's direction visually** before baking: compute the rotation,
   apply it, and ask the user (or look) whether the light falls where planned,
   e.g. on the windowsill and the floor inside the window. A wrongly signed
   direction lights the scene from exactly the opposite side; then rotate the sun
   object by 180° around Y (multiply its rotation by `[0, 1, 0, 0]` from the left).
   Keep the sky material's `AtmosphericSky.direction` pointing towards the sun.

   **Compute both from the sun's elevation `e` and azimuth `a`.** Measure `a`
   from +Z towards +X (a yaw angle). The vector towards the sun is
   `s = [sin(a)*cos(e), sin(e), cos(a)*cos(e)]`.
   - Set the sky material's `AtmosphericSky.direction` to `s`.
   - The sun light must shine along `-s`. Rotate the sun object by yaw and pitch
     so that its light axis points along `-s`. The light axis convention can
     differ from what you expect, so check it visually (see above). If the scene
     lights from the wrong side, rotate the sun object by 180° around Y.

   `query_settings` has no fog setting in 1.6.1.
   A late-afternoon angle (about 20-35° above the horizon) gives longer, more
   interesting light shafts than a high noon sun.
3b. **Point lights and spot lights do not contribute to the GI bake.** Only
   emissive surfaces (and the sky/environment) put light into the probes. For
   every light source that should light the room indirectly (torches, lamps,
   candles, windows), add a small emissive mesh at the light: e.g. sphere `p2`
   scaled to about 0.05-0.1 m, a Physical material with a strong `emissiveColor`
   in the light's colour, pipeline feature `WITH_EMISSIVE`. Keep it in the bake.
   Keep the point light too: it provides the direct light and shadows at runtime.
   The emissive mesh is only needed for the bake; it can double as the visible
   flame or bulb. Bloom does not need it: any bright pixel above the bloom
   threshold glows, e.g. the flame particles.
3c. **Exclude everything that moves from the bake:** animated characters, doors
   that open, vehicles, anything a script moves. Set `hiddenForLightBaking: true`
   on every object of such a hierarchy (the container and all its descendants):
   `modify_objects {"modifications": [{"id": "<id>", ...}]}` does not cover this
   top-level property, so use `modify_resources` with
   `{"resourceType": "objects", "id": "<id>", "changeProperties": {"hiddenForLightBaking": true}}`.
   Baked into the probes, they would leave light and shadow at their bake-time
   position. They still receive GI from the probes at runtime.
4. Call `save_project`, then ask the user to bake. Only the Bake button in the
   editor window produces correct GI data; no MCP tool, command-line flag or
   plugin can start it, and you must not try to automate the click.

   - If the editor runs windowless, ask the user whether you may restart it with
     a window: `save_project`, stop it, start it again without `--windowless`
     (keep `--enable-plugins --server`). Only one editor can run at a time.
   - Tell the user, in one message: "Please open Project Settings, go to the
     Global Illumination section, and press Bake. The bake runs in the background
     and can take several minutes or longer; the editor shows the
     progress. I'll watch for it to finish."

   **Watch that the bake started and the editor stays alive.** The editor logs no
   line when a bake starts (1.6.1), so ask the user to confirm they pressed Bake
   and that the progress bar runs. While waiting, check every poll that the editor
   still runs (its MCP port answers, or the process exists): an editor crash ends
   the bake silently, and the file then never changes. If the editor is gone, tell
   the user at once, restart it, and ask them to bake again.

   **Watch for completion** (all three):

   1. **File (main signal).** `cache/project/<scenario filename>` (default
      `scenario.data.bin`, the `filename` of the `probeVolumeScenarios` resource)
      gets a newer modification time when the bake finishes. Note the time before
      the user presses Bake, then poll it. Do not call MCP tools that change the
      scene while the bake runs.
   2. **Log line (confirmation).** The editor logs `Probe volume baked in <seconds> s`.
      The log file may only be written out with a delay (e.g. at the next
      packaging), so do not wait for it before checking the file. Count the lines
      before the bake and look for one more in the newest log file, or in the
      editor's console output if you started it yourself:

      | Platform | Log folder |
      | --- | --- |
      | Linux, macOS | `~/.WonderlandEngine/logs/` |
      | Windows | `%APPDATA%\WonderlandEngine\logs\` |
   3. **Content.** The file is not all zeros after its 88-byte header, e.g.:

      ```sh
      python3 -c "d=open('cache/project/scenario.data.bin','rb').read()[88:]; print('zero %.1f%%' % (100*d.count(0)/len(d)))"
      ```

      A healthy bake has few zero bytes; 100 % means black probes.

   The bake in the editor window is slow: minutes for a small scene, much longer
   for big scenes or weak machines. There is no fixed timeout. Check less often
   as time passes (every 10 seconds at first, every minute after a few minutes),
   and every 10 minutes or so ask the user for the progress the editor shows,
   instead of assuming it failed. Once all three checks pass, the next packaging includes the new GI data: take a
   screenshot and compare.

   **Never run `WonderlandEditor --windowless --bake gi`** (1.6.1, all platforms):
   it reports "Probe volume baked" and exits with 0, but writes empty data (all
   zeros, so black probes). It also **overwrites a good bake** from the editor
   window. The bake result lives in `cache/project/scenario.data.bin` and
   `cache/project/irradiance.bin`.

   Baking once in the window is enough: later windowless packaging
   (`--windowless --package`) reuses those two files. Keep them (copy them along
   if the project is built elsewhere, e.g. in CI) and re-bake in the window only
   after static geometry or lights changed.

   **Version control:** a plain `cache/` entry in `.gitignore` drops the bake. Pick
   one of two ways:
   - Ignore `cache/` but commit the bake files on purpose: `scenario.data.bin`
     and `irradiance.bin` for GI, and `environment.bin` and
     `environment-mip-*.png` for the sky environment. In `.gitignore` use
     `cache/*` and `!cache/<project-name>/`, then ignore the other files inside that
     folder if you do not want them. Adapt the lines to how the folder is named.
   - Re-bake in the window after every checkout.

   Also ignore `.editor/` (editor UI state).

   The cache subfolder is named after the project (see pitfalls.md, "Renaming the
   project").

5. Re-bake after moving, adding or removing static geometry or lights. An
   out-of-date bake still looks plausible, so it is easy to miss. Do not ask after
   every small change (a bake takes minutes): collect the changes, and ask the
   user to bake **once at the end of the task**, before you report it as done.
   If the scene grew, resize the probe volume first.

`minProbeSpacing` trades quality for download size and bake time: 0.5 m for rooms,
1–2 m for large outdoor areas.

Note: `--bake env` does not support the sky baking mode on the command line. Sky
environments bake during packaging, and only in an editor with a window; a
windowless editor fails packaging with "Environment is enabled, but a failure
occurred during baking". Work with a windowed editor for such projects.

Even in an editor with a window, the first packaging after you enable the sky
environment can still fail with that message. The bake runs within about a
second; package again and it succeeds. A later windowless `--package` reuses the
result from `cache/<project-name>/environment.bin` and
`environment-mip-*.png`. Keep these files like the GI bake files (see "Version
control" above).

## Day-night cycles and changing light at runtime

- **Environment lighting** can be re-baked at runtime from the current sky:
  `this.engine.scene.environment.requestBake()` (JavaScript API, experimental; it
  only takes the sky material into account). Change the sky material's sun
  direction (`AtmosphericSky.direction`) and the sun light's rotation together,
  then request the bake; do not call it every frame.
- **GI probe volumes are static.** For lighting that changes (day and night, lights
  on and off), bake one `probeVolumeScenarios` resource per lighting state in the
  editor (switch `gi.probeVolume.scenario`, bake, repeat; each scenario has its own
  `filename`), then switch at runtime with
  `this.engine.scene.probeVolumeScenario = <scenario>`.

## Meshlets

Meshlets split meshes into small patches that the engine can cull and reduce in
detail. Wonderland Engine has no separate level-of-detail (LOD) system, so meshlets
are how detail gets reduced with distance.

- **When:** the whole scene has **1 million triangles or more**. Then any mesh is
  a candidate, even one with only 5,000 triangles. Below about 1 million triangles
  in total, leave meshlets off.
- **How:** enable meshlets on the pipeline **and** on every mesh drawn with a
  material on that pipeline. Both flags are required:

  ```json
  {"modifications": [
    {"resourceType": "pipelines", "id": "<pipeline id>", "changeProperties": {"meshlets": true}},
    {"resourceType": "meshes", "id": "<mesh id>", "changeProperties": {"meshlets": true}}
  ]}
  ```

  Find the meshes: query the objects' `mesh` components for their `mesh` and
  `material`, and the materials for their `pipeline`.
- Check that packaging succeeds ("Packaging successful!" and a "Meshlets: … kB"
  line in the editor log), then compare a screenshot before and after.

### Counting triangles

No MCP tool reports triangle counts. Estimate them from the source files before
importing:

- With Node.js 20 or newer: `npx -y @gltf-transform/cli inspect model.glb` lists
  every mesh with its vertex and index counts (triangles = indices / 3).
- Otherwise use the bundled script, which needs only Python 3:

  ```sh
  python3 <skill dir>/scripts/count_triangles.py models/*.glb
  ```

  It prints the triangles per file and the total, counting meshes once per use.

Count models you place several times once per copy.

## Mesh simplification

When a mesh is denser than it needs to be and meshlets are not an option (e.g. an
asset seen only from afar, or a VR/mobile budget):

`modify_resources` on `meshes`: `{"simplify": true, "simplifyTarget": 0.5, "simplifyTargetError": 0.02}`.
`simplifyTarget` is the fraction of triangles to keep. Check the silhouette in the
preview afterwards; lower the target in steps (0.5, 0.25) rather than at once.

## Textures and the texture atlas

Wonderland packs all textures into a texture atlas
(`rendering.textureAtlasSize`, default 8192×4096; compressed:
`rendering.compressedTextureAtlasSize`, default 16384×8192). The atlas is a sparse
virtual texture: only the tiles that are actually visible are loaded and resident,
so a larger atlas is cheap.

- **Atlas full.** Many large textures (several 4K PBR sets) do not fit. Packaging
  fails or textures go missing. Fix: increase `rendering.textureAtlasSize` and
  `rendering.compressedTextureAtlasSize` (e.g. double the smaller side).
- **Blurry textures:** an image's `maxSize` is too small for a large, close-up
  surface. Raise it for those images (`modify_resources` on `images`).
- Keep `useTextureStreaming` on; it loads texture detail on demand.

## Things that make scenes look wrong

- Flat, gray look: no environment lighting, or `TONEMAPPING` missing on the
  pipelines.
- Objects look pasted on: no SSAO, no shadows, or no GI.
- Washed-out or over-bright colors: tonemapping off while lights are bright; reduce
  light intensity or enable tonemapping.
- Everything glows: bloom `threshold` below 1.
