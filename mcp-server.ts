import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

import { EditorData, Resource, data } from "@wonderlandengine/editor-api";
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

Object.keys(data).forEach((resourceType) => {
  server.resource(
    resourceType,
    new ResourceTemplate(`${resourceType}:///{id}`, {
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
      const resource = data[resourceType][id] || null;
      if (!resource) {
        throw new Error(`Resource ${uri} not found`);
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
    })
    .array(),
};

server.tool(
  "modify_objects",
  "Create or modify an objects in the Wonderland Engine project.",
  modifyObjectsSchema,
  async ({ modifications }) => {
    try {
      Promise.all(
        modifications.map(({ position, rotation, scaling, id, name }) => {
          id = id ?? randomUUID();

          return queue!.push(() => {
            if (name) data.objects[id].name = name;
            if (position) data.objects[id].translation = position;
            if (rotation) data.objects[id].rotation = rotation;
            if (scaling) data.objects[id].scaling = scaling;
          });
        })
      );

      return {
        content: [
          {
            type: "text",
            text: `Done.`,
          },
        ],
      };
    } catch (error: any) {
      console.error("Validation error:", error);
      console.error("Validation error:", error.errors);
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
