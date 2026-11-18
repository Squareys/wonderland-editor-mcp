# Animations and JavaScript components

## Skeletal animations

Animated characters (e.g. KayKit Adventurers) import with a skin and all their
clips as `animations` resources. One character file can bring dozens of clips;
the same clip name exists once per imported file.

1. Find the clips of one character:
   `query_resources {"resourceType": "animations", "paths": ["name", "link"]}`.
   `link.file` is the source file; use the clips from the character's own file.
2. Check the component's property names in this editor version:
   `query_component_types {"names": ["animation"]}`.
3. Add an `animation` component to the character's **armature root object** (for
   KayKit: the child named `Rig`), not to the import container:

   ```json
   {"modifications": [{"id": "<Rig object id>", "addComponents": [{"type": "animation",
     "properties": {"animation": "<animation id>", "autoplay": true, "playCount": 0}}]}]}
   ```

   `playCount: 0` loops. No `skin` property was needed for KayKit characters.
4. Verify that it plays: two screenshots a few seconds apart must differ; a
   character in T-pose did not start its animation (see visual-check.md).
5. Exclude animated characters from GI bakes (`hiddenForLightBaking`, see
   visual-quality.md).

Pick clips that fit the scene, e.g. idle loops for standing characters, seated
loops (`Sit_Chair_Idle`) for characters on chairs (place them on the chair and
check the hips line up), and give characters different clips so the scene does
not look cloned.

## Blending between two animations

Switching clips by replacing `animation` cuts hard. For smooth transitions
(e.g. idle while the camera looks elsewhere, action when it looks at the
character), use a 1D blend:

1. On the `animation` component set
   `{"blendType": "blend1D", "blendFactor": 0, "blendAnimations": {"animations": ["<idle id>", "<action id>"], "playbackSpeeds": [1, 1]}}`
   (`modifyComponents`). The editor generates an animation graph per component;
   the packaging log counts them ("Packaging N animation graphs").
2. At runtime, set the graph's float parameter `blendFactor` (0 = first clip,
   1 = second) from a component: `animation.setFloatParameter("blendFactor", x)`.
   Ramp it over ~0.5 s instead of jumping.
3. `scripts/shot-animation.js` in this skill does this based on the current shot of
   a camera sequence (it reads `shot`, 1-based, from the `camera-sequence`
   component); copy it into the project's `js/` folder.

Give each character its own idle/action pair and different action shots, so
they do not all move in sync.

## JavaScript components

Project code lives in the project's source folder (the `scripting.components`
settings: by default `js/`, entry `js/index.js`). Write components as ES modules
using `@wonderlandengine/api`:

```js
import { Component, Property } from "@wonderlandengine/api";

export class MyComponent extends Component {
  static TypeName = "my-component";
  static Properties = {
    speed: Property.float(1.0),
    target: Property.object(),
  };
  update(dt) {
    /* ... */
  }
}
```

- The editor detects new component files in the source folder and registers
  them; the log shows `[js] Added my-component`. Check with
  `query_component_types {"names": ["my-component"]}` before adding the component
  with `modify_objects`.
- `Property.enum(["a", "b"], "a")` gives the component the **index** of the
  value (0, 1, ...), not the string. Compare with the index, or map it back
  through the same array.
- The editor loads component modules itself (without a browser) to read their
  properties. Code at module top level must not touch browser APIs (`window`,
  `document`, `addEventListener`); otherwise the editor logs "Error parsing
  components from sources" and stops seeing new properties. Do such setup in
  `start()` or `init()`, or guard it (`typeof window !== "undefined"`).
- Add a small on-page error overlay during development (catch `window.onerror`,
  `unhandledrejection` and `console.error`, show them in a visible element),
  so runtime errors are visible to the user and in screenshots without DevTools.
- The editor bundles the code with esbuild on save. Watch the editor log for
  bundling errors and the browser console (Playwright) for runtime errors.
- Saving a code file repackages the project; see the "no browser connected"
  rule in visual-check.md.
- **Check and test game logic without a browser.** The Flatpak's bundled Node
  can syntax-check a file:
  `flatpak run --command=node --filesystem=<project dir> com.wonderlandengine.editor --check js/file.js`.
  For ES modules, `package.json` needs `"type": "module"`. Small Node scripts can
  also simulate game logic (for example a whole race) to test it.
- **`ViewComponent.fov` is the horizontal field of view in degrees.** three.js
  uses a vertical one. When porting, convert with the aspect ratio:
  `horizontal = 2 * atan(tan(vertical / 2) * aspect)`.

## Particles (fire, sparks, dust)

Particles are quick to add; do not skip them. The simplest robust route is
**mesh particles**, as in the Wonderland Engine examples: a component that keeps a
small pool (10-30) of child objects with a `mesh` component (a tiny sphere or
quad with a bright emissive or Flat material), spawns them at the emitter, moves
them (fire: up 0.3-0.5 m/s with random drift), shrinks or fades them over their
lifetime (0.5-1 s for flames) and recycles them. Check first whether the project
or `@wonderlandengine/components` already provides such a component (e.g.
`mesh-particles`); otherwise write a small one (see "JavaScript components").
The built-in `particleEffects` resource only has `mesh`, `material` and `maxCount`
(1.6.1), so on its own it cannot make a moving flame; use mesh particles.

For magic effects, make the motion read as magic, not as fire: orbiting,
spiralling particles on tilted, counter-rotating rings (`scripts/magic-vortex.js`
in this skill) instead of rising embers.

Pair torch particles with a point light (direct light at runtime) and, when the
project uses a GI probe volume, an emissive flame mesh (only for the bake; see
visual-quality.md). Bloom needs no extra mesh: bright particles (emissive or Flat
material with colour values above the bloom threshold) glow by themselves.

## Camera, exposure

- The camera is the object with the `view` component. Its exposure can be set at
  runtime: `this.object.getComponent("view").exposure = <value>` (used e.g. for
  per-shot exposure in a camera sequence).
- A camera sequence can be built as a component that copies the transform of
  marker objects (empty objects placed like cameras) in turn, with hard cuts
  between shots and an optional slow move from a start to an end marker.
