import { RecordType, tools } from "@wonderlandengine/editor-api";
import {
  buildLocalLinearRM,
  copyBounds,
  joinBounds,
  mat3IdentityRM,
  mulMat3RM,
  mulMat3Vec3RM,
  transformAabbCornersRM,
} from "./bounds.js";

export interface TreeBoundsResult {
  bounds: Float32Array | null;
  /** Number of descendants (subtree size excluding the root). */
  count: number;
}
/**
 * Recursively computes the axis-aligned bounds for an object subtree and counts descendants.
 * - Mesh bounds are merged per object and transformed by the object's full SRT (scale, rotation, translation).
 * - Child subtree bounds are computed in world space via hierarchical SRT and merged into the parent accumulator.
 * - Handles negative scales and arbitrary rotations via center/extent AABB transform.
 */
export function computeTreeBounds(
  objectId: string,
  objects: Record<string, any>
): TreeBoundsResult {
  // Recursive computation carrying world linear matrix (3x3) and world translation
  const computeRecursive = (
    oid: string,
    parentLinearRM: Float32Array,
    parentTranslation: number[] | Float32Array
  ): TreeBoundsResult => {
    const obj = objects[oid];
    if (!obj) return { bounds: null, count: 0 };

    const localLinearRM = buildLocalLinearRM(obj.rotation, obj.scaling);
    const worldLinearRM = mulMat3RM(parentLinearRM, localLinearRM);
    const localT = obj.translation ?? [0, 0, 0];
    const worldT = mulMat3Vec3RM(parentLinearRM, localT);
    worldT[0] += (parentTranslation as any)?.[0] ?? 0;
    worldT[1] += (parentTranslation as any)?.[1] ?? 0;
    worldT[2] += (parentTranslation as any)?.[2] ?? 0;

    let count = 0;
    const acc = new Float32Array(6);
    const tmp = new Float32Array(6);
    let has = false;

    // Self mesh components (components is an object keyed by index)
    const comps = Object.values(obj.components ?? {}) as any[];
    for (const comp of comps) {
      if (!comp || comp.type !== "mesh") continue;
      const meshId = comp?.mesh?.mesh as string | null;
      if (!meshId) continue;
      try {
        const mb = new Float32Array(6);
        tools.computeMeshBounds(meshId, mb);
        transformAabbCornersRM(tmp, mb, worldLinearRM, worldT);
        if (!has) {
          copyBounds(acc, tmp);
          has = true;
        } else {
          joinBounds(acc, acc, tmp);
        }
      } catch {
        // Ignore compute errors per component
      }
    }

    // Children
    for (const [cid, child] of Object.entries(objects)) {
      if (!child) continue;
      if (String(child.parent) !== String(oid)) continue;
      const { bounds: cb, count: cc } = computeRecursive(
        cid,
        worldLinearRM,
        worldT
      );
      count += 1 + cc; // include the child and its descendants
      if (cb) {
        if (!has) {
          copyBounds(acc, cb);
          has = true;
        } else {
          joinBounds(acc, acc, cb);
        }
      }
    }

    return { bounds: has ? acc : null, count };
  };

  return computeRecursive(objectId, mat3IdentityRM(), [0, 0, 0]);
}

/** Stringify while including defaults on Access objects. */
export function stringifyWithDefaults(
  input: any,
  space?: number | string
): string {
  const seen = new WeakSet();

  const materialize = (v: any): any => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return "[Circular]";
    seen.add(v);

    if (Array.isArray(v)) {
      // Build dense array via inherited/enum indices
      let max = -1;
      for (const k in v) {
        const i = +k;
        if (Number.isInteger(i) && i > max) max = i;
      }
      const len = Math.max(v.length, max + 1);
      const out = new Array(len);
      for (let i = 0; i < len; i++) out[i] = materialize(v[i]);
      return out;
    }

    // Copy own + inherited enumerable keys (triggers interceptors/getters)
    const out: any = {};
    for (const k in v) out[k] = materialize((v as any)[k]);
    return out;
  };

  return JSON.stringify(materialize(input), null, space);
}
