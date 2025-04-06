import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ObjectResource, data } from "@wonderlandengine/editor-api";
import { randomUUID } from "crypto";

import express from "express";
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

const server = new Server(
  {
    name: "wonderland-editor-mcp",
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

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: Object.entries(data.objects).map(([id, o]) => ({
      uri: `object:///${id}`,
      mimeType: "text/plain",
      name: o.name,
      description: `A text note: ${o.name}`,
    })),
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const url = new URL(request.params.uri);
  const id = url.pathname.replace(/^\//, "");
  const object = data.objects[id] || null;

  if (!object) {
    throw new Error(`Object ${id} not found`);
  }

  return {
    contents: [
      {
        uri: request.params.uri,
        mimeType: "text/plain",
        text: JSON.stringify(object),
      },
    ],
  };
});

const createObjectSchema = z.object({
  name: z.string().describe("Name for the object"),
  position: z
    .number()
    .array()
    .length(3)
    .describe("Array of three numbers for position"),
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_object",
        description: "Create a new object in the Wonderland Engine project",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name for the object",
            },
            position: {
              type: "array",
              description: "Array of three numbers for position",
            },
          },
          required: ["name", "position"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "create_object": {
      try {
        const parsedArgs = createObjectSchema.parse(request.params.arguments);
        const name = parsedArgs.name;
        const position = parsedArgs.position;
        const id = randomUUID();
        await queue!.push(() => {
          data.objects[id] = {
            name,
            translation: position,
          } as ObjectResource;
        });

        return {
          content: [
            {
              type: "text",
              text: `Created object ${id}: ${name}`,
            },
          ],
        };
      } catch (error: any) {
        console.error("Validation error:", error.errors);
        throw new Error("Invalid arguments: " + JSON.stringify(error.errors));
      }
    }

    default:
      throw new Error("Unknown tool");
  }
});

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: "summarize_notes",
        description: "Summarize all notes",
      },
    ],
  };
});

const app = express();

let transport: SSEServerTransport | null = null;

app.get("/sse", (req, res) => {
  transport = new SSEServerTransport("/messages", res);
  server.connect(transport);
});

app.post("/messages", (req, res) => {
  if (transport) {
    transport.handlePostMessage(req, res);
  }
});

export async function main(params: { port: number; queue: WorkQueue }) {
  queue = params.queue;
  return new Promise(() => {
    app.listen(params.port);
  });
}
