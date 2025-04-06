#!/usr/bin/env node

/**
 * This is a template MCP server that implements a simple notes system.
 * It demonstrates core MCP concepts like resources and tools by allowing:
 * - Listing notes as resources
 * - Reading individual notes
 * - Creating new notes via a tool
 * - Summarizing all notes via a prompt
 */

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

/**
 * Create an MCP server with capabilities for resources (to list/read notes),
 * tools (to create new notes), and prompts (to summarize notes).
 */
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

/**
 * Handler for listing available notes as resources.
 * Each note is exposed as a resource with:
 * - A note:// URI scheme
 * - Plain text MIME type
 * - Human readable name and description (now including the note title)
 */
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

/**
 * Handler for reading the contents of a specific note.
 * Takes a note:// URI and returns the note content as plain text.
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const url = new URL(request.params.uri);
  const id = url.pathname.replace(/^\//, "");
  const note = null; // TODO

  if (!note) {
    throw new Error(`Note ${id} not found`);
  }

  return {
    contents: [
      {
        uri: request.params.uri,
        mimeType: "text/plain",
        text: "not found",
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

/**
 * Handler that lists available tools.
 * Exposes a single "create_note" tool that lets clients create new notes.
 */
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

/**
 * Handler for the create_note tool.
 * Creates a new note with the provided title and content, and returns success message.
 */
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
