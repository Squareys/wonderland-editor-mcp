# Step-by-step layout worksheet (Track B)

Use this worksheet for every scene change that imports, moves, scales or rotates
objects. Do the steps in order. Write every number down in your reply or notes
before you call a tool. Do not skip a check.

Never place an object "by feel". Every position comes from a calculation below.

## Worksheet A: plan the scene before importing

Write a table with one row per object you will place:

```
name      real size (m)       axis   ground at   target x   target z
table     0.75 high           y      0.0         0.0        0.0
chair     0.9 high            y      0.0         0.0        0.8
lamp      0.5 high            y      0.75        0.3        0.0     (on the table)
```

Check before going on:

- [ ] Every object has a real-world size. If unsure, use: door 2.0 m high, table
      0.75 m high, chair 0.9 m high, person 1.75 m, car 4.5 m long, tree 5 m high.
- [ ] Objects standing on other objects have `ground at` = the top of the lower
      object.

## Worksheet B: import

1. Call `import_scenes` once with all files.
2. For each result, copy into your notes:

```
file          containerId   min                     max
table.glb     4             [-0.6, 0.0, -0.4]       [0.6, 1.5, 0.4]
```

Check: you have one row per file. If a file gave several results, use
`compute_object_bounds` on the `containerId` to get one box for the whole file.

## Worksheet C: compute scale and position (one object at a time)

For one object, write out each line with real numbers:

```
size_y   = max.y - min.y                          = 1.5 - 0.0 = 1.5
s        = real size / size_y                     = 0.75 / 1.5 = 0.5
center_x = (min.x + max.x) / 2                    = (-0.6 + 0.6) / 2 = 0.0
center_z = (min.z + max.z) / 2                    = (-0.4 + 0.4) / 2 = 0.0
pos_x    = target x - s * center_x                = 0.0 - 0.5 * 0.0 = 0.0
pos_y    = ground at - s * min.y                  = 0.0 - 0.5 * 0.0 = 0.0
pos_z    = target z - s * center_z                = 0.0 - 0.5 * 0.0 = 0.0
```

Then predict the final box:

```
final x-range = [target x - s*(max.x-min.x)/2, target x + s*(max.x-min.x)/2] = [-0.3, 0.3]
final y-range = [ground at, ground at + s*size_y]                          = [0.0, 0.75]
final z-range = [target z - s*(max.z-min.z)/2, target z + s*(max.z-min.z)/2] = [-0.2, 0.2]
```

If the size is defined along X or Z instead (e.g. a car's length), replace `size_y`
by `max.x - min.x` or `max.z - min.z` in the second line only.

## Worksheet D: check for overlaps (top view)

Keep a ledger of placed objects. Add the new object's predicted box:

```
name     x-range        z-range        y-range
table    [-0.3, 0.3]    [-0.2, 0.2]    [0.0, 0.75]
chair    [-0.2, 0.2]    [0.6, 1.0]     [0.0, 0.9]
```

For the new object, compare with **every** row whose y-range overlaps:

- x overlap? `new.x_min < old.x_max AND old.x_min < new.x_max`
- z overlap? `new.z_min < old.z_max AND old.z_min < new.z_max`
- If both are "yes", the objects collide. Move the new object's target x or z by
  the overlap plus 0.1 m, and redo Worksheet C for it.

Write the result: "chair vs table: x yes, z no → no collision".

## Worksheet E: apply and verify

1. Call `modify_objects` with `id` = the containerId, `scaling` = `[s, s, s]` and
   `position` = `[pos_x, pos_y, pos_z]`. You can batch several objects in one call.
   For more copies of a placed object, call `duplicate_objects` with its
   containerId and one position per copy (same rotation: same Worksheet C offsets).
2. Call `compute_object_bounds` with the containerIds.
3. Compare each returned box with your predicted box. Differences above 0.01 m mean
   a calculation error: find it in Worksheet C, fix, and apply again.
4. Call `save_project`.

## Worksheet F: rotation (only when needed)

Only use turns around the vertical axis (yaw) by 90° steps unless the user asks for
more:

```
yaw    rotation quaternion            footprint change
0°     [0, 0, 0, 1]                   none
90°    [0, 0.7071, 0, 0.7071]         swap x-size and z-size
180°   [0, 1, 0, 0]                   none
270°   [0, -0.7071, 0, 0.7071]        swap x-size and z-size
```

Apply the rotation together with scaling and position. With 90° or 270°, compute
`pos_x` with `center_z` and `pos_z` with `center_x`, with these signs:

```
90°:   pos_x = target x - s * center_z     pos_z = target z + s * center_x
270°:  pos_x = target x + s * center_z     pos_z = target z - s * center_x
180°:  pos_x = target x + s * center_x     pos_z = target z + s * center_z
```

Then verify with `compute_object_bounds` (Worksheet E). If the box is off, trust
the measured box: shift the position by the difference between the measured and
the planned center.

## Worksheet F2: make an object face a point

For each character or directional prop, write:

```
position p      = (p.x, p.z)                 = (1.0, 2.0)
target t        = (t.x, t.z)                 = (0.0, 0.0)   (table centre)
dx = t.x - p.x                               = -1.0
dz = t.z - p.z                               = -2.0
yaw = atan2(dx, dz) in radians               = atan2(-1.0, -2.0) = -2.678
rotation = [0, sin(yaw/2), 0, cos(yaw/2)]    = [0, -0.973, 0, 0.230]
```

This assumes the model's front is +Z. Look up the asset's forward axis in your
ledger first (it differs per asset; e.g. KayKit chairs face -X): for -X add
90° (π/2) to yaw, for +X subtract 90°, for -Z add 180°. Apply `rotation`
together with the position. Then check
in a top-down screenshot that the front points at the target.

## Worksheet G: final overlap check (always, before saying "done")

1. Write the list of **all** placed containers: walls, corners, pillars, doors,
   floors, props, characters. Count them. If the count is smaller than the
   number of things you imported, find the missing ones first
   (`query_scene_tree` lists what is at the scene root).
2. Call `find_overlaps` with `ignoreNameContains` = the floor's name (e.g.
   `["floor", "ground"]`) and `minGap: 0.3`.
3. For each reported pair, write one line:

```
Knight.glb vs wall_4: overlap [0.21, 1.8, 0.05] → move Knight.glb by 0.05 + 0.3 in z
```

4. Move one object of each pair (Worksheet C, new target x or z), apply, and go
   back to step 2.
5. Only when `find_overlaps` reports no pairs: `save_project`, screenshot,
   report done.

Without `find_overlaps` (older plugin): call `compute_object_bounds` with all
container ids, fill a ledger row for each, and compare every character and prop
with every wall, corner, pillar and door row (y, x and z overlap all "yes" →
COLLISION).

