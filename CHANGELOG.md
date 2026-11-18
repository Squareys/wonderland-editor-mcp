# Changelog

## 1.2.1 (unreleased)

### Changed

- `publish_page` uploads in a separate Node.js process (much faster than inside
  the editor). If no Node.js executable is found, it uploads in the editor as before.

### Fixed

- `duplicate_objects` no longer reports read-only `resourceId`/`resourceKey`
  properties.

## 1.2.0

### Added

- `save_project` tool (Wonderland Editor 1.6.0+). Changes were previously only kept
  in memory and autosaves.
- `open_preview` tool to open the live preview in the default browser.
- `probeVolumeScenarios` and `audioClips` resource types.
- Agent skill in `skills/wonderland-engine`.
- `find_overlaps` tool: pairs of objects whose world-space subtree bounds
  intersect (or are closer than `minGap`), sorted by overlap volume.
- `duplicate_objects` tool: deep-copies objects with descendants and components,
  with a transform per copy. References inside the copied subtree (parents,
  skins, animation retargeting, object properties of JavaScript components) point
  to the copies.
- `query_scene_tree` tool: compact indented object hierarchy with component types.
- `modify_objects` accepts `hiddenForLightBaking`.
- `publish_page` and `publish_status` tools to publish the project to Wonderland
  Cloud Pages. The user confirms in the browser, the upload runs in the background.
  The state is kept in `deployment.json`, in the same format as the editor's
  built-in publish plugin, so a published project is always updated and never
  published twice.

### Changed

- `modify_objects` and `modify_resources` return the id, name and whether the item
  was created, instead of "Done.".
- `query_resources` always includes `id` when `paths` is given.
- `modify_objects` rejects unknown keys with an error naming the key, instead of
  ignoring them.
- `compute_object_bounds` returns world-space bounds by default (all ancestors'
  transforms included). `space: "parent"` gives the previous behaviour.
- `publish_page` requires `access` for a first publish, so that the agent asks
  the user whether the page is unlisted or public.
- Unsupported resource types report a clear error.

### Fixed

- Connecting failed with "crypto is not defined" in the editor's Node.js 18 runtime
  with current versions of the MCP SDK.
- Bounds of rotated objects were mirrored (the rotation matrix was transposed).
- Changes were applied in reverse order when several arrived in the same frame.
- A port that is already in use was reported as a running server.
- Failed packaging caused an unhandled promise rejection.
- `excludeFilter.name` kept matching resources instead of excluding them.
- `query_component_types` was not available with editor-api 1.5.
- `compute_mesh_bounds` returned objects instead of arrays.
- `removeComponents` sorted indices as strings.
- `import_files` did not wait for files to load.
- `delete_objects` threw on unknown ids.
- Publishing failed with `SELF_SIGNED_CERT_IN_CHAIN` on the editor's Node.js 18:
  `cloud.wonderland.dev` chains to "SSL.com TLS RSA Root CA 2022", which that
  Node.js did not trust (14-18 November 2026, fixed on the server since). The plugin
  adds that root and the system CA bundle to its requests, in case it happens again.
- `@wonderlandcloud/cli` 0.2.36 could not be loaded on Node.js 18 (`ERR_REQUIRE_ESM`
  from `uuid@13`). The plugin loads it with a workaround.
