import express from "express";
import cors from "cors";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import startServer from "./server.js";

const PORT = parseInt(process.env.PORT || "3001", 10);
const API_KEY = process.env.MCP_API_KEY;
const CORS_ORIGIN = process.env.MCP_CORS_ORIGIN || "*";
const MAX_SESSIONS = parseInt(process.env.MCP_MAX_SESSIONS || "100", 10);
const SESSION_TIMEOUT_MS = parseInt(process.env.MCP_SESSION_TIMEOUT_MS || "1800000", 10); // 30 min

async function main() {
  const server = await startServer();
  const app = express();

  // H-3: CORS
  app.use(cors({ origin: CORS_ORIGIN }));
  // H-3: Body size limit
  app.use(express.json({ limit: "1mb" }));

  // H-1: API key authentication
  if (API_KEY) {
    app.use((req, res, next) => {
      if (req.path === "/health") return next();
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${API_KEY}`) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      next();
    });
  } else {
    console.error("WARNING: MCP_API_KEY not set. HTTP server is running without authentication.");
  }

  // M-6: Session management with timeout
  const transports = new Map<string, { transport: SSEServerTransport; lastActivity: number }>();

  // M-6: Periodic cleanup of stale sessions
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of transports) {
      if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
        transports.delete(id);
      }
    }
  }, 60_000);

  app.get("/sse", async (_req, res) => {
    // M-6: Max session limit
    if (transports.size >= MAX_SESSIONS) {
      res.status(503).json({ error: "Too many active sessions" });
      return;
    }

    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;
    transports.set(sessionId, { transport, lastActivity: Date.now() });

    res.on("close", () => {
      transports.delete(sessionId);
    });

    await server.connect(transport);
  });

  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string;

    // H-3: Validate sessionId format
    if (!sessionId || !/^[\w-]+$/.test(sessionId)) {
      res.status(400).json({ error: "Invalid session ID" });
      return;
    }

    const session = transports.get(sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    session.lastActivity = Date.now();
    await session.transport.handlePostMessage(req, res);
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: "mcp-server-justlend", version: "1.0.0" });
  });

  app.listen(PORT, () => {
    console.error(`@justlend/mcp-server-justlend HTTP server listening on port ${PORT}`);
    console.error(`SSE endpoint: http://localhost:${PORT}/sse`);
    console.error(`Health check: http://localhost:${PORT}/health`);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
