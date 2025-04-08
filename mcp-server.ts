import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

import {
  EditorData,
  Resource,
  data,
  tools,
} from "@wonderlandengine/editor-api";
import { randomUUID } from "crypto";

import express, { Request, Response } from "express";
import { z } from "zod";

export class WorkQueue {
  _queue: { func: () => void; res: () => void; rej: (e: any) => void }[] = [];
  async push(func: () => void): Promise<void> {
    return new Promise<void>((res, rej) => {
      this._queue.push({ func, res, rej });
    });
  }

  pop(): boolean {
    if (this._queue.length == 0) return false;
    const { func, res, rej } = this._queue.pop()!;
    try {
      func();
      res();
    } catch (e) {
      rej(e);
    }

    return true;
  }
}

let queue: WorkQueue | null = null;

const server = new McpServer(
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

[
  "objects",
  "textures",
  "meshes",
  "materials",
  "animations",
  "skins",
  "images",
  "shaders",
  "pipelines",
  "fonts",
  "morphTargets",
  "particleEffects",
].forEach((resourceType) => {
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
            mimeType: "text/plain",
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

const modifyObjectsSchema = {
  modifications: z
    .object({
      name: z.string().describe("Name for the object").optional(),
      id: z.string().describe("ID of the object").optional(),
      parentId: z
        .string()
        .describe("ID of the parent to parent to.")
        .optional(),
      position: z
        .number()
        .array()
        .length(3)
        .describe("Array of three numbers for position")
        .optional(),
      rotation: z
        .number()
        .array()
        .length(4)
        .describe("Array of four numbers for rotation quaternion")
        .optional(),
      scaling: z
        .number()
        .array()
        .length(3)
        .describe("Array of three numbers for scaling")
        .optional(),
      addComponents: z
        .object({
          type: z.string(),
          properties: z.object({}).passthrough(),
        })
        .array()
        .describe(
          "Components to add to the object, any object in the format {type: string, [type]: {properties}}"
        )
        .optional(),
      modifyComponents: z
        .object({
          index: z.number(),
          properties: z.object({}).passthrough(),
        })
        .array()
        .describe("Components to modify on the object.")
        .optional(),
      removeComponents: z
        .number()
        .array()
        .describe("Indices of components to remove from the object")
        .optional(),
    })
    .array(),
};

server.tool(
  "modify_objects",
  "Create or modify an objects in the Wonderland Engine project.",
  modifyObjectsSchema,
  async ({ modifications }) => {
    try {
      await queue!.push(() => {
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
                if (o.components[index].type == null) return;
                Object.assign(
                  // @ts-ignore
                  o.components[index][o.components[index].type],
                  properties
                );
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

const importSceneFilesSchema = {
  imports: z
    .object({
      path: z.string(),
      parentId: z
        .string()
        .describe(
          "ID of the parent to parent to, leave empty to import at root."
        )
        .optional(),
    })
    .array(),
};

server.tool(
  "import_files",
  "Import scene files by path.",
  importSceneFilesSchema,
  async ({ imports }) => {
    try {
      await queue!.push(() => {
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

const app = express();
const transports: { [sessionId: string]: SSEServerTransport } = {};

app.get("/sse", async (_: Request, res: Response) => {
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;
  res.on("close", () => {
    delete transports[transport.sessionId];
  });
  await server.connect(transport);
});

app.post("/messages", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports[sessionId];
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("No transport found for sessionId");
  }
});

export async function main(params: { port: number; queue: WorkQueue }) {
  queue = params.queue;
  return new Promise(() => {
    app.listen(params.port);
  });
}

export async function shutdown() {
  server.close();
}
