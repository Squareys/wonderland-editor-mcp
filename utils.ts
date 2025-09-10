import { tools } from "@wonderlandengine/editor-api";
import {
  buildLocalLinearRM,
  copyBounds,
  joinBounds,
  mat3IdentityRM,
  mulMat3RM,
  mulMat3Vec3RM,
  transformAabbCornersRM,
} from "./bounds.js";

export function isObject(item: any): item is Record<string, any> {
  return item && typeof item === "object" && !Array.isArray(item);
}

export function assignNested(
  target: Record<string, any>,
  source: Record<string, any>,
): void {
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      if (isObject(source[key]) && isObject(target[key])) {
        assignNested(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
  }
}

/**
 * Assigns properties to a component, ensuring type and length consistency.
 *
 * @param typeName Name of the component type
 * @param comp Component properties
 * @param properties Properties to assign to the component
 * @param o Object containing the component
 */
export function assignComponentProperties(
  typeName: string,
  comp: any,
  properties: Record<string, any>,
  o: { name: string },
  index: number = 0,
) {
  for (const key of Object.keys(comp)) {
    if (key in properties) {
      if (typeof comp[key] !== typeof properties[key]) {
        throw new Error(
          `Type mismatch for property ${key} in component ${
            comp.type
          } of object ${o.name}. Expected ${typeof comp[
            key
          ]}, got ${typeof properties[key]}`,
        );
      }
      if (
        Array.isArray(comp[key]) &&
        properties[key].length !== comp[key].length
      ) {
        throw new Error(
          `Length mismatch for property '${key}' in '${typeName}' component with index ${index} of object "${o.name}". Expected length ${comp[key].length}, got ${properties[key].length}`,
        );
      }
      comp[key] = properties[key];
    }
  }
}

/**
 * Filters the properties of an object based on the provided filters.
 * @param filters List of property paths to filter by, e.g. "physics.enabled"
 */
export function filterObjectProperties(
  filters: string[] | undefined,
  o: any,
): any {
  if (!filters || filters.length === 0) {
    return o;
  }

  const result: Record<string, any> = {};
  for (const filter of filters) {
    const keys = filter.split(".");

    // First, validate that the entire path exists on the source object
    let src: any = o;
    let valid = true;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (src == null || !(key in src)) {
        valid = false;
        break;
      }
      if (i < keys.length - 1) src = src[key];
    }
    if (!valid) continue; // Skip non-existent paths entirely

    // Re-traverse to build the result path and assign the leaf value
    let dst: any = result;
    src = o;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (i === keys.length - 1) {
        dst[key] = src[key];
      } else {
        if (!(key in dst)) dst[key] = {};
        dst = dst[key];
        src = src[key];
      }
    }
  }
  return result;
}

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
  objects: Record<string, any>,
): TreeBoundsResult {
  // Recursive computation carrying world linear matrix (3x3) and world translation
  const computeRecursive = (
    oid: string,
    parentLinearRM: Float32Array,
    parentTranslation: number[] | Float32Array,
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
        worldT,
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

/** Cross-platform basename without relying on Node 'path'. */
export function getBasename(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.substring(idx + 1) : normalized;
}
