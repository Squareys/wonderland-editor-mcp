import {
  McpServer,
  ResourceTemplate,
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
  importFilesSchema,
  importSceneFilesSchema,
  modifyObjectsSchema,
  queryResourcesSchema,
} from "./schemas.js";

export const server = new McpServer(
  {
    name: "Wonderland Editor",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
      prompts: {},
    },
  }
);

let queue: WorkQueue | null = null;
export function setQueue(q: WorkQueue) {
  queue = q;
}

ResourceTypes.forEach((resourceType) => {
  console.log("Set up", resourceType, "resource");
  server.resource(
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
    async (uri, { id }) => {
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

server.tool(
  "query_resources",
  "List resources of a certain type, filtering by property, if needed.",
  queryResourcesSchema,
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

server.tool(
  "modify_objects",
  "Create or modify an objects in the Wonderland Engine project.",
  modifyObjectsSchema,
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
                Object.assign(o.components[index][c.type], c.properties);
              });
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

server.tool(
  "import_scenes",
  "Import scene files (e.g. GLB, FBX, OBJ) by path.",
  importSceneFilesSchema,
  async ({ imports }) => {
    try {
      await queue!.push(async () => {
        imports.map(({ path, parentId }) => {
          tools.loadScene(path, { parent: parentId });
        });
      });

      return { content: [{ type: "text", text: "Done." }] };
    } catch (error: any) {
      console.error("Validation errors:", error, error?.errors ?? "");
      throw new Error("Invalid arguments: " + JSON.stringify(error.errors));
    }
  }
);

server.tool(
  "import_files",
  "Import files (e.g. images) by path.",
  importFilesSchema,
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
