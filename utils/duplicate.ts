import {
  buildObjectIndex,
  materialize,
  ObjectIndex,
  subtreeIds,
} from "./editor-api.js";
import { isObject } from "./pojo.js";

export interface DuplicateRequest {
  sourceId: string;
  count?: number;
  positions?: number[][];
  rotations?: number[][];
  scalings?: number[][];
  parentId?: string | null;
  name?: string;
}

export interface DuplicateResult {
  sourceId: string;
  id: string;
  name: string;
}

/** Component definition as returned by the native getComponentTypes() */
export interface ComponentTypeInfo {
  name: string;
  properties: any;
}

/** Whether a resource section (e.g. data.objects) contains the given id */
function sectionHas(section: any, id: string): boolean {
  if (!section) return false;
  if (typeof section.exists === "function") return !!section.exists(id);
  return section[id] != null;
}

/**
 * Names of the properties of a (JavaScript) component type that reference
 * objects, according to its definition. `null` if the definition is unknown.
 *
 * The definition format of getComponentTypes() is not documented, so this
 * accepts both an array of `{name, type}` and a record of name to definition,
 * and only trusts type names ("object"), not numeric enum values.
 */
function objectPropertyNames(
  types: ComponentTypeInfo[] | null,
  type: string
): Set<string> | null {
  const def = types?.find((t) => t?.name === type);
  if (!def) return null;
  const props = def.properties;
  const entries: [string, any][] = Array.isArray(props)
    ? props.map((p: any) => [String(p?.name), p])
    : Object.entries(props ?? {});
  const isObjectType = (t: any) =>
    typeof t === "string" && t.toLowerCase() === "object";
  const out = new Set<string>();
  for (const [name, p] of entries) {
    const t = typeof p === "string" ? p : p?.type;
    /* Arrays of objects carry the element type separately */
    if (isObjectType(t) || isObjectType(p?.elementType)) out.add(name);
  }
  return out;
}

/**
 * Copy plain values `src` into the editor Access object `dst`.
 *
 * Nested records are merged recursively, values that already match (e.g.
 * defaults of a freshly added component) are left untouched, so that they
 * stay defaults in the project file. Failures are collected, not thrown, so
 * that one unsupported property does not abort the whole copy.
 */
function copyInto(dst: any, src: any, path: string, errors: string[]) {
  for (const key of Object.keys(src)) {
    const v = src[key];
    if (v === "[Circular]") continue;
    let cur: any;
    try {
      cur = dst[key];
    } catch {
      cur = undefined;
    }
    if (isObject(v) && cur && typeof cur === "object" && !Array.isArray(cur)) {
      copyInto(cur, v, `${path}.${key}`, errors);
      continue;
    }
    if (JSON.stringify(materialize(cur)) === JSON.stringify(v)) continue;
    try {
      dst[key] = v;
    } catch (e: any) {
      errors.push(`${path}.${key}: ${e?.message ?? e}`);
    }
  }
}

/**
 * Deep-copy objects with their descendants and components.
 *
 * Object references inside the copied subtree are remapped to the copies:
 * parents, skins whose joints all lie in the subtree (a new skin resource is
 * created), `skin` properties of components and object-typed properties of
 * JavaScript components. Animation resources are shared; an animation
 * component whose animation targets source objects is switched to retarget
 * onto the copy's skin.
 *
 * @param data The editor's project data
 * @param componentTypes Result of the native getComponentTypes(), if available
 * @returns One result per copy, plus notes on what could not be copied
 */
export function duplicateObjects(
  data: any,
  requests: DuplicateRequest[],
  componentTypes: ComponentTypeInfo[] | null
): { results: DuplicateResult[]; notes: string[] } {
  const objects = data.objects;
  const index: ObjectIndex = buildObjectIndex(objects);

  /* Validate everything before creating anything */
  for (const r of requests) {
    if (!index.nodes.has(r.sourceId))
      throw new Error(`Source object ${r.sourceId} not found.`);
    if (r.parentId != null && !index.nodes.has(r.parentId))
      throw new Error(`Parent object ${r.parentId} not found.`);
  }

  const results: DuplicateResult[] = [];
  const notes = new Set<string>();
  const errors: string[] = [];
  const objectProps = new Map<string, Set<string> | null>();

  for (const r of requests) {
    const count =
      r.count ??
      Math.max(
        r.positions?.length ?? 0,
        r.rotations?.length ?? 0,
        r.scalings?.length ?? 0,
        1
      );
    const ids = subtreeIds(index, r.sourceId);
    const sourceRoot = index.nodes.get(r.sourceId)!;

    for (let i = 0; i < count; ++i) {
      /* Source id to copy id, for remapping references */
      const idMap = new Map<string, string>();

      /* Pass 1: create all objects with name, parent and transform.
       * ids lists parents before children, so the parent copy exists. */
      for (const id of ids) {
        const node = index.nodes.get(id)!;
        const src = objects[id];
        const dst = objects.add();
        const newId = String(dst.resourceKey);
        idMap.set(id, newId);

        const isRoot = id === r.sourceId;
        dst.name = isRoot ? r.name ?? node.name : node.name;
        const parent = isRoot
          ? r.parentId === undefined
            ? node.parent
            : r.parentId
          : idMap.get(node.parent!) ?? node.parent;
        if (parent != null) dst.parent = parent;

        dst.translation = (isRoot && r.positions?.[i]) || node.translation;
        dst.rotation = (isRoot && r.rotations?.[i]) || node.rotation;
        dst.scaling = (isRoot && r.scalings?.[i]) || node.scaling;
        if (src?.hiddenForLightBaking) dst.hiddenForLightBaking = true;
      }

      /* Pass 2: copy skins whose joints are all inside the subtree */
      const skinMap = new Map<string, string>();
      const skinIds = new Set<string>();
      for (const id of ids) {
        const src = objects[id];
        if (src?.skin) skinIds.add(String(src.skin));
        for (const comp of Object.values(src?.components ?? {}) as any[]) {
          const s = comp?.type && comp[comp.type]?.skin;
          if (s) skinIds.add(String(s));
        }
      }
      for (const skinId of skinIds) {
        const skin = data.skins?.[skinId];
        const joints = (materialize(skin?.joints) ?? []) as (string | null)[];
        const inside = joints.filter((j) => j != null && idMap.has(String(j)));
        if (inside.length === 0) continue;
        if (inside.length !== joints.filter((j) => j != null).length) {
          notes.add(
            `Skin ${skinId} has joints outside the copied subtree; the copies keep using it.`
          );
          continue;
        }
        try {
          const ns = data.skins.add();
          ns.name = skin.name;
          ns.joints = joints.map((j) => (j == null ? null : idMap.get(String(j))!));
          skinMap.set(skinId, String(ns.resourceKey));
        } catch (e: any) {
          notes.add(
            `Could not create a copy of skin ${skinId} (${e?.message ?? e}); the copies keep using the source's skin.`
          );
        }
      }

      /* Pass 3: skin membership and components, with remapped references */
      for (const id of ids) {
        const src = objects[id];
        const dst = objects[idMap.get(id)!];
        if (!src || !dst) continue;

        if (src.skin) {
          try {
            dst.skin = skinMap.get(String(src.skin)) ?? src.skin;
          } catch (e: any) {
            errors.push(`object ${id} skin: ${e?.message ?? e}`);
          }
        }

        let next = Number(dst.components?.length ?? 0);
        for (const comp of Object.values(src.components ?? {}) as any[]) {
          const type = comp?.type;
          if (!type) continue;
          const compIndex = next++;
          dst.components[compIndex].type = type;
          const dstComp = dst.components[compIndex];
          if (comp.active === false) {
            try {
              dstComp.active = false;
            } catch {
              // Older editors may not expose active
            }
          }

          const props = materialize(comp[type]);
          if (!isObject(props)) continue;

          /* Native components reference skins by `skin` */
          if (typeof props.skin === "string" && skinMap.has(props.skin))
            props.skin = skinMap.get(props.skin);

          if (type === "animation") {
            remapAnimation(data, props, idMap, skinMap, sourceRoot.name, notes);
          } else if (!NATIVE_TYPES.has(type)) {
            if (!objectProps.has(type))
              objectProps.set(type, objectPropertyNames(componentTypes, type));
            const names = objectProps.get(type);
            if (names === null) {
              notes.add(
                `No property definitions for component "${type}"; its object references were not remapped.`
              );
            } else {
              for (const name of names!) {
                const v = props[name];
                if (typeof v === "string" && idMap.has(v))
                  props[name] = idMap.get(v);
                else if (Array.isArray(v))
                  props[name] = v.map((e) =>
                    typeof e === "string" && idMap.has(e) ? idMap.get(e) : e
                  );
              }
            }
          }

          copyInto(dstComp[type], props, `object ${idMap.get(id)} ${type}`, errors);
        }
      }

      const rootCopy = objects[idMap.get(r.sourceId)!];
      results.push({
        sourceId: r.sourceId,
        id: idMap.get(r.sourceId)!,
        name: String(rootCopy?.name ?? ""),
      });
    }
  }

  if (errors.length > 0) {
    const shown = errors.slice(0, 20);
    notes.add(
      `Could not copy ${errors.length} properties: ${shown.join("; ")}` +
        (errors.length > shown.length ? "; ..." : "")
    );
  }
  return { results, notes: [...notes] };
}

/** Component types implemented by the engine (not JavaScript) */
const NATIVE_TYPES = new Set([
  "mesh",
  "light",
  "text",
  "collision",
  "physx",
  "input",
  "view",
  "animation",
  "particle-effect",
  "particleEffect",
]);

/**
 * An animation resource targets the objects it was imported with. Played on
 * a copy without retargeting, it would move the source's bones. If its
 * targets lie in the copied subtree, retarget it onto the copy's skin.
 */
function remapAnimation(
  data: any,
  props: Record<string, any>,
  idMap: Map<string, string>,
  skinMap: Map<string, string>,
  sourceName: string,
  notes: Set<string>
) {
  if (props.retarget) return; // Already retargets onto props.skin (remapped above)
  const animId = props.animation;
  if (typeof animId !== "string") return;
  const targets = (materialize(data.animations?.[animId]?.targets) ??
    []) as (string | null)[];
  const targetsSource = targets.some((t) => t != null && idMap.has(String(t)));
  if (!targetsSource) return;

  /* Prefer the component's own skin, otherwise the only copied skin */
  const skin =
    (typeof props.skin === "string" && [...skinMap.values()].includes(props.skin)
      ? props.skin
      : null) ?? (skinMap.size === 1 ? [...skinMap.values()][0] : null);
  if (skin) {
    props.retarget = true;
    props.skin = skin;
    notes.add(
      `Animation components of "${sourceName}" copies were set to retarget onto the copy's skin.`
    );
  } else {
    notes.add(
      `An animation component of "${sourceName}" targets the source's objects; on the copies it still animates the source.`
    );
  }
}
