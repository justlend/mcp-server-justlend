/**
 * TRON Browser Wallet Signer — HTTP Server
 *
 * Localhost-only HTTP server bridging Node.js ↔ browser for wallet signing.
 * Serves the SPA approval UI and exposes API endpoints for the browser to
 * fetch pending requests and submit signed results.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { PendingStore } from "./pending-store.js";
import type { CompleteApiRequest, PendingApiResponse } from "./types.js";
import { getIndexHtml } from "./web-ui.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function handleApiRequest(pathname: string, method: string, body: unknown, store: PendingStore): Response {
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // GET /api/pending/:id
  const pendingMatch = pathname.match(/^\/api\/pending\/([a-f0-9-]+)$/);
  if (pendingMatch && method === "GET") {
    const id = pendingMatch[1];
    const request = store.get(id);
    if (!request) {
      return new Response(JSON.stringify({ error: "Request not found" }), {
        status: 404,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    const response: PendingApiResponse = { request };
    return new Response(JSON.stringify(response), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // POST /api/complete/:id
  const completeMatch = pathname.match(/^\/api\/complete\/([a-f0-9-]+)$/);
  if (completeMatch && method === "POST") {
    const id = completeMatch[1];
    if (!store.has(id)) {
      return new Response(JSON.stringify({ error: "Request not found" }), {
        status: 404,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const data = body as CompleteApiRequest;
    if (typeof data.success !== "boolean") {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const result = data.success
      ? { success: true as const, result: data.result || "" }
      : { success: false as const, error: data.error || "Unknown error" };

    const completed = store.complete(id, result);
    if (!completed) {
      return new Response(JSON.stringify({ error: "Failed to complete request" }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // GET /api/health
  if (pathname === "/api/health" && method === "GET") {
    return new Response(
      JSON.stringify({ status: "ok", pendingRequests: store.size }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    res.end(bytes);
  } else {
    res.end();
  }
}

function serveHtml(): Response {
  return new Response(getIndexHtml(), {
    headers: { "Content-Type": "text/html", "Cache-Control": "no-cache" },
  });
}

function makeHandler(store: PendingStore) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url!, `http://${req.headers.host || "127.0.0.1"}`);
    const pathname = url.pathname;
    const method = req.method || "GET";

    let response: Response;

    if (pathname.startsWith("/api/")) {
      let body: unknown = null;
      if (method === "POST") {
        try {
          const raw = await readBody(req);
          body = JSON.parse(raw);
        } catch {
          response = new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
          await writeResponse(res, response);
          return;
        }
      }
      response = handleApiRequest(pathname, method, body, store);
    } else {
      response = serveHtml();
    }

    await writeResponse(res, response);
  };
}

export async function createHttpServer(
  store: PendingStore,
  port: number,
): Promise<{ port: number; stop: () => Promise<void> }> {
  const srv = createServer(makeHandler(store));

  await new Promise<void>((resolve) => {
    srv.listen(port, "127.0.0.1", () => resolve());
  });

  const actualPort = (srv.address() as AddressInfo).port;

  return {
    port: actualPort,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        srv.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
