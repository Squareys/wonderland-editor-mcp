# Importing and laying out a scene (Track A)

Smaller models: use [stepwise-layout.md](stepwise-layout.md) instead.

## The loop

For every model, always:

1. **Import** with `import_scenes`, all files in one call. Keep `containerId` and
   `bounds` for each.
2. **Measure.** `size = max - min` per axis, `center = (min + max) / 2`.
3. **Decide** the real-world size (a chair seat is ~0.45 m high, a door 2 m, a car
   ~4.5 m long, a person 1.75 m). Choose the axis that defines it, usually height (Y).
4. **Scale and place the container:**
   - `s = targetSize / size[axis]`, `scaling = [s, s, s]`
   - `position.x = targetX - s * center.x`
   - `position.y = groundY - s * min.y` (stands on the ground)
   - `position.z = targetZ - s * center.z`
   The model's pivot is rarely at its center or its base, so this correction is
   always needed.
5. **Verify** with `compute_object_bounds` on the container. The result must match
   your plan to a few millimeters. If not, recompute; do not nudge by eye.
6. **Record** the footprint in your scene plan (below).

Imported scenes may contain cameras or lights from the source file. Check the
import's children and remove stray ones.

## Asset specifics to know before placing

- **Skinned characters import in T-pose.** Their bounds include the outstretched
  arms and carried props, so the footprint is about 2.5-3 m wide, not the 0.6 m a
  standing person needs. Place them by measured bounds, keep the extra clearance
  in mind, and check them visually once their animation runs.
- **Template containers stay at the origin.** Every imported file's container is a
  real object. Place every one of them or delete it; forgotten templates at
  (0, 0, 0) end up inside the scene (e.g. a wall standing in the table).
- **Duplicating pieces:** call `duplicate_objects` on the placed container, with
  one entry in `positions` (and `rotations`) per copy. The copies keep the
  container's scaling. Compute each position with the same formula (the scaled
  center offset is the same for every copy with the same rotation), then verify
  with `compute_object_bounds`.
- **Modular kits sit on a grid.** Measure one floor tile and one wall piece: their
  sizes give the grid (KayKit Dungeon: 4 m floor tiles). Use a corner piece's pivot
  as the anchor and snap all structure to the grid.

## The scene plan: two 2D views

Keep a written plan while you build. Reason in two 2D projections instead of in 3D:

- **Top view (X, Z):** the footprint rectangle of every object on the ground.
  Prevents overlaps and blocked walkways.
- **Front view (X, Y):** height ranges. Catches objects floating, sinking into the
  floor, or stacked wrongly.

One line per object:

```
id  name        x-range          y-range        z-range          notes
4   duck        [1.83, 2.17]     [0.00, 0.50]   [-0.31, 0.31]    on ground
6   banner      [-2.23, -1.77]   [0.00, 1.00]   [-0.05, 0.05]    on ground
3   crate       [-1.41, 1.41]    [0.00, 2.00]   [-1.41, 1.41]    rotated 45°
```

**Every** placed object goes into the ledger, including structural pieces: each
wall segment, corner, pillar and doorway. Modular kits add dozens of them; they
are the objects most often forgotten, and the ones characters end up inside.

Two objects on the same level overlap when their x-ranges **and** z-ranges both
overlap. Keep at least 0.1 m between neighbours (more around paths and doors).
Objects placed on top of another use the lower object's `max.y` as their `groundY`.

## Rotation

A rotation changes the footprint. Turning around Y (yaw) by 90° or 270° swaps the
X and Z sizes; other angles make the box bigger (a 2 m cube turned 45° covers
2.83 m). After rotating, take the footprint from `compute_object_bounds`, not from
the unrotated size.

Common yaw quaternions `[x, y, z, w]`: 0° `[0,0,0,1]`, 45° `[0,0.3827,0,0.9239]`,
90° `[0,0.7071,0,0.7071]`, 180° `[0,1,0,0]`, 270° `[0,-0.7071,0,0.7071]`.

## Facing direction

Characters and directional props (chairs, statues, signs) must face something
sensible: the table, the room centre, the camera, each other.

- glTF models face **+Z** in their own space (KayKit and most character packs).
  Check it once per pack with a screenshot before rotating many objects.
- To face a target point from position `p`:
  `dx = target.x - p.x`, `dz = target.z - p.z`, `yaw = atan2(dx, dz)`,
  rotation `[0, sin(yaw/2), 0, cos(yaw/2)]` on the container.
- Chairs face the table; a seated character uses the chair's yaw.
- After rotating, re-measure the footprint (rotation changes it) and check the
  result visually from above (see the visual-check reference).

## Camera and framing

- The object with the `view` component is the camera. A new project made with
  `--create` has none; add one, or packaging fails.
- Place the camera so the scene's region of interest fits: for a scene `w` meters
  wide and a horizontal field of view of 70°, a distance of about `0.75 * w` from
  its front edge frames it.
- Eye height for a standing viewer is 1.6 m.

## Floors and walls

The plane primitive `p0` is 2×2 m in X and Y and faces +Z. For a floor, rotate it
by -90° around X (`[-0.7071, 0, 0, 0.7071]`) and scale X and Y by half the desired
size (a 12×12 m floor: `scaling [6, 6, 1]`).

## Final overlap check (mandatory)

Before reporting a layout as done, and after every change that moves things:

1. Call `find_overlaps` with `ignoreNameContains` set to the floor's name (e.g.
   `["floor", "ground"]`) and `minGap: 0.1`. It tests every container at the
   scene root against every other one, in world space.
2. Fix **every** reported pair: move one of the two by the `overlap` on the
   cheapest axis plus the gap you want. Objects meant to touch (a cup on a
   table, a wall on the floor) only touch along one face and are not reported;
   anything that reaches **into** a wall, pillar or another prop is an error.
3. Call `find_overlaps` again. Repeat until it reports no pairs.
4. Walls are thin: characters and props keep at least 0.3 m to them on the room
   side. Check with a second call: `objectIds` = the characters, props and walls,
   `minGap: 0.3`.
5. Characters need extra care: their bounds include weapons, capes and arms, and
   their pivot is often not at the feet's center. Place them by measured bounds.
6. Take a screenshot from inside the room and look along the walls.

Without `find_overlaps` (older plugin): call `compute_object_bounds` with the ids
of all placed containers in one call and test every pair whose y-ranges overlap
for x and z overlap (see "The scene plan").

