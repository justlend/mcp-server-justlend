import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";

import { __testing } from "../../../src/core/browser-signer/http-server.js";
import { PendingStore } from "../../../src/core/browser-signer/pending-store.js";

describe("browser signer http server", () => {
  const allowedOrigin = "http://127.0.0.1:13847";

  function makeRequest(headers: Record<string, string> = {}): IncomingMessage {
    return { headers } as IncomingMessage;
  }

  it("rejects API access without the per-request approval token", async () => {
    const store = new PendingStore();
    const { id } = store.createConnectRequest({ network: "mainnet" });
    const response = __testing.handleApiRequest(
      `/api/pending/${id}`,
      "GET",
      null,
      makeRequest(),
      store,
      allowedOrigin,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(response.headers.get("access-control-allow-origin")).toBe(allowedOrigin);
  });

  it("serves pending requests only when the matching approval token is provided", async () => {
    const store = new PendingStore();
    const { id, authToken } = store.createSignMessageRequest({
      message: "hello",
      network: "mainnet",
    });
    const response = __testing.handleApiRequest(
      `/api/pending/${id}`,
      "GET",
      null,
      makeRequest({ "x-approval-token": authToken }),
      store,
      allowedOrigin,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      request: {
        id,
        type: "sign_message",
        message: "hello",
        network: "mainnet",
        createdAt: expect.any(Number),
      },
    });
  });

  it("rejects oversized completion payloads before parsing JSON", async () => {
    const req = new PassThrough() as IncomingMessage;
    req.headers = {
      "content-length": String(1024 * 1024 + 1),
    };

    await expect(__testing.readBody(req)).rejects.toThrow(
      "Request body exceeds 1048576 bytes",
    );
  });
});
