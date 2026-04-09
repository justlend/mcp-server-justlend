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
import { buildLocalOrigin } from "./browser.js";
import { getIndexHtml } from "./web-ui.js";

const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const API_ALLOWED_METHODS = "GET, POST, OPTIONS";
const API_ALLOWED_HEADERS = "Content-Type, X-Approval-Token";

interface ServerContext {
  allowedOrigin: string;
}

const HTML_HEADERS = {
  "Cache-Control": "no-cache",
  "Content-Type": "text/html",
  "Referrer-Policy": "no-referrer",
};

class RequestTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestTooLargeError";
  }
}

function buildCorsHeaders(allowedOrigin: string) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": API_ALLOWED_METHODS,
    "Access-Control-Allow-Headers": API_ALLOWED_HEADERS,
    Vary: "Origin",
  };
}

function jsonResponse(body: unknown, status: number, allowedOrigin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...buildCorsHeaders(allowedOrigin), "Content-Type": "application/json" },
  });
}

function getApprovalToken(req: IncomingMessage): string | null {
  const value = req.headers["x-approval-token"];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function isAuthorized(store: PendingStore, requestId: string, req: IncomingMessage): boolean {
  return store.isAuthorized(requestId, getApprovalToken(req));
}

function requireAuthorizedRequest(store: PendingStore, requestId: string, req: IncomingMessage, allowedOrigin: string): Response | null {
  if (isAuthorized(store, requestId, req)) {
    return null;
  }
  return jsonResponse({ error: "Unauthorized" }, 401, allowedOrigin);
}

function handleApiRequest(
  pathname: string,
  method: string,
  body: unknown,
  req: IncomingMessage,
  store: PendingStore,
  allowedOrigin: string,
): Response {
  const corsHeaders = buildCorsHeaders(allowedOrigin);
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // GET /api/pending/:id
  const pendingMatch = pathname.match(/^\/api\/pending\/([a-f0-9-]+)$/);
  if (pendingMatch && method === "GET") {
    const id = pendingMatch[1];
    const unauthorized = requireAuthorizedRequest(store, id, req, allowedOrigin);
    if (unauthorized) return unauthorized;

    const request = store.get(id);
    if (!request) {
      return jsonResponse({ error: "Request not found" }, 404, allowedOrigin);
    }
    const response: PendingApiResponse = { request };
    return jsonResponse(response, 200, allowedOrigin);
  }

  // POST /api/complete/:id
  const completeMatch = pathname.match(/^\/api\/complete\/([a-f0-9-]+)$/);
  if (completeMatch && method === "POST") {
    const id = completeMatch[1];
    const unauthorized = requireAuthorizedRequest(store, id, req, allowedOrigin);
    if (unauthorized) return unauthorized;

    if (!store.has(id)) {
      return jsonResponse({ error: "Request not found" }, 404, allowedOrigin);
    }

    const data = body as CompleteApiRequest;
    if (typeof data?.success !== "boolean") {
      return jsonResponse({ error: "Invalid request body" }, 400, allowedOrigin);
    }

    const result = data.success
      ? { success: true as const, result: data.result || "" }
      : { success: false as const, error: data.error || "Unknown error" };

    const completed = store.complete(id, result);
    if (!completed) {
      return jsonResponse({ error: "Failed to complete request" }, 500, allowedOrigin);
    }

    return jsonResponse({ ok: true }, 200, allowedOrigin);
  }

  return jsonResponse({ error: "Not found" }, 404, allowedOrigin);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const headerValue = req.headers["content-length"];
    const contentLength = typeof headerValue === "string" ? Number(headerValue) : NaN;
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
      reject(new RequestTooLargeError(`Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`));
      return;
    }

    let body = "";
    let size = 0;
    let settled = false;

    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
    };

    const onData = (chunk: string) => {
      size += Buffer.byteLength(chunk, "utf8");
      if (size > MAX_REQUEST_BODY_BYTES) {
        if (settled) return;
        settled = true;
        cleanup();
        req.resume();
        reject(new RequestTooLargeError(`Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`));
        return;
      }
      body += chunk;
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(body);
    };

    const onError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    req.setEncoding("utf8");
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
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
  return new Response(getIndexHtml(), { headers: HTML_HEADERS });
}

function makeHandler(store: PendingStore, context: ServerContext) {
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
        } catch (error) {
          response = error instanceof RequestTooLargeError
            ? jsonResponse({ error: error.message }, 413, context.allowedOrigin)
            : jsonResponse({ error: "Invalid JSON" }, 400, context.allowedOrigin);
          await writeResponse(res, response);
          return;
        }
      }
      response = handleApiRequest(pathname, method, body, req, store, context.allowedOrigin);
    } else {
      response = serveHtml();
    }

    await writeResponse(res, response);
  };
}

export const __testing = {
  buildCorsHeaders,
  handleApiRequest,
  readBody,
};

export async function createHttpServer(
  store: PendingStore,
  port: number,
): Promise<{ port: number; stop: () => Promise<void> }> {
  const context: ServerContext = {
    allowedOrigin: "",
  };
  const srv = createServer(makeHandler(store, context));

  await new Promise<void>((resolve) => {
    srv.listen(port, "127.0.0.1", () => resolve());
  });

  const actualPort = (srv.address() as AddressInfo).port;
  context.allowedOrigin = buildLocalOrigin(actualPort);

  return {
    port: actualPort,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        srv.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
