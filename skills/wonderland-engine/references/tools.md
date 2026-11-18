# MCP tool reference

All tools take arrays where it makes sense. Batch your changes. Every change is
applied on the editor's next frame, then the project is repackaged and the preview
reloads.

Text results are JSON, one `content` item per result. Parse each item separately.

## Reading

### `query_resources`

```json
{
  "resourceType": "objects",
  "ids": ["3"],
  "includeFilter": { "name": "Duck" },
  "excludeFilter": { "parent": null },
  "paths": ["name", "translation", "components"]
}
```

- `resourceType`: `objects`, `meshes`, `materials`, `textures`, `images`,
  `pipelines`, `shaders`, `animations`, `skins`, `fonts`, `morphTargets`,
  `particleEffects`, `probeVolumeScenarios`, `audioClips`.
- `includeFilter.name` / `excludeFilter.name` match by substring. Other keys match
  exactly. `"parent": null` in `excludeFilter` drops root objects.
- `paths` limits the output to those properties. The `id` is always included.
- Components come back keyed by their type:
  `{"type": "light", "light": {"intensity": 3}}`. Writing them takes a `properties`
  key instead (see `modify_objects`).

### `query_settings`

`{"paths": ["rendering.bloom", "gi"]}`. Returns the settings with defaults filled in.
Call it before `modify_settings` to learn the exact names in this editor version.

### `query_component_types`

`{"names": ["light"]}`. Lists component types with their property names and types,
including the project's own JavaScript components. Use it before adding a
component you have not used before.

### `query_scene_tree`

`{"rootId": "4", "depth": 2, "includeComponents": true}`, all optional. Returns one
text block, one line per object: `id name [component types] (n children)`,
indented by level. Without `rootId` it starts at the scene root. Children below
`depth` (default 2) are only counted. Capped at 500 lines. Use it to find ids and
the structure of imports before querying details with `query_resources`.

### `compute_mesh_bounds`

`{"meshIds": ["p1"]}` → `{"id": "p1", "min": [-1,-1,-1], "max": [1,1,1]}`. Local
mesh space, without any object transform.

### `compute_object_bounds`

`{"objectIds": ["4"], "space": "world"}` → `{"id": "4", "count": 1, "bounds": {"min": [...], "max": [...]}}`.
Bounds of the object and all its children. `space` is `"world"` by default: all
transforms, including the parents', are applied. `"parent"` includes the object's
own translation, rotation and scaling and those of its children, but **not**
those of its parents. Unknown ids return `"bounds": null, "error": "not found"`.

### `find_overlaps`

```json
{ "minGap": 0.1, "ignoreNameContains": ["floor", "ground"], "touchTolerance": 0.01 }
```

All arguments are optional. Tests the world-space bounds of every object at the
scene root (or of `objectIds`, each with its subtree) against each other. Objects
without meshes and ancestor/descendant pairs are skipped; `ignoreIds` and
`ignoreNameContains` (case-insensitive) leave objects out. Returns a summary line,
then one item per pair, largest overlap volume first (at most 100):

```json
{ "a": {"id": "12", "name": "Knight.glb"}, "b": {"id": "30", "name": "wall"}, "overlap": [0.21, 1.8, 0.05] }
```

`overlap` is the intersection depth per axis `[x, y, z]`; negative means
separated. Intersections up to `touchTolerance` (default 0.01 m) on any axis
count as touching, not overlapping. With `minGap` > 0, pairs whose height ranges
overlap and whose footprints are closer than `minGap` are reported too, with
`gap` (horizontal distance in m, 0 when touching).

## Changing

### `modify_objects`

Creates an object when `id` is left out; changes it otherwise. Properties you leave
out stay as they are.

```json
{
  "modifications": [
    {
      "name": "Lamp",
      "parentId": "4",
      "position": [0, 2, 0],
      "rotation": [0, 0, 0, 1],
      "scaling": [1, 1, 1],
      "addComponents": [{ "type": "light", "properties": { "type": "point", "intensity": 5 } }]
    },
    { "id": "3", "modifyComponents": [{ "index": 0, "properties": { "material": "5" } }] },
    { "id": "7", "removeComponents": [1] }
  ]
}
```

Returns one `{"id", "name", "created"}` per modification. Keep the ids.

`parentId` also works on an existing object: it reparents the object. Setting a
resource reference (for example `material`) to an id that does not exist does not
fail. It silently stores an empty reference. Check the id with `query_resources`
first.

`hiddenForLightBaking: true` excludes the object from GI baking.

`modify_objects` only knows the keys shown above, plus `hiddenForLightBaking`, and
**rejects** others with an error naming the key. To set other object properties,
use `modify_resources` with `"resourceType": "objects"`:
`{"resourceType": "objects", "id": "<id>", "changeProperties": {"<key>": ...}}`.

Material properties are grouped by shader: `Physical.albedoColor`,
`Physical.emissiveColor`, `Phong.diffuseColor`, `Flat.color`, ... A wrong group or
name fails with "Path does not exist"; query an existing material first. Colour
values above 1 are allowed (HDR) and drive bloom.

### `duplicate_objects`

```json
{
  "duplicates": [
    { "sourceId": "30", "positions": [[4, 0, 0], [8, 0, 0]], "rotations": [[0, 0.7071, 0, 0.7071], [0, 0, 0, 1]] },
    { "sourceId": "12", "count": 1, "parentId": null, "name": "Knight 2", "positions": [[2, 0, 1]] }
  ]
}
```

Deep-copies each source with all descendants: names, transforms,
`hiddenForLightBaking` and every component with its properties. Copy `i` gets
`positions[i]`, `rotations[i]` and `scalings[i]` (missing entries: the source's
value); `count` defaults to the longest of those arrays, or 1. The copies go under
the source's parent unless `parentId` is given (`null`: scene root). Meshes,
materials and animations are shared. References inside the copied subtree point
to the copies: skins are copied, animation components retarget onto the copy's
skin, and object properties of JavaScript components are remapped when their
type is known. Returns one `{"sourceId", "id", "name"}` per copy, then `Note:`
items about anything that could not be copied. Place copies of an imported model
by copying its **container**.

### `modify_resources`

Same pattern for everything except objects. Leave out `id` to create.

```json
{
  "modifications": [
    {
      "resourceType": "materials",
      "changeProperties": {
        "name": "Painted Metal",
        "pipeline": "12",
        "Physical": { "albedoColor": [0.8, 0.1, 0.1, 1], "metallicFactor": 1, "roughnessFactor": 0.4 }
      }
    },
    { "resourceType": "pipelines", "id": "12", "changeProperties": { "features": { "TONEMAPPING": true } } }
  ]
}
```

Returns `{"resourceType", "id", "name", "created"}` per modification.

### `modify_settings`

`{"changeSettings": {"rendering": {"bloom": {"enabled": true}}}, "resetPaths": ["rendering.hdr.tonemapping"]}`.
Nested objects are merged, not replaced.

### `delete_objects`

`{"objectIds": ["5", "6"]}`. Deletes the objects. Reports ids that did not exist.

## Importing

### `import_scenes`

`{"imports": [{"path": "models/house.glb"}, {"path": "models/tree.glb"}]}`. Paths
are relative to the project file. Prefer GLB, then FBX, glTF, OBJ, PLY.

For each file, the tool creates a container object named after the file and
imports under it. It returns one entry per imported root:

```json
{ "id": "5", "rootId": "5", "containerId": "4", "count": 12,
  "bounds": { "min": [-1.98, -0.04, -3.58], "max": [1.98, 5.77, 3.58] } }
```

`count` is the number of descendants of that root. It is 0 for a single-object
root and for files with several roots. Do not use it as a node count of the file.

Files with several roots return several entries, one per root. Group them by
`containerId`.

A texture shared by several files of one kit (for example a colormap) is imported
once per file. That gives duplicate images, textures and materials, and all of
them are packaged. To avoid the duplicates, point the meshes to one material with
`modify_objects` (`modifyComponents`). No tool deletes resources, only objects,
so the unused copies stay in the project.

The bounds are in the container's space. Place and scale the **container**
(`containerId`), not the root. See the layout reference.

### `import_files`

`{"imports": ["textures/wood.png"]}`. Imports images and other non-scene files.

## Project

### `save_project`

Saves the `.wlp`. Changes are only in the editor's memory (and its autosaves in
`.autosave/`) until you save. **Call it after every finished step.** Available with
Wonderland Editor 1.6 and newer.

### `open_preview`

Opens the live-reloading preview in the user's browser. Use it once the scene has
something to show.

### `publish_page`

Publishes the project to Wonderland Cloud Pages. **Call it only when the user asked
to publish, and ask them for the page name and access first.** Arguments:
`pageName` (optional; 2-22 characters: lowercase letters, digits, single hyphens,
starts and ends with a letter; default is the project name) and `access`
(`"unlisted"` or `"public"`). `access` is required for a first publish; updates
keep the stored access unless given.

The tool packages the project and opens the user's browser, where they sign in and
confirm. It then uploads in the background and returns at once with a state object.
Only one publish runs at a time. A project with a `deployment.json` is always
updated; a different `pageName` is an error. Full flow in
[publish.md](publish.md).

### `publish_status`

No arguments. Returns the state of the current or last publish: `idle`, `packaging`,
`waiting_for_confirmation` (with `confirmUrl`), `uploading`, `done` (with `url`) or
`failed` (with `error`). Poll this tool until `done` or `failed`. Never call
`publish_page` again to poll.

## Ids of built-in resources

These exist in every project:

| Kind | Ids |
| --- | --- |
| Primitive meshes | `p0` plane (2×2 m in XY, facing +Z), `p1` cube (2 m), `p2` sphere (radius 1), `p3` cone, `p4` cylinder, `p5` circle |
| Pipelines (about 19 in 1.6.1; look up by name, ids may differ) | e.g. "Physical Opaque", "Physical Opaque Textured", "Phong Opaque", "Phong Opaque Textured", "Flat Opaque", "AtmosphericSky", "Sky", "Text", "Particle", "Foliage" |

Look pipelines up with
`query_resources {"resourceType": "pipelines", "paths": ["name"]}` instead of
assuming ids.
