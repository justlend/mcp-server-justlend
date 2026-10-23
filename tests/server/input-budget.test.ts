import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { registerJustLendTools } from "../../src/core/tools/index.js";
import startServer from "../../src/server/server.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("../../src/core/resources.js", () => ({ registerJustLendResources: vi.fn() }));
vi.mock("../../src/core/prompts.js", () => ({ registerJustLendPrompts: vi.fn() }));
vi.mock("../../src/core/tools/index.js", () => ({ registerJustLendTools: vi.fn() }));
vi.mock("../../src/core/services/wallet.js", () => ({
  checkWalletStatus: vi.fn(async () => ({ hasWallets: false })),
}));

const INPUT_ELEMENT_LIMIT = 10_000;

describe("production server tool-input budget", () => {
  let server: McpServer;
  let client: Client;
  const handler = vi.fn(async () => ({ content: [{ type: "text" as const, text: "accepted" }] }));

  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    handler.mockClear();
    vi.mocked(registerJustLendTools).mockImplementation((instance) => {
      instance.tool("budget_probe", "Offline input-budget regression", { payload: z.unknown() }, handler);
    });
    server = await startServer();
    client = new Client({ name: "input-budget-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client?.close();
    await server?.close();
    vi.restoreAllMocks();
  });

  it("accepts the exact combined element boundary", async () => {
    // One root object member plus N array elements. No network or signing.
    const result = await client.callTool({
      name: "budget_probe",
      arguments: { payload: Array(INPUT_ELEMENT_LIMIT - 1).fill(0) },
    });
    expect(result.isError).not.toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["array elements", () => Array(INPUT_ELEMENT_LIMIT).fill(0)],
    ["object members", () => Object.fromEntries(Array.from({ length: INPUT_ELEMENT_LIMIT }, (_, i) => [`k${i}`, 0]))],
    ["nested elements", () => ({ groups: Array.from({ length: 100 }, () => ({ values: Array(100).fill(0) })) })],
  ] as const)("rejects oversized %s before invoking a tool and remains usable", async (_label, createPayload) => {
    const result = await client.callTool({ name: "budget_probe", arguments: { payload: createPayload() } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/maximum of 10000 elements/);
    expect(handler).not.toHaveBeenCalled();

    const next = await client.callTool({ name: "budget_probe", arguments: { payload: ["small"] } });
    expect(next.isError).not.toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
