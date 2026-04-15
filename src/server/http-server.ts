import express from "express";
import cors from "cors";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import startServer from "./server.js";
import { createSessionState, runWithSessionState, type SessionState } from "../core/services/global.js";
import { shutdownBrowserSignerForSession } from "../core/services/wallet.js";
import { SERVER_VERSION } from "./version.js";

const PORT = parseInt(process.env.PORT || "3001", 10);
const HOST = process.env.MCP_HOST || "127.0.0.1";
const API_KEY = process.env.MCP_API_KEY?.trim();
const CORS_ORIGIN = process.env.MCP_CORS_ORIGIN?.trim();
const MAX_SESSIONS = parseInt(process.env.MCP_MAX_SESSIONS || "100", 10);
const SESSION_TIMEOUT_MS = parseInt(process.env.MCP_SESSION_TIMEOUT_MS || "1800000", 10); // 30 min

async function main() {
  if (!API_KEY) {
    throw new Error("MCP_API_KEY is required in HTTP mode. Refusing to start without authentication.");
  }

  const app = express();
  const transports = new Map<string, {
    server: McpServer;
    transport: SSEServerTransport;
    lastActivity: number;
    state: SessionState;
  }>();

  const closeSession = async (sessionId: string) => {
    const session = transports.get(sessionId);
    if (!session) return;
    transports.delete(sessionId);
    await Promise.allSettled([
      shutdownBrowserSignerForSession(session.state),
      session.server.close(),
    ]);
  };

  if (CORS_ORIGIN) {
    app.use(cors({ origin: CORS_ORIGIN }));
  }
  // H-3: Body size limit
  app.use(express.json({ limit: "1mb" }));

  // H-1: API key authentication
  app.use((req, res, next) => {
    if (req.path === "/health") return next();
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${API_KEY}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });

  // M-6: Periodic cleanup of stale sessions
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of transports) {
      if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
        void closeSession(id);
      }
    }
  }, 60_000);

  app.get("/sse", async (_req, res) => {
    // M-6: Max session limit
    if (transports.size >= MAX_SESSIONS) {
      res.status(503).json({ error: "Too many active sessions" });
      return;
    }

    const server = await startServer();
    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;
    const state = createSessionState(sessionId);
    transports.set(sessionId, { server, transport, lastActivity: Date.now(), state });

    res.on("close", () => {
      void closeSession(sessionId);
    });

    try {
      await runWithSessionState(state, () => server.connect(transport));
    } catch (error) {
      transports.delete(sessionId);
      await Promise.allSettled([
        shutdownBrowserSignerForSession(state),
        server.close(),
      ]);
      throw error;
    }
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
    await runWithSessionState(
      session.state,
      () => session.transport.handlePostMessage(req, res, req.body),
    );
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: "mcp-server-justlend", version: SERVER_VERSION });
  });

  app.listen(PORT, HOST, () => {
    console.error(`@justlend/mcp-server-justlend HTTP server listening on http://${HOST}:${PORT}`);
    console.error(`SSE endpoint: http://${HOST}:${PORT}/sse`);
    console.error(`Health check: http://${HOST}:${PORT}/health`);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
