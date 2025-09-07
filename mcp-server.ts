import {
  McpServer,
  ResourceTemplate,
  ReadResourceTemplateCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  EditorData,
  Resource,
  data,
  tools,
} from "@wonderlandengine/editor-api";

import { WorkQueue } from "./utils/work-queue.js";
import { randomUUID } from "crypto";
import {
  ResourceTypes,
  computeMeshBoundsSchema,
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
  joinBounds,
  scaleBounds,
  computeTreeBounds as computeTreeBoundsUtil,
  getBasename,
} from "./utils.js";
import { PaginatedResultSchema } from "@modelcontextprotocol/sdk/types.js";

export const server = new McpServer({
  name: "Wonderland Editor",
  version: "0.1.0",
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
      console.error("Validation errors:", error, error?.errors ?? "");
      throw new Error("Invalid arguments: " + JSON.stringify(error.errors));
    }
  }
);

server.registerTool(
  "query_settings",
  {
    title: "Query Settings",
    description:
      "Retrieve the current project settings. Specify paths like 'rendering' to retrieve only rendering settings.",
    inputSchema: querySettingsSchema,
  },
  async ({ paths }: { paths?: string[] }) => {
    try {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(filterObjectProperties(paths, data.settings)),
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
  async ({ changeSettings, resetSettings }) => {
    try {
      resetSettings?.forEach((key) => {
        const split = key.split(".");

        let setting = data.settings;
        for (const k of split.splice(0, split.length - 1)) {
          // @ts-ignore
          setting = setting[k];
        }
        // @ts-ignore
        delete setting[split[0]];
      });

      if (changeSettings) assignNested(data.settings, changeSettings);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data.settings),
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
      await queue!.push(async () => {
        objectIds.map((objectId) => {
          delete data.objects[objectId];
        });
      });

      return {
        content: [{ type: "text", text: "Done." }],
      };
    } catch (error: any) {
      console.error("Validation errors:", error, error?.errors ?? "");
      throw new Error("Invalid arguments: " + JSON.stringify(error.errors));
    }
  }
);

server.registerTool(
  "modify_objects",
  {
    title: "Modify Objects",
    description:
      "Create or modify an objects in the Wonderland Engine project. " +
      "Properties not specified in modifications are kept as-is.",
    inputSchema: modifyObjectsSchema,
  },
  async ({ modifications }) => {
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
          id = id ?? randomUUID();
          const o = data.objects[id];

          if (name) o.name = name;
          if (parentId) o.parent = parentId;
          if (position) o.translation = position;
          if (rotation) o.rotation = rotation;
          if (scaling) o.scaling = scaling;
          if (modifyComponents) {
            modifyComponents.forEach(({ index, properties }) => {
              const comp = o.components[index];
              if (comp.type == null) return;
              //@ts-ignore
              const props = comp[comp.type];
              assignComponentProperties(comp.type, props, properties, o, index);
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
              assignComponentProperties(c.type, comp, c.properties, o, index);
              console.log("Assigned properties", o.components[index]);
            });
          }
        }
      );
    });

    return { content: [{ type: "text", text: "Done." }] };
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
      console.error("Validation errors:", error, error?.errors ?? "");
      throw new Error("Invalid arguments: " + JSON.stringify(error.errors));
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
      // Debug: Log raw inputs to help diagnose schema/shape issues during tests
      console.log("import_scenes received imports:", JSON.stringify(imports));
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

      // Thin wrapper to call utility with editor data and tools callback
      const computeTreeBounds = (objectId: string) =>
        computeTreeBoundsUtil(
          objectId,
          data.objects as any,
          (meshId: string, out: Float32Array) =>
            tools.computeMeshBounds(meshId, out)
        );

      await queue!.push(async () => {
        // For each import, create a new container object (named after the file basename),
        // import the scene under it, then report the immediate children with their tree bounds.
        for (const entry of imports as any[]) {
          const scenePath = (entry as any)?.path;
          // Create container object at root
          const containerId = randomUUID();
          let effectiveContainerId: string = containerId as unknown as string;
          const containerObj = (data.objects as any)[containerId];
          const baseName = getBasename(scenePath);
          containerObj.name = baseName;

          // Snapshot existing object IDs to detect new ones created by this import
          const beforeIds = new Set(Object.keys(data.objects as any));
          console.log(
            "[import_scenes] container:",
            containerId,
            "before count:",
            beforeIds.size
          );

          // Import under the created container
          await tools.loadScene(scenePath, { parent: containerId });

          // Compute set of new object IDs
          const allObjects: Record<string, any> = data.objects as any;
          const newIds = new Set<string>();
          for (const id of Object.keys(allObjects))
            if (!beforeIds.has(id)) newIds.add(id);
          console.log(
            "[import_scenes] after count:",
            Object.keys(allObjects).length,
            "new ids:",
            Array.from(newIds)
          );

          // Imported roots are the newly created objects that are direct children of the container
          const importedRootIds: string[] = [];
          for (const id of newIds) {
            const p = allObjects[id]?.parent;
            if (p != null && String(p) === String(containerId)) {
              importedRootIds.push(id);
            }
            console.log(
              "[import_scenes] candidate id:",
              id,
              "parent:",
              p,
              "match:",
              String(p) === String(containerId)
            );
          }

          console.log("[import_scenes] imported root ids:", importedRootIds);

          // Fallback: some importers may ignore the requested parent. If exactly one
          // new object was created, assume it's the imported root and use it as container.
          if (importedRootIds.length === 0) {
            const newArr = Array.from(newIds);
            if (newArr.length === 1) {
              const rid = newArr[0];
              importedRootIds.push(rid);
              // Set container to the same id and apply the basename to help users identify it
              // if it didn't already have a meaningful name.
              try {
                effectiveContainerId = rid as unknown as string;
                allObjects[rid].name = baseName;
              } catch {}
              console.log(
                "[import_scenes] fallback: using",
                rid,
                "as container and root"
              );
            }
          }

          // Compute bounds per imported root
          for (const oid of importedRootIds) {
            const { bounds: b, count } = computeTreeBounds(oid);
            if (b) {
              results.push({
                id: oid,
                rootId: oid,
                containerId: effectiveContainerId,
                bounds: { min: [b[0], b[1], b[2]], max: [b[3], b[4], b[5]] },
                count,
              });
            } else {
              results.push({
                id: oid,
                rootId: oid,
                containerId: effectiveContainerId,
                bounds: null,
                count,
              });
            }
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
      console.error("Validation errors:", error, error?.errors ?? "");
      throw new Error("Invalid arguments: " + JSON.stringify(error.errors));
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
      console.error("Validation errors:", error, error?.errors ?? "");
      throw new Error("Invalid arguments: " + JSON.stringify(error.errors));
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
      console.error("Validation errors:", error, error?.errors ?? "");
      throw new Error("Invalid arguments: " + JSON.stringify(error.errors));
    }
  }
);
