import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express, { Request, Response } from "express";
import { server, setQueue } from "./mcp-server.js";
import { WorkQueue } from "./utils/work-queue.js";

const app = express();
const transports: { [sessionId: string]: SSEServerTransport } = {};

app.get("/sse", async (_: Request, res: Response) => {
  console.log("MCP client connected");
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
  setQueue(params.queue);
  return new Promise<void>((res, rej) => {
    try {
      app.listen(params.port, (error) => {
        if (error) rej(error);
      });
      res();
    } catch (e) {
      rej(e);
    }
  });
}

export async function shutdown() {
  server.close();
}
