# Making the scene look good and run fast

Turn effects on deliberately, then check the result
(see [visual-check.md](visual-check.md)). Budget like a native engine on the same
target device (see the preface in SKILL.md); phones and standalone VR headsets need
lighter settings than desktops.

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

To get a pipeline that does not exist yet (for example transparent with
blending, or with vertex colours), create one with `modify_resources` on
`pipelines`. Copy the shader of an existing pipeline (query it first), then set
`features` and the blending.

Flat pipelines with the `TONEMAPPING` feature darken sRGB colours. Leave
`TONEMAPPING` off on Flat pipelines used for UI or unlit colours, or brighten the
colours to compensate.

Setting names change between editor versions. Read them with `query_settings`
first.

## Recommended baseline for a good-looking scene

Apply in this order, saving after each step:

| Step | What | How |
| --- | --- | --- |
| 1 | PBR materials | Before importing: `editor.importPhysicalAsPhongMaterials = false`. Otherwise glTF materials come in as Phong. For already imported materials, set `pipeline` to "Physical Opaque Textured"; their `Physical` values are already filled. |
| 2 | Sky | Create a material on the "AtmosphericSky" pipeline (`AtmosphericSky.direction` is the sun direction, `exposure` ~0.5). Set `rendering.sky = {enabled: true, material: <id>}`. |
| 3 | Environment lighting (image-based lighting) | `rendering.environment = {enabled: true, bakingMode: "sky", material: <same sky material>}` and pipeline feature `GLOBAL_ILLUMINATION`. The `material` is required, or packaging fails with "Environment is enabled, but a failure occurred during baking". Bakes only in an editor with a window; see "Sky environment bake" below. |
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

### 1. Set up the volume

1. Create a scenario: `modify_resources` with
   `{"resourceType": "probeVolumeScenarios", "changeProperties": {"name": "Default"}}`.
2. Configure the volume to enclose the scene:
   `gi.probeVolume = {enabled: true, scenario: "<id>", translation: [cx, cy, cz], scaling: [hx, hy, hz], minProbeSpacing: 0.5}`.
   `scaling` is half the size per axis. Take the scene bounds from your layout
   ledger and add a margin on all sides. Extend the volume about 0.5 m below
   ground level: probes at floor level catch the light that bounces off the
   ground. Example, a 12 x 12 m floor with objects up to about 2 m high:
   `translation: [0, 1.25, 0], scaling: [6.5, 1.75, 6.5]` (x and z from -6.5 to
   6.5, y from -0.5 to 3.0).
3. Turn on the pipeline feature `GLOBAL_ILLUMINATION_PROBE_VOLUME`.

`minProbeSpacing` trades quality for download size and bake time: 0.5 m for rooms,
1-2 m for large outdoor areas.

### 2. Light sources for the bake

- **Make the sun strong.** With probe volumes, interiors are lit mostly
  indirectly: sunlight comes in through windows and doors and bounces. A sun of
  intensity 3 leaves rooms dark; use a very strong sun (tens, tune by screenshot
  after a bake) aimed so it actually enters through the openings. Control overall
  brightness with exposure, not by weakening the sun. A late-afternoon angle
  (about 20-35° above the horizon) gives longer light shafts than a noon sun.
- **Compute the sun from its elevation `e` and azimuth `a`** (`a` measured from
  +Z towards +X, like a yaw). The vector towards the sun is
  `s = [sin(a)*cos(e), sin(e), cos(a)*cos(e)]`. Set the sky material's
  `AtmosphericSky.direction` to `s`, and rotate the sun object (yaw and pitch) so
  that its light shines along `-s`.
- **Check the sun's direction visually before baking.** The light axis convention
  can differ from what you expect. Look (or ask the user) whether the light falls
  where planned, e.g. on the windowsill and the floor inside the window. If the
  scene is lit from the opposite side, rotate the sun object by 180° around Y
  (multiply its rotation by `[0, 1, 0, 0]` from the left).
- **Point and spot lights do not contribute to the bake.** Only emissive surfaces
  and the sky/environment put light into the probes. For every light source that
  should light the room indirectly (torches, lamps, candles), add a small emissive
  mesh at the light: e.g. sphere `p2` scaled to 0.05-0.1 m, a Physical material
  with a strong `emissiveColor` in the light's colour, pipeline feature
  `WITH_EMISSIVE`. Keep the point light as well: it gives the direct light and
  shadows at runtime. The emissive mesh can double as the visible flame or bulb.
  Bloom does not need it: any pixel above the bloom threshold glows, e.g. flame
  particles.

`query_settings` has no fog setting in 1.6.1.

### 3. Exclude everything that moves

Animated characters, doors that open, vehicles, anything a script moves: set
`hiddenForLightBaking: true` with `modify_objects` on every object of such a
hierarchy (the container and all its descendants). Baked into the probes, they
would leave light and shadow at their bake-time position. They still receive GI
from the probes at runtime.

### 4. Bake (the user presses the button)

Call `save_project`, then ask the user to bake. Only the Bake button in the editor
window produces correct GI data. No MCP tool, command-line flag or plugin can start
it, and you must not try to automate the click.

- If the editor runs windowless, ask the user whether you may restart it with a
  window: `save_project`, stop it, start it again without `--windowless` (keep
  `--enable-plugins --server`).
- Tell the user, in one message: "Please open Project Settings, go to the Global
  Illumination section, and press Bake. The bake runs in the background and can
  take several minutes or longer; the editor shows the progress. I'll watch for
  it to finish."
- Do not call MCP tools that change the scene while the bake runs.

**Never run `WonderlandEditor --windowless --bake gi`** (1.6.1, all platforms). It
reports "Probe volume baked" and exits with 0, but writes all zeros (black probes),
and it overwrites a good bake from the editor window.

**Watch that the bake started and the editor stays alive.** The editor logs no line
when a bake starts (1.6.1), so ask the user to confirm they pressed Bake and that
the progress bar runs. On every poll, check that the editor still runs (its MCP
port answers, or the process exists): a crash ends the bake silently. If the editor
is gone, tell the user at once, restart it, and ask them to bake again.

**Watch for completion** (all three):

1. **File (main signal).** `cache/<project-name>/<scenario filename>` (default
   `scenario.data.bin`, the `filename` of the `probeVolumeScenarios` resource)
   gets a newer modification time. Note the time before the user presses Bake,
   then poll it.
2. **Log line (confirmation).** The editor logs `Probe volume baked in <seconds> s`.
   The log file can be written with a delay, so do not wait for it before checking
   the file. Count the lines before the bake and look for one more in the newest
   log file (or the console output, if you started the editor):

   | Platform | Log folder |
   | --- | --- |
   | Linux, macOS | `~/.WonderlandEngine/logs/` |
   | Windows | `%APPDATA%\WonderlandEngine\logs\` |
3. **Content.** The file is not all zeros after its 88-byte header:

   ```sh
   python3 -c "d=open('cache/<project-name>/scenario.data.bin','rb').read()[88:]; print('zero %.1f%%' % (100*d.count(0)/len(d)))"
   ```

   A healthy bake has few zero bytes; 100 % means black probes.

The bake is slow: minutes for a small scene, much longer for big scenes or weak
machines. There is no fixed timeout. Poll less often as time passes (every 10
seconds at first, every minute after a few minutes), and every 10 minutes or so ask
the user for the progress the editor shows instead of assuming it failed. Once all
three checks pass, the next packaging includes the new GI data: take a screenshot
and compare.

### 5. Keep the bake

The bake lives in `cache/<project-name>/scenario.data.bin` and `irradiance.bin`.
The folder name is the kebab-cased project name (`MyGame` gives `cache/my-game/`).

- Renaming the project (`settings.project.name`) switches to a new, empty cache
  folder and the bake is lost. Set the name before baking, or copy the files into
  the new folder and restart the editor.
- Baking once is enough; every later packaging reuses these files. Package (and
  publish) GI projects from an editor with a window: a windowless editor fails
  with "Found probe volume scenario with no filename" (1.6.1).
- **Version control:** a plain `cache/` entry in `.gitignore` drops the bake.
  Either ignore `cache/*` but keep `!cache/<project-name>/` (then ignore the other
  files in it if you like), committing `scenario.data.bin`, `irradiance.bin`,
  `environment.bin` and `environment-mip-*.png`; or re-bake in the window after
  every checkout. Also ignore `.editor/` (editor UI state).

### 6. Re-bake when static geometry or lights change

An out-of-date bake still looks plausible, so it is easy to miss. Do not ask after
every small change (a bake takes minutes): collect the changes and ask the user to
bake **once at the end of the task**, before you report it as done. If the scene
grew, resize the probe volume first.

## Sky environment bake

The sky environment (baseline step 3) bakes during packaging, and only in an editor
with a window. A windowless editor fails with "Environment is enabled, but a
failure occurred during baking", and `--bake env` does not support the sky mode.
Even in a window, the first packaging after enabling it can fail with that message;
package again and it succeeds. The result is stored in
`cache/<project-name>/environment.bin` and `environment-mip-*.png`; keep these
files like the GI bake files.

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
