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

export interface TreeBoundsResult {
  bounds: Float32Array | null;
  /** Number of descendants (subtree size excluding the root). */
  count: number;
}

/** Plain snapshot of one object, read once from the editor data. */
export interface ObjectNode {
  id: string;
  name: string;
  /** Parent id, or `null` for objects at the scene root */
  parent: string | null;
  translation: number[];
  rotation: number[];
  scaling: number[];
  /** Mesh ids of all mesh components */
  meshes: string[];
  /** Types of all components, in order */
  componentTypes: string[];
}

/** Snapshot of the scene hierarchy, for repeated traversals. */
export interface ObjectIndex {
  nodes: Map<string, ObjectNode>;
  /** Child ids per parent id */
  children: Map<string, string[]>;
  /** Ids of objects at the scene root */
  roots: string[];
}

/** Read a vector from an editor Access array, with a default per element */
function readVec(v: any, def: number[]): number[] {
  const out = new Array(def.length);
  for (let i = 0; i < def.length; ++i) {
    const x = Number(v?.[i]);
    out[i] = Number.isFinite(x) ? x : def[i];
  }
  return out;
}

/**
 * Build an {@link ObjectIndex} of all objects.
 *
 * Reading through the editor's data interceptors is slow, so tools that
 * traverse the hierarchy several times read every object once here. Finding
 * children is then a map lookup instead of a scan over all objects.
 */
export function buildObjectIndex(objects: Record<string, any>): ObjectIndex {
  const nodes = new Map<string, ObjectNode>();
  for (const [id, obj] of Object.entries(objects)) {
    if (!obj) continue;
    const meshes: string[] = [];
    const componentTypes: string[] = [];
    /* Components is an Access array; Object.values() lists them in order */
    for (const comp of Object.values(obj.components ?? {}) as any[]) {
      const type = comp?.type;
      if (!type) continue;
      componentTypes.push(String(type));
      if (type === "mesh") {
        const meshId = comp?.mesh?.mesh;
        if (meshId) meshes.push(String(meshId));
      }
    }
    const p = obj.parent;
    nodes.set(String(id), {
      id: String(id),
      name: String(obj.name ?? ""),
      parent: p == null || p === "" ? null : String(p),
      translation: readVec(obj.translation, [0, 0, 0]),
      rotation: readVec(obj.rotation, [0, 0, 0, 1]),
      scaling: readVec(obj.scaling, [1, 1, 1]),
      meshes,
      componentTypes,
    });
  }

  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const node of nodes.values()) {
    /* A parent that does not exist (anymore) is treated as the scene root */
    if (node.parent === null || !nodes.has(node.parent)) {
      roots.push(node.id);
      continue;
    }
    let list = children.get(node.parent);
    if (!list) children.set(node.parent, (list = []));
    list.push(node.id);
  }
  return { nodes, children, roots };
}

/** Ids of all ancestors of an object, nearest first. Stops at cycles. */
export function ancestorIds(index: ObjectIndex, objectId: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([objectId]);
  let p = index.nodes.get(objectId)?.parent ?? null;
  while (p !== null && index.nodes.has(p) && !seen.has(p)) {
    out.push(p);
    seen.add(p);
    p = index.nodes.get(p)!.parent;
  }
  return out;
}

/** Ids of an object and all its descendants, parents before children. */
export function subtreeIds(index: ObjectIndex, objectId: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
    for (const c of index.children.get(id) ?? []) visit(c);
  };
  visit(objectId);
  return out;
}

/**
 * World transform of an object's parent as linear 3x3 (row-major) matrix and
 * translation, composed from all ancestors' SRT, scene root first.
 */
export function parentWorldTransform(
  index: ObjectIndex,
  objectId: string
): { linear: Float32Array; translation: number[] } {
  const chain = ancestorIds(index, objectId);
  let linear = mat3IdentityRM();
  let t = [0, 0, 0];
  for (let i = chain.length - 1; i >= 0; --i) {
    const node = index.nodes.get(chain[i])!;
    /* p_world = L * p_local + t: the ancestor's translation is applied in
     * the space of its own parent, then its rotation and scale. */
    const lt = mulMat3Vec3RM(linear, node.translation);
    t = [lt[0] + t[0], lt[1] + t[1], lt[2] + t[2]];
    linear = mulMat3RM(linear, buildLocalLinearRM(node.rotation, node.scaling));
  }
  return { linear, translation: t };
}

/** Space of computed bounds */
export type BoundsSpace = "world" | "parent";

export interface TreeBoundsOptions {
  /**
   * "parent" (default): includes the object's own transform but none of its
   * ancestors'. "world": includes all ancestors' transforms.
   */
  space?: BoundsSpace;
  /** Prebuilt index, to avoid re-reading all objects per call */
  index?: ObjectIndex;
  /** Mesh bounds cache shared across calls; meshes are often reused */
  meshCache?: Map<string, Float32Array | null>;
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
  options: TreeBoundsOptions = {}
): TreeBoundsResult {
  const index = options.index ?? buildObjectIndex(objects);
  const meshCache = options.meshCache ?? new Map<string, Float32Array | null>();
  if (!index.nodes.has(objectId)) return { bounds: null, count: 0 };

  const meshBounds = (meshId: string): Float32Array | null => {
    if (meshCache.has(meshId)) return meshCache.get(meshId)!;
    let mb: Float32Array | null = new Float32Array(6);
    try {
      tools.computeMeshBounds(meshId, mb);
    } catch {
      // Ignore compute errors per mesh
      mb = null;
    }
    meshCache.set(meshId, mb);
    return mb;
  };

  /* Guards against parent cycles in broken data */
  const visited = new Set<string>();

  // Recursive computation carrying world linear matrix (3x3) and world translation
  const computeRecursive = (
    oid: string,
    parentLinearRM: Float32Array,
    parentTranslation: number[] | Float32Array
  ): TreeBoundsResult => {
    const obj = index.nodes.get(oid);
    if (!obj || visited.has(oid)) return { bounds: null, count: 0 };
    visited.add(oid);

    const localLinearRM = buildLocalLinearRM(obj.rotation, obj.scaling);
    const worldLinearRM = mulMat3RM(parentLinearRM, localLinearRM);
    const worldT = mulMat3Vec3RM(parentLinearRM, obj.translation);
    worldT[0] += parentTranslation[0];
    worldT[1] += parentTranslation[1];
    worldT[2] += parentTranslation[2];

    let count = 0;
    const acc = new Float32Array(6);
    const tmp = new Float32Array(6);
    let has = false;

    // Self mesh components
    for (const meshId of obj.meshes) {
      const mb = meshBounds(meshId);
      if (!mb) continue;
      transformAabbCornersRM(tmp, mb, worldLinearRM, worldT);
      if (!has) {
        copyBounds(acc, tmp);
        has = true;
      } else {
        joinBounds(acc, acc, tmp);
      }
    }

    // Children
    for (const cid of index.children.get(oid) ?? []) {
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

  if (options.space === "world") {
    const { linear, translation } = parentWorldTransform(index, objectId);
    return computeRecursive(objectId, linear, translation);
  }
  return computeRecursive(objectId, mat3IdentityRM(), [0, 0, 0]);
}

/**
 * Convert an editor Access object into plain JS values, including default
 * values (inherited enumerable keys). Functions are dropped.
 */
export function materialize(input: any): any {
  const seen = new WeakSet();
  const rec = (v: any): any => {
    if (typeof v === "function") return undefined;
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
      for (let i = 0; i < len; i++) {
        try {
          out[i] = rec(v[i]);
        } catch {
          out[i] = null;
        }
      }
      return out;
    }

    // Copy own + inherited enumerable keys (triggers interceptors/getters)
    const out: any = {};
    for (const k in v) {
      /* Getters of dangling resource references throw ("resource does not
       * exist"); skip those properties instead of failing the whole read. */
      let value: any;
      try {
        value = rec((v as any)[k]);
      } catch {
        continue;
      }
      if (value !== undefined) out[k] = value;
    }
    return out;
  };
  return rec(input);
}

/** Stringify while including defaults on Access objects. */
export function stringifyWithDefaults(
  input: any,
  space?: number | string
): string {
  return JSON.stringify(materialize(input), null, space);
}
