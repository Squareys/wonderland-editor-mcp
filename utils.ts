export function isObject(item: any): item is Record<string, any> {
  return item && typeof item === "object" && !Array.isArray(item);
}

export function assignNested(
  target: Record<string, any>,
  source: Record<string, any>
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
  index: number = 0
) {
  for (const key of Object.keys(comp)) {
    if (key in properties) {
      if (typeof comp[key] !== typeof properties[key]) {
        throw new Error(
          `Type mismatch for property ${key} in component ${
            comp.type
          } of object ${o.name}. Expected ${typeof comp[
            key
          ]}, got ${typeof properties[key]}`
        );
      }
      if (
        Array.isArray(comp[key]) &&
        properties[key].length !== comp[key].length
      ) {
        throw new Error(
          `Length mismatch for property '${key}' in '${typeName}' component with index ${index} of object "${o.name}". Expected length ${comp[key].length}, got ${properties[key].length}`
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
  o: any
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

/**
 * Copy bounds from src into out. Bounds layout: [minX, minY, minZ, maxX, maxY, maxZ]
 */
export function copyBounds(out: Float32Array, src: Float32Array): Float32Array {
  out.set(src);
  return out;
}

/**
 * Join two bounds a and b into out using component-wise min/max.
 * Returns out, or null if both inputs are null/undefined.
 * Safe to pass out === a or out === b.
 */
export function joinBounds(
  out: Float32Array,
  a?: Float32Array | null,
  b?: Float32Array | null
): Float32Array | null {
  if (!a && !b) return null;
  if (!a) return copyBounds(out, b!);
  if (!b) return copyBounds(out, a);

  const aminx = a[0],
    aminy = a[1],
    aminz = a[2],
    amaxx = a[3],
    amaxy = a[4],
    amaxz = a[5];
  const bminx = b[0],
    bminy = b[1],
    bminz = b[2],
    bmaxx = b[3],
    bmaxy = b[4],
    bmaxz = b[5];
  out[0] = Math.min(aminx, bminx);
  out[1] = Math.min(aminy, bminy);
  out[2] = Math.min(aminz, bminz);
  out[3] = Math.max(amaxx, bmaxx);
  out[4] = Math.max(amaxy, bmaxy);
  out[5] = Math.max(amaxz, bmaxz);
  return out;
}

/**
 * Scale bounds src by scale vector [sx,sy,sz] into out.
 * Handles negative scales by swapping min/max per axis as needed.
 */
export function scaleBounds(
  out: Float32Array,
  src: Float32Array,
  scale: number[] | Float32Array
): Float32Array {
  const sx = (scale as any)?.[0] ?? 1;
  const sy = (scale as any)?.[1] ?? 1;
  const sz = (scale as any)?.[2] ?? 1;

  const x0 = src[0] * sx,
    x1 = src[3] * sx;
  const y0 = src[1] * sy,
    y1 = src[4] * sy;
  const z0 = src[2] * sz,
    z1 = src[5] * sz;

  out[0] = Math.min(x0, x1);
  out[1] = Math.min(y0, y1);
  out[2] = Math.min(z0, z1);
  out[3] = Math.max(x0, x1);
  out[4] = Math.max(y0, y1);
  out[5] = Math.max(z0, z1);
  return out;
}

export interface TreeBoundsResult {
  bounds: Float32Array | null;
  /** Number of descendants (subtree size excluding the root). */
  count: number;
}

/**
 * Recursively computes the axis-aligned bounds for an object subtree and counts descendants.
 * - Mesh bounds are merged per object and scaled by the object's scaling.
 * - Child subtree bounds are merged after being scaled by the parent's scaling.
 * - Rotation/translation are ignored by design here, as per tool requirements.
 *
 * This function is environment-agnostic; pass in the objects map and a computeMeshBounds callback.
 */
export function computeTreeBounds(
  objectId: string,
  objects: Record<string, any>,
  computeMeshBoundsFn: (meshId: string, out: Float32Array) => void
): TreeBoundsResult {
  const obj = objects[objectId];
  if (!obj) return { bounds: null, count: 0 };

  let count = 0; // count descendants only (exclude self)
  const acc = new Float32Array(6);
  const s1 = new Float32Array(6);
  let has = false;

  // Self mesh components
  const comps = (obj.components ?? []) as any[];
  for (const comp of comps) {
    if (!comp || comp.type !== "mesh") continue;
    const meshId = comp?.mesh?.mesh as string | null;
    if (!meshId) continue;
    const mb = new Float32Array(6);
    try {
      computeMeshBoundsFn(meshId, mb);
      scaleBounds(s1, mb, obj.scaling ?? [1, 1, 1]);
      if (!has) {
        copyBounds(acc, s1);
        has = true;
      } else {
        joinBounds(acc, acc, s1);
      }
    } catch {
      // Ignore compute errors per component
    }
  }

  // Children
  for (const [cid, child] of Object.entries(objects)) {
    if (!child || child.parent !== objectId) continue;
    const { bounds: cb, count: cc } = computeTreeBounds(
      cid,
      objects,
      computeMeshBoundsFn
    );
    count += 1 + cc; // include the child itself plus its descendants
    if (cb) {
      scaleBounds(s1, cb, obj.scaling ?? [1, 1, 1]);
      if (!has) {
        copyBounds(acc, s1);
        has = true;
      } else {
        joinBounds(acc, acc, s1);
      }
    }
  }

  return { bounds: has ? acc : null, count };
}

/** Cross-platform basename without relying on Node 'path'. */
export function getBasename(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.substring(idx + 1) : normalized;
}
