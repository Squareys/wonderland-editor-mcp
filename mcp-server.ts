import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { data, ObjectResource, tools } from "@wonderlandengine/editor-api";
import { WorkQueue } from "./utils/work-queue.js";
import {
  computeMeshBoundsSchema,
  computeObjectBoundsSchema,
  deleteObjectsSchema,
  duplicateObjectsSchema,
  findOverlapsSchema,
  importFilesSchema,
  importSceneFilesSchema,
  modifyObjectsSchema,
  modifyResourcesSchema,
  modifySettingsSchema,
  queryComponentTypesSchema,
  queryResourcesSchema,
  querySceneTreeSchema,
  querySettingsSchema,
} from "./schemas.js";
import {
  assignComponentProperties,
  assignNested,
  filterObjectProperties,
} from "./utils/pojo.js";
import {
  ancestorIds,
  buildObjectIndex,
  computeTreeBounds,
  stringifyWithDefaults,
} from "./utils/editor-api.js";
import { duplicateObjects } from "./utils/duplicate.js";
import path from "node:path";
import { z } from "zod";
import { getPublishState, startPublish } from "./utils/publish.js";

// JS component property caches (per object-component index and per object+type fallback)
const jsComponentProps = new Map<string, any>();
const jsComponentPropsByObjectType = new Map<string, any>();

export const server = new McpServer({
  name: "Wonderland Editor",
  version: "1.2.0",
});
let queue: WorkQueue | null = null;
export function setQueue(q: WorkQueue) {
  queue = q;
}

/* Native editor tools binding. Used directly for functions that older
 * @wonderlandengine/editor-api versions do not wrap (e.g. saveProject, added
 * in Wonderland Editor 1.6), so the plugin keeps loading on older editors. */
const nativeTools: Record<string, any> | null = (() => {
  try {
    return (globalThis as any)._wl_internalBinding?.("tools") ?? null;
  } catch {
    return null;
  }
})();


server.registerTool(
  "query_resources",
  {
    title: "Query Resources",
    description:
      "List resources of a certain type, filtering by property, if needed.",
    inputSchema: queryResourcesSchema,
  },
  async ({ resourceType, ids, includeFilter, excludeFilter, paths }) => {
    try {
      // @ts-ignore
      const allResources: Record<string, any> = data[resourceType];
      if (!allResources)
        throw new Error(
          `Resource type "${resourceType}" is not supported by this editor version.`
        );
      let resources: Record<string, any>[] =
        ids && ids.length > 0
          ? ids
              .filter((id) => allResources.exists(id))
              .map((id) => ({
                id,
                ...allResources[id],
              }))
          : Object.entries(allResources).map(([id, res]) => ({
              id,
              ...res,
            }));

      const nameContains = (res: any, name: string) =>
        typeof res.name === "string" && res.name.indexOf(name) >= 0;

      if (includeFilter) {
        const { name, ...rest } = includeFilter;
        if (name !== undefined)
          resources = resources.filter((res) => nameContains(res, name));
        const keys = Object.keys(rest);
        resources = resources.filter((res: any) => {
          for (const key of keys) {
            if (res[key] != rest[key]) return false;
          }
          return true;
        });
      }

      if (excludeFilter) {
        const { name, ...rest } = excludeFilter;
        /* Exclude resources whose name contains the given string */
        if (name !== undefined)
          resources = resources.filter((res) => !nameContains(res, name));
        const keys = Object.keys(rest);
        if (keys.length > 0) {
          resources = resources.filter((res: any) => {
            for (const key of keys) {
              if (res[key] == rest[key]) return false;
            }
            return true;
          });
        }
      }

      if (paths && paths.length > 0) {
        /* Always keep the id, it is needed to refer to the resource later */
        const withId = paths.includes("id") ? paths : ["id", ...paths];
        resources = resources.map(filterObjectProperties.bind(null, withId));
      }

      const content = resources.map((res) => ({
        type: "text" as const,
        text: JSON.stringify(res),
      }));

      return { content };
    } catch (error: any) {
      const msg = (error && (error.errors || error.message)) ?? "Unknown error";
      console.error("query_resources error:", error);
      throw new Error(
        "Invalid arguments: " +
          (typeof msg === "string" ? msg : JSON.stringify(msg))
      );
    }
  }
);

server.registerTool(
  "query_settings",
  {
    title: "Query Settings",
    description:
      "Retrieve the current project settings. Specify paths like 'rendering', 'physx', 'editor', 'runtime' to retrieve only specific settings.",
    inputSchema: querySettingsSchema,
  },
  async ({ paths }: { paths?: string[] }) => {
    try {
      const settings = JSON.parse(stringifyWithDefaults(data.settings));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(filterObjectProperties(paths, settings)),
          },
        ],
      };
    } catch (error: any) {
      console.error("Validation errors:", error, error?.errors ?? "");
      throw new Error("Invalid arguments: " + JSON.stringify(error.errors));
    }
  }
);

server.registerTool(
  "modify_settings",
  {
    title: "Modify Settings",
    description: "Modify the project settings.",
    inputSchema: modifySettingsSchema,
  },
  async ({ changeSettings, resetPaths }) => {
    try {
      let errors = [];
      await queue!.push(async () => {
        resetPaths?.forEach((key) => {
          const split = key.split(".");
          try {
            let setting: any = data.settings;
            for (const k of split.slice(0, -1)) {
              setting = setting[k];
              if (setting === undefined || setting === null) return; // nothing to delete
            }

            delete setting[split[split.length - 1]];
          } catch {
            errors.push(`Could not reset setting at path ${key} - not found.`);
          }
        });

        if (changeSettings) {
          assignNested(data.settings, changeSettings);
        }
      });

      return {
        content: [
          {
            type: "text",
            text: "Done.",
          },
        ],
      };
    } catch (error: any) {
      const msg = (error && (error.errors || error.message)) ?? "Unknown error";
      console.error("Validation errors:", error, error?.errors ?? "");
      throw new Error(
        "Invalid arguments: " +
          (typeof msg === "string" ? msg : JSON.stringify(msg))
      );
    }
  }
);

if (typeof nativeTools?.getComponentTypes === "function") server.registerTool(
  "query_component_types",
  {
    title: "Query Component Types",
    description:
      "Retrieve the current registered component types and their property definitions.",
    inputSchema: queryComponentTypesSchema,
  },
  async ({ names }: { names?: string[] }) => {
    try {
      const componentTypes = nativeTools!.getComponentTypes() as {name: string, properties: any}[];
      let filteredComponentTypes = componentTypes;
      if (names && names.length > 0) {
        filteredComponentTypes = componentTypes.filter(ct => names.includes(ct.name));
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(filteredComponentTypes),
          },
        ],
      };
    } catch (error: any) {
      console.error("Validation errors:", error, error?.errors ?? "");
      throw new Error("Invalid arguments: " + JSON.stringify(error.errors));
    }
  }
);

server.registerTool(
  "delete_objects",
  {
    title: "Delete Objects",
    description: "Delete objects.",
    inputSchema: deleteObjectsSchema,
  },
  async ({ objectIds }) => {
    try {
      const missingObjects = await queue!.push(async () => {
        return objectIds.filter((objectId) => {
          const o = data.objects[objectId];
          if (!o || !o.exists) return true;
          delete data.objects[objectId];
          return false;
        });
      });

      return {
        content: [{ type: "text", text: missingObjects.length != 0 ? "The following objects were not found: " + missingObjects.join(", ") : "Done." }],
      };
    } catch (error: any) {
      const msg = (error && (error.errors || error.message)) ?? "Unknown error";
      console.error("Validation errors:", error, error?.errors ?? "");
      throw new Error(
        "Invalid arguments: " +
          (typeof msg === "string" ? msg : JSON.stringify(msg))
      );
    }
  }
);

server.registerTool(
  "modify_objects",
  {
    title: "Modify Objects",
    description:
      "Create or modify objects in the Wonderland Engine project. " +
      "Properties not specified in modifications are kept as-is. " +
      "If an id is not used, the object will be created. " +
      "Unknown keys are rejected.",
    inputSchema: modifyObjectsSchema,
  },
  async ({ modifications }) => {
    try {
      const results = await queue!.push(async () => {
        return modifications.map(
          ({
            parentId,
            position,
            rotation,
            scaling,
            hiddenForLightBaking,
            id,
            name,
            addComponents,
            modifyComponents,
            removeComponents,
          }) => {
            const o: ObjectResource = id
              ? data.objects[id]
              : data.objects.add();

            if (!o) throw new Error(`Object with id ${id} not found.`);

            if (name) o.name = name;
            if (parentId) o.parent = parentId;
            if (position) o.translation = position;
            if (rotation) o.rotation = rotation;
            if (scaling) o.scaling = scaling;
            if (hiddenForLightBaking !== undefined)
              // @ts-ignore Not in the editor-api typings, but in the data
              o.hiddenForLightBaking = hiddenForLightBaking;
            if (modifyComponents) {
              modifyComponents.forEach(({ index, properties }) => {
                const comp = o.components[index];
                if (comp.type == null) return;
                if (!properties) return;
                // @ts-ignore
                const props = comp[comp.type];
                assignComponentProperties(
                  comp.type,
                  props,
                  properties,
                  o,
                  index
                );
                for (const key of Object.keys(properties)) {
                  try {
                    // @ts-ignore
                    comp[o.components[index].type!][key] = properties[key];
                  } catch (e) {
                    console.error(
                      "Could not assign property",
                      key,
                      "to",
                      comp.type,
                      "component at index",
                      index,
                      "of object",
                      o.name,
                      "\n",
                      e
                    );
                  }
                }
              });
            }
            if (removeComponents) {
              /* Remove from the highest index down, so that indices stay valid.
               * Sort numerically, default sort() compares as strings. */
              [...removeComponents]
                .sort((a, b) => b - a)
                .forEach((i) => delete o.components[i]);
            }
            if (addComponents) {
              addComponents.forEach((c) => {
                const index = o.components?.length ?? 0;
                o.components[index].type = c.type;
                // @ts-ignore
                const comp = o.components[index][c.type];

                if (c.properties)
                  assignComponentProperties(
                    c.type,
                    comp,
                    c.properties,
                    o,
                    index
                  );
              });
            }
            return {
              id: String(o.resourceKey),
              name: o.name,
              created: !id,
            };
          }
        );
      });
      /* Return ids so that callers can refer to newly created objects */
      return {
        content: results.map((r) => ({
          type: "text" as const,
          text: JSON.stringify(r),
        })),
      };
    } catch (error: any) {
      const msg = (error && (error.errors || error.message)) ?? "Unknown error";
      console.error("modify_objects error:", error);
      throw new Error(
        "Invalid arguments: " +
          (typeof msg === "string" ? msg : JSON.stringify(msg))
      );
    }
  }
);

server.registerTool(
  "modify_resources",
  {
    title: "Modify Resources",
    description:
      "Create or modify resources in the Wonderland Engine project. " +
      "Cannot be used to modify objects. Use modify_objects to modify " +
      "objects. Properties not specified in changeProperties or resetProperties are kept as-is.",
    inputSchema: modifyResourcesSchema,
  },
  async ({ modifications }) => {
    try {
      const results = await queue!.push(async () => {
        return modifications.map(
          ({ id, resourceType, changeProperties, resetProperties }) => {
            // @ts-ignore
            const section = data[resourceType];
            if (!section)
              throw new Error(
                `Resource type "${resourceType}" is not supported by this editor version.`
              );
            const res = id ? section[id] : section.add();
            if (!res)
              throw new Error(`Resource ${resourceType}/${id} not found.`);

            if (resetProperties) {
              resetProperties.forEach((key) => {
                delete res[key];
              });
            }

            if (changeProperties) {
              assignNested(res, changeProperties);
            }

            return {
              resourceType,
              id: String(res.resourceKey ?? id),
              name: res.name,
              created: !id,
            };
          }
        );
      });

      /* Return ids so that callers can refer to newly created resources */
      return {
        content: results.map((r) => ({
          type: "text" as const,
          text: JSON.stringify(r),
        })),
      };
    } catch (error: any) {
      const msg = (error && (error.errors || error.message)) ?? "Unknown error";
      console.error("Validation errors:", error, error?.errors ?? "");
      throw new Error(
        "Invalid arguments: " +
          (typeof msg === "string" ? msg : JSON.stringify(msg))
      );
    }
  }
);

server.registerTool(
  "import_scenes",
  {
    title: "Import Scenes",
    description:
      "Import scene files (e.g. GLB, FBX, OBJ) by path. Try to batch calls to this function. " +
      "Each file goes into a new container object; returned bounds are in the container's space.",
    inputSchema: importSceneFilesSchema,
  },
  async ({ imports }) => {
    try {
      const results: {
        id: string;
        rootId: string;
        containerId: string;
        count: number;
        bounds: {
          min: [number, number, number];
          max: [number, number, number];
        } | null;
      }[] = [];

      await queue!.push(async () => {
        // For each import, create a new container object (named after the file basename),
        // import the scene under it, then report the immediate children with their tree bounds.
        for (const entry of imports as any[]) {
          const scenePath = (entry as any)?.path;
          const allObjects: Record<string, any> = data.objects as any;
          const baseName = path.basename(scenePath);

          // @ts-ignore
          const containerObject = data.objects.add();
          containerObject.name = baseName;

          // Snapshot existing object IDs to detect new ones created by this import
          const beforeIds = new Set(Object.keys(allObjects));

          // Import under the created container
          await tools.loadScene(scenePath, {
            parent: containerObject.resourceKey,
          });

          // Compute set of new object IDs
          const newIds = new Set<string>();
          for (const id of Object.keys(allObjects))
            if (!beforeIds.has(id)) newIds.add(id);

          // Ensure all newly created root objects are parented to the container
          // Some importers may ignore the parent option. If a new object has no parent
          // or its parent is not another new object, treat it as a root and reparent it.
          for (const id of newIds) {
            const p = allObjects[id]?.parent;
            const parentInNewSet = p != null && newIds.has(String(p));
            if (p == null || !parentInNewSet) {
              allObjects[id].parent = containerObject.resourceKey;
            }
          }

          // Imported roots are the newly created objects that are direct children of the container
          const importedRootIds: string[] = [];
          for (const id of newIds) {
            const p = allObjects[id]?.parent;
            if (
              p != null &&
              String(p) === String(containerObject.resourceKey)
            ) {
              importedRootIds.push(id);
            }
          }

          /* Read the hierarchy once for all roots of this file */
          const index = buildObjectIndex(data.objects);
          for (const oid of importedRootIds) {
            const { bounds: b, count } = computeTreeBounds(oid, data.objects, {
              index,
            });
            results.push({
              id: oid,
              rootId: oid,
              containerId: containerObject.resourceKey,
              bounds: b && { min: [b[0], b[1], b[2]], max: [b[3], b[4], b[5]] },
              count,
            });
          }
        }
      });

      return {
        content: results.map((r) => ({
          type: "text",
          text: JSON.stringify(r),
        })),
      };
    } catch (error: any) {
      const msg = (error && (error.errors || error.message)) ?? "Unknown error";
      console.error("[import_scenes] Error:", error);
      throw new Error(
        "Invalid arguments: " +
          (typeof msg === "string" ? msg : JSON.stringify(msg))
      );
    }
  }
);

server.registerTool(
  "import_files",
  {
    title: "Import Files",
    description: "Import files (e.g. images) by path.",
    inputSchema: importFilesSchema,
  },
  async ({ imports }) => {
    try {
      await queue!.push(async () => {
        /* Wait for the files to load, so that errors reach the caller */
        await Promise.all(imports.map((path) => tools.loadFile(path)));
      });

      return { content: [{ type: "text", text: "Done." }] };
    } catch (error: any) {
      const msg = (error && (error.errors || error.message)) ?? "Unknown error";
      console.error("Validation errors:", error, error?.errors ?? "");
      throw new Error(
        "Invalid arguments: " +
          (typeof msg === "string" ? msg : JSON.stringify(msg))
      );
    }
  }
);

server.registerTool(
  "compute_mesh_bounds",
  {
    title: "Compute Mesh Bounds",
    description: "Compute the bounds of the given mesh resources.",
    inputSchema: computeMeshBoundsSchema,
  },
  async ({ meshIds }) => {
    try {
      const bounds = meshIds.map((meshId) => {
        const out = new Float32Array(6);
        tools.computeMeshBounds(meshId, out);
        /* Convert to plain arrays, typed arrays serialize as objects */
        return { id: meshId, min: Array.from(out.subarray(0, 3)), max: Array.from(out.subarray(3, 6)) };
      });

      return {
        content: bounds.map((b) => ({ type: "text", text: JSON.stringify(b) })),
      };
    } catch (error: any) {
      const msg = (error && (error.errors || error.message)) ?? "Unknown error";
      console.error("Validation errors:", error, error?.errors ?? "");
      throw new Error(
        "Invalid arguments: " +
          (typeof msg === "string" ? msg : JSON.stringify(msg))
      );
    }
  }
);

if (typeof nativeTools?.saveProject === "function")
  server.registerTool(
    "save_project",
    {
      title: "Save Project",
      description:
        "Save the project file (.wlp). Changes made through the other tools " +
        "are only kept in memory (and in autosaves) until the project is " +
        "saved. Call this after finishing a set of changes.",
      inputSchema: {},
    },
    async () => {
      await queue!.push(async () => {
        nativeTools!.saveProject();
      });
      return { content: [{ type: "text", text: "Saved." }] };
    }
  );

server.registerTool(
  "publish_page",
  {
    title: "Publish Page",
    description:
      "Publish the project to Wonderland Cloud Pages (free hosting at " +
      "https://<page-name>.cloud.wonderland.dev). Only call this when the user " +
      "asked to publish. Before a first publish, ask the user for the page " +
      "name and whether the page is unlisted or public. Packages the project, then opens the user's browser " +
      "to sign in and confirm; the upload continues in the background. Poll " +
      "progress with publish_status, do not call publish_page again to poll. " +
      "A project that was published before is always updated in place " +
      "(state is kept in deployment.json); while a publish runs, further " +
      "calls only return its status.",
    inputSchema: {
      pageName: z
        .string()
        .optional()
        .describe(
          "Page name for the first publish: 2-22 lowercase letters, digits " +
            "and single hyphens, starting and ending with a letter. Defaults " +
            "to the project name. The server may append a suffix to make it unique; "
            + "the actual name is returned. For an already published project, " +
            "leave it out: a different name is rejected."
        ),
      access: z
        .enum(["unlisted", "public"])
        .optional()
        .describe(
          "Required for a first publish (ask the user). unlisted: only " +
            "people with the link find it. public: also listed in the page " +
            "explorer. Updates keep the current access unless given."
        ),
    },
  },
  async ({ pageName, access }) => {
    try {
      const state = startPublish({ pageName, access });
      return { content: [{ type: "text", text: JSON.stringify(state) }] };
    } catch (error: any) {
      throw new Error(String(error?.message ?? error));
    }
  }
);

server.registerTool(
  "publish_status",
  {
    title: "Publish Status",
    description:
      "State of the current or last publish: idle, packaging, " +
      "waiting_for_confirmation (the user has to confirm in the browser, " +
      "see confirmUrl), uploading, done (see url) or failed (see error). " +
      "Also returns the page of an earlier publish from deployment.json.",
    inputSchema: {},
  },
  async () => ({
    content: [{ type: "text", text: JSON.stringify(getPublishState()) }],
  })
);

server.registerTool(
  "open_preview",
  {
    title: "Open Preview",
    description:
      "Open the live-reloading web preview of the project in the user's " +
      "default browser, so they can watch changes as they happen. Works " +
      "also when the editor runs windowless with --server.",
    inputSchema: {},
  },
  async () => {
    const port = (data.settings as any)?.editor?.serverPort ?? 8080;
    const url = `http://localhost:${port}/`;
    tools.openBrowser(url);
    return { content: [{ type: "text", text: `Opened ${url}` }] };
  }
);

server.registerTool(
  "compute_object_bounds",
  {
    title: "Compute Object Bounds",
    description:
      "Compute axis-aligned bounds of the given objects including all " +
      "children. space \"world\" (default) includes all ancestors' " +
      "transforms; \"parent\" includes the object's own transform but not " +
      "its ancestors'.",
    inputSchema: computeObjectBoundsSchema,
  },
  async ({ objectIds, space }) => {
    try {
      const index = buildObjectIndex(data.objects);
      const meshCache = new Map<string, Float32Array | null>();
      const out = objectIds.map((oid: string) => {
        if (!index.nodes.has(oid))
          return { id: oid, count: 0, bounds: null, error: "not found" };
        const { bounds: b, count } = computeTreeBounds(oid, data.objects, {
          space: space ?? "world",
          index,
          meshCache,
        });
        if (b) {
          const minOut: [number, number, number] = [b[0], b[1], b[2]];
          const maxOut: [number, number, number] = [b[3], b[4], b[5]];
          return { id: oid, count, bounds: { min: minOut, max: maxOut } };
        }
        return { id: oid, count, bounds: null };
      });

      return {
        content: out.map((e) => ({ type: "text", text: JSON.stringify(e) })),
      };
    } catch (error: any) {
      const msg = (error && (error.errors || error.message)) ?? "Unknown error";
      console.error("Validation errors:", error, error?.errors ?? "");
      throw new Error(
        "Invalid arguments: " +
          (typeof msg === "string" ? msg : JSON.stringify(msg))
      );
    }
  }
);

/** Round to millimeters, to keep results short */
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Maximum number of pairs returned by find_overlaps */
const MAX_OVERLAP_PAIRS = 100;

server.registerTool(
  "find_overlaps",
  {
    title: "Find Overlaps",
    description:
      "Find pairs of objects whose world-space subtree bounds (AABBs) " +
      "intersect, sorted by overlap volume. overlap is the intersection " +
      "depth per axis [x, y, z] (negative: separated). Objects without " +
      "meshes and ancestor/descendant pairs are skipped. Use after every " +
      "layout change; fix all pairs, then call again until none are left.",
    inputSchema: findOverlapsSchema,
  },
  async ({ objectIds, minGap, ignoreIds, ignoreNameContains, touchTolerance }) => {
    try {
      const index = buildObjectIndex(data.objects);
      const meshCache = new Map<string, Float32Array | null>();
      const gapLimit = minGap ?? 0;
      const tol = touchTolerance ?? 0.01;
      const ignored = new Set(ignoreIds ?? []);
      const ignoredNames = (ignoreNameContains ?? []).map((n) =>
        n.toLowerCase()
      );

      const candidates = [
        ...new Set(objectIds && objectIds.length > 0 ? objectIds : index.roots),
      ];
      const missing: string[] = [];
      let ignoredCount = 0;
      let noBounds = 0;
      const entries: {
        id: string;
        name: string;
        b: Float32Array;
        ancestors: Set<string>;
      }[] = [];
      for (const id of candidates) {
        const node = index.nodes.get(id);
        if (!node) {
          missing.push(id);
          continue;
        }
        const lname = node.name.toLowerCase();
        if (ignored.has(id) || ignoredNames.some((n) => lname.includes(n))) {
          ++ignoredCount;
          continue;
        }
        const { bounds } = computeTreeBounds(id, data.objects, {
          space: "world",
          index,
          meshCache,
        });
        if (!bounds) {
          ++noBounds;
          continue;
        }
        entries.push({
          id,
          name: node.name,
          b: bounds,
          ancestors: new Set(ancestorIds(index, id)),
        });
      }

      type Pair = {
        a: { id: string; name: string };
        b: { id: string; name: string };
        overlap: number[];
        gap?: number;
        volume: number;
      };
      const pairs: Pair[] = [];
      let overlapCount = 0;
      for (let i = 0; i < entries.length; ++i) {
        const A = entries[i];
        for (let j = i + 1; j < entries.length; ++j) {
          const B = entries[j];
          /* A subtree always contains its descendants' bounds */
          if (A.ancestors.has(B.id) || B.ancestors.has(A.id)) continue;
          const a = A.b,
            b = B.b;
          /* Intersection depth per axis, negative when separated */
          const ox = Math.min(a[3], b[3]) - Math.max(a[0], b[0]);
          const oy = Math.min(a[4], b[4]) - Math.max(a[1], b[1]);
          const oz = Math.min(a[5], b[5]) - Math.max(a[2], b[2]);
          const ref = {
            a: { id: A.id, name: A.name },
            b: { id: B.id, name: B.name },
            overlap: [round3(ox), round3(oy), round3(oz)],
          };
          if (ox > tol && oy > tol && oz > tol) {
            ++overlapCount;
            pairs.push({ ...ref, volume: ox * oy * oz });
          } else if (gapLimit > 0 && oy > tol) {
            /* Same height range: horizontal distance between the
             * footprints, 0 when they touch */
            const gap = Math.hypot(Math.max(0, -ox), Math.max(0, -oz));
            if (gap < gapLimit)
              pairs.push({ ...ref, gap: round3(gap), volume: 0 });
          }
        }
      }

      /* Overlaps by volume first, then near pairs by distance */
      pairs.sort((p, q) =>
        p.volume !== q.volume
          ? q.volume - p.volume
          : (p.gap ?? 0) - (q.gap ?? 0)
      );
      const shown = pairs.slice(0, MAX_OVERLAP_PAIRS);

      let summary =
        `Checked ${entries.length} objects` +
        ` (skipped: ${noBounds} without bounds, ${ignoredCount} ignored). ` +
        `${overlapCount} overlapping pairs`;
      if (gapLimit > 0)
        summary += `, ${pairs.length - overlapCount} pairs closer than ${gapLimit} m`;
      summary += ".";
      if (missing.length > 0) summary += ` Not found: ${missing.join(", ")}.`;
      if (shown.length < pairs.length)
        summary += ` Showing the first ${shown.length} of ${pairs.length}.`;

      return {
        content: [
          { type: "text" as const, text: summary },
          ...shown.map(({ volume, ...p }) => ({
            type: "text" as const,
            text: JSON.stringify(p),
          })),
        ],
      };
    } catch (error: any) {
      console.error("find_overlaps error:", error);
      throw new Error(String(error?.message ?? error));
    }
  }
);

server.registerTool(
  "duplicate_objects",
  {
    title: "Duplicate Objects",
    description:
      "Deep-copy objects with all descendants and components. Copy i gets " +
      "positions[i]/rotations[i]/scalings[i] (default: the source's) and the " +
      "source's parent unless parentId is given. Resources (meshes, " +
      "materials, animations) are shared. References to objects inside the " +
      "copied subtree are remapped to the copies (skins are copied, " +
      "animations retarget onto the copy's skin); object properties of " +
      "JavaScript components only if their type is known. Returns " +
      "{sourceId, id, name} per copy, plus notes on anything not copied.",
    inputSchema: duplicateObjectsSchema,
  },
  async ({ duplicates }) => {
    try {
      const { results, notes } = await queue!.push(async () => {
        let componentTypes = null;
        try {
          componentTypes = nativeTools?.getComponentTypes?.() ?? null;
        } catch {
          // Only used for remapping JavaScript component references
        }
        return duplicateObjects(data, duplicates, componentTypes);
      });
      return {
        content: [
          ...results.map((r) => ({
            type: "text" as const,
            text: JSON.stringify(r),
          })),
          ...notes.map((n) => ({ type: "text" as const, text: "Note: " + n })),
        ],
      };
    } catch (error: any) {
      console.error("duplicate_objects error:", error);
      throw new Error(String(error?.message ?? error));
    }
  }
);

/** Maximum number of lines returned by query_scene_tree */
const MAX_TREE_LINES = 500;

server.registerTool(
  "query_scene_tree",
  {
    title: "Query Scene Tree",
    description:
      "Compact indented object hierarchy, one line per object: " +
      "`id name [component types] (n children)`. Children below depth are " +
      "only counted. Use it to find ids and structure before querying " +
      "details with query_resources.",
    inputSchema: querySceneTreeSchema,
  },
  async ({ rootId, depth, includeComponents }) => {
    try {
      const index = buildObjectIndex(data.objects);
      if (rootId !== undefined && !index.nodes.has(rootId))
        throw new Error(`Object ${rootId} not found.`);
      const maxLevel = depth ?? 2;
      const withComponents = includeComponents ?? true;

      const lines: string[] = [];
      let truncated = false;
      const visited = new Set<string>();
      /* level: depth below the start; the scene's root objects are level 1 */
      const visit = (id: string, level: number, indent: number) => {
        if (visited.has(id)) return;
        if (lines.length >= MAX_TREE_LINES) {
          truncated = true;
          return;
        }
        visited.add(id);
        const node = index.nodes.get(id)!;
        const children = index.children.get(id) ?? [];
        let line = "  ".repeat(indent) + `${id} ${node.name}`;
        if (withComponents && node.componentTypes.length > 0)
          line += ` [${node.componentTypes.join(", ")}]`;
        if (children.length > 0) line += ` (${children.length} children)`;
        lines.push(line);
        if (level < maxLevel)
          for (const c of children) visit(c, level + 1, indent + 1);
      };

      if (rootId !== undefined) {
        visit(rootId, 0, 0);
      } else {
        lines.push(
          `Scene: ${index.nodes.size} objects, ${index.roots.length} at the root.`
        );
        if (maxLevel >= 1) for (const r of index.roots) visit(r, 1, 0);
      }
      if (truncated)
        lines.push(
          `... truncated at ${MAX_TREE_LINES} lines. Pass rootId or a smaller depth.`
        );

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (error: any) {
      console.error("query_scene_tree error:", error);
      throw new Error(String(error?.message ?? error));
    }
  }
);
