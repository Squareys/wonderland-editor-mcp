#!/usr/bin/env python3
"""Estimate triangle counts of glTF/GLB files, without dependencies.

Usage: python3 count_triangles.py model.glb [more.glb scene.gltf ...]

Counts each mesh once per node that uses it (instances count), so the total is
what the scene draws. Only triangle-list primitives (mode 4, the default) are
counted as triangles; strips and fans are approximated.
"""
import json
import struct
import sys


def load_gltf_json(path):
    with open(path, "rb") as f:
        data = f.read()
    if data[:4] == b"glTF":
        # GLB: 12 byte header, then chunks of (length, type, data)
        offset = 12
        while offset < len(data):
            length, ctype = struct.unpack_from("<II", data, offset)
            if ctype == 0x4E4F534A:  # "JSON"
                return json.loads(data[offset + 8 : offset + 8 + length])
            offset += 8 + length
        raise ValueError("no JSON chunk")
    return json.loads(data)


def primitive_triangles(gltf, prim):
    accessors = gltf.get("accessors", [])
    if "indices" in prim:
        count = accessors[prim["indices"]]["count"]
    else:
        count = accessors[prim["attributes"]["POSITION"]]["count"]
    mode = prim.get("mode", 4)
    if mode == 4:
        return count // 3
    if mode in (5, 6):  # triangle strip / fan
        return max(count - 2, 0)
    return 0  # points and lines


def count(path):
    gltf = load_gltf_json(path)
    meshes = gltf.get("meshes", [])
    per_mesh = [sum(primitive_triangles(gltf, p) for p in m.get("primitives", [])) for m in meshes]
    uses = [0] * len(meshes)
    for node in gltf.get("nodes", []):
        if "mesh" in node:
            uses[node["mesh"]] += 1
    if not any(uses):
        uses = [1] * len(meshes)
    total = sum(t * u for t, u in zip(per_mesh, uses))
    return total, len(meshes)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    grand = 0
    for path in sys.argv[1:]:
        try:
            total, meshes = count(path)
        except Exception as e:  # report and continue with the other files
            print(f"{path}: error: {e}")
            continue
        grand += total
        print(f"{path}: {total} triangles in {meshes} meshes")
    print(f"total: {grand} triangles")
    return 0


if __name__ == "__main__":
    sys.exit(main())
