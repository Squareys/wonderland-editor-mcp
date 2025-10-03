import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express, { NextFunction, Request, Response } from "express";
import { server, setQueue } from "./mcp-server.js";
import { WorkQueue } from "./utils/work-queue.js";
import { randomUUID } from "crypto";

const app = express();
app.use(express.json());

app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(req.method, req.path);
  console.dir(req.body, { depth: null });
  next();
});

const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

app.post("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports[sessionId]) {
    transport = transports[sessionId];
  } else if (!sessionId && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        transports[sessionId] = transport;
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        delete transports[transport.sessionId];
      }
    };
    console.log("Client connecting with sessionId:", transport.sessionId);
    await server.connect(transport);
  } else {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: No valid session ID provided",
      },
      id: null,
    });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

const handleSessionRequest = async (
  req: express.Request,
  res: express.Response
) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
};

app.get("/mcp", handleSessionRequest);
app.delete("/mcp", handleSessionRequest);

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
