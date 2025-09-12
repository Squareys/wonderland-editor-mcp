import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { data, ObjectResource, tools } from "@wonderlandengine/editor-api";
import { WorkQueue } from "./utils/work-queue.js";
import {
  computeMeshBoundsSchema,
  computeObjectBoundsSchema,
  deleteObjectsSchema,
  importFilesSchema,
  importSceneFilesSchema,
  modifyObjectsSchema,
  modifyResourcesSchema,
  modifySettingsSchema,
  queryResourcesSchema,
  querySettingsSchema,
} from "./schemas.js";
import {
  assignComponentProperties,
  assignNested,
  filterObjectProperties,
} from "./utils/pojo.js";
import {
  computeTreeBounds,
  stringifyWithDefaults,
} from "./utils/editor-api.js";
import path from "node:path";
import { stringify } from "node:querystring";

// JS component property caches (per object-component index and per object+type fallback)
const jsComponentProps = new Map<string, any>();
const jsComponentPropsByObjectType = new Map<string, any>();

export const server = new McpServer({
  name: "Wonderland Editor",
  version: "0.3.0",
});
let queue: WorkQueue | null = null;
export function setQueue(q: WorkQueue) {
  queue = q;
}

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
      let resources: Record<string, any>[] =
        ids && ids.length > 0
          ? ids.map((id) => ({
              id,
              ...allResources[id],
            }))
          : Object.entries(allResources).map(([id, res]) => ({
              id,
              ...res,
            }));

      if (includeFilter && "name" in includeFilter) {
        resources = resources.filter((res: any) => {
          return res.name.indexOf(includeFilter.name) >= 0;
        });
        delete includeFilter.name;
      }

      if (includeFilter) {
        const keys = Object.keys(includeFilter);
        resources = resources.filter((res: any) => {
          for (const key of keys) {
            if (res[key] != includeFilter[key]) return false;
          }
          return true;
        });
      }

      if (excludeFilter && "name" in excludeFilter) {
        resources = resources.filter((res: any) => {
          return res.name.indexOf(excludeFilter.name) >= 0;
        });
        delete excludeFilter.name;
      }

      if (excludeFilter) {
        const keys = Object.keys(excludeFilter);
        resources = resources.filter((res: any) => {
          for (const key of keys) {
            if (res[key] == excludeFilter[key]) return false;
          }
          return true;
        });
      }

      if (paths && paths.length > 0) {
        resources = resources.map(filterObjectProperties.bind(null, paths));
      }

      return {
        content: resources.map((res) => ({
          type: "text",
          text: JSON.stringify(res),
        })),
      };
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
      resetPaths?.forEach((key) => {
        const split = key.split(".");
        try {
          let setting: any = data.settings;
          for (const k of split.slice(0, -1)) {
            setting = setting[k];
            if (setting === undefined || setting === null) return; // nothing to delete
          }
        } catch {
          errors.push(`Could not reset setting at path ${key} - not found.`);
        }
      });

      if (changeSettings) {
        assignNested(data.settings, changeSettings);
      }

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

server.registerTool(
  "delete_objects",
  {
    title: "Delete Objects",
    description: "Delete objects.",
    inputSchema: deleteObjectsSchema,
  },
  async ({ objectIds }) => {
    try {
      await queue!.push(async () => {
        objectIds.map((objectId) => {
          delete data.objects[objectId];
        });
      });

      return {
        content: [{ type: "text", text: "Done." }],
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
      "If an id is not used, the object will be created.",
    inputSchema: modifyObjectsSchema,
  },
  async ({ modifications }) => {
    try {
      await queue!.push(async () => {
        modifications.map(
          ({
            parentId,
            position,
            rotation,
            scaling,
            id,
            name,
            addComponents,
            modifyComponents,
            removeComponents,
          }) => {
            const o: ObjectResource = id
              ? data.objects[id]
              : data.objects.add();

            if (name) o.name = name;
            if (parentId) o.parent = parentId;
            if (position) o.translation = position;
            if (rotation) o.rotation = rotation;
            if (scaling) o.scaling = scaling;
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
              removeComponents
                .sort()
                .reverse()
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
          }
        );
      });
      return { content: [{ type: "text", text: "Done." }] };
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
      await queue!.push(async () => {
        modifications.map(
          ({ id, resourceType, changeProperties, resetProperties }) => {
            // @ts-ignore
            const res = data[resourceType][id];

            if (resetProperties) {
              resetProperties.forEach((key) => {
                delete res[key];
              });
            }

            if (changeProperties) {
              assignNested(res, changeProperties);
            }
          }
        );
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
  "import_scenes",
  {
    title: "Import Scenes",
    description:
      "Import scene files (e.g. GLB, FBX, OBJ) by path. Try to batch calls to this function.",
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

          for (const oid of importedRootIds) {
            const { bounds: b, count } = computeTreeBounds(oid, data.objects);
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
        imports.map((path) => tools.loadFile(path));
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
        return { min: out.subarray(0, 3), max: out.subarray(3, 6) };
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

server.registerTool(
  "compute_object_bounds",
  {
    title: "Compute Object Bounds",
    description:
      "Compute aggregated subtree bounds for the given object IDs (including children).",
    inputSchema: computeObjectBoundsSchema,
  },
  async ({ objectIds }: { objectIds: string[] }) => {
    try {
      const out = objectIds.map((oid: string) => {
        const { bounds: b, count } = computeTreeBounds(oid, data.objects);
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
