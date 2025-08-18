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
import {assignComponentProperties, assignNested} from "./utils.js";

export const server = new McpServer({
  name: "Wonderland Editor",
  version: "0.1.0",
});

let queue: WorkQueue | null = null;
export function setQueue(q: WorkQueue) {
  queue = q;
}

ResourceTypes.forEach((resourceType) => {
  console.log("Set up", resourceType, "resource");
  server.registerResource(
    resourceType,
    new ResourceTemplate(`${resourceType}://{id}`, {
      list: () => {
        return {
          resources: Object.entries(
            //@ts-ignore
            data[resourceType as keyof EditorData]
          ).map(([id, r]) => ({
            uri: `${resourceType}://${id}`,
            mimeType: "application/json",
            name: (r as Resource).name,
          })),
        };
      },
    }),
    {
      title: resourceType,
      description: `Wonderland Engine ${resourceType} resource`,
    },
    async (uri: any, { params }: any) => {
      const { id } = params;
      // @ts-ignore
      const resource = data[resourceType][id.toString()];
      if (!resource) {
        throw new Error(`${resourceType} resource with id ${id} not found`);
      }

      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "text/plain",
            text: JSON.stringify(resource),
          },
        ],
      };
    }
  );
});

server.registerTool(
  "query_resources",
  {
    title: "Query Resources",
    description:
      "List resources of a certain type, filtering by property, if needed.",
    inputSchema: queryResourcesSchema,
  },
  async ({ resourceType, ids, includeFilter, excludeFilter }) => {
    try {
      // @ts-ignore
      const allResources: Record<string, any> = data[resourceType];
      let resources: Record<string, any>[] =
        ids && ids.length > 0
          ? ids.map((id) => ({ id, ...allResources[id] }))
          : Object.entries(allResources).map(([id, res]) => ({ id, ...res }));

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
    description: "Retrieve the current project settings.",
    inputSchema: querySettingsSchema,
  },
  async ({}) => {
    try {
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

      if(changeSettings) assignNested(data.settings, changeSettings);

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
      "Create or modify an objects in the Wonderland Engine project.",
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
      "Create or modify resources in the Wonderland Engine project. Cannot be used to modify objects. Use modify_objects to modify objects.",
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
              Object.assign(res, changeProperties);
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
    description: "Import scene files (e.g. GLB, FBX, OBJ) by path.",
    inputSchema: importSceneFilesSchema,
  },
  async ({ imports }) => {
    try {
      await queue!.push(async () => {
        await Promise.all(
          imports.map(({ path, parentId }) => {
            return tools.loadScene(path, { parent: parentId });
          })
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
  "import_files",
  {
    title: "Import Files",
    description: "Import files (e.g. images) by path.",
    inputSchema: importFilesSchema,
  },
  async ({ imports }) => {
    try {
      await queue!.push(async () => {
        imports.map(({ path }) => {
          tools.loadFile(path);
        });
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
