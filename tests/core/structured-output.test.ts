import { describe, expect, it, vi } from "vitest";
import { withStructuredToolOutputs } from "../../src/core/tools/structured-output.js";
import { z } from "zod";

function captureServer() {
  const captured = new Map<string, { config: any; handler: Function }>();
  const server = {
    registerTool: vi.fn((name: string, config: any, handler: Function) => {
      captured.set(name, { config, handler });
      return {};
    }),
  } as any;
  return { server, captured };
}

describe("common MCP structured output", () => {
  it("preserves text content and adds a parsed structuredContent envelope", async () => {
    const { server, captured } = captureServer();
    const facade = withStructuredToolOutputs(server);
    facade.registerTool(
      "example",
      { description: "Example", inputSchema: {} },
      async () => ({ content: [{ type: "text", text: '{"value":"42"}' }] }),
    );

    const tool = captured.get("example")!;
    expect(tool.config.outputSchema).toBeDefined();
    const result = await tool.handler({});
    expect(result.content[0].text).toBe('{"value":"42"}');
    expect(result.structuredContent).toEqual({
      schemaVersion: "1.0.0",
      tool: "example",
      result: { value: "42" },
    });
  });

  it("leaves isError responses on the existing error contract", async () => {
    const { server, captured } = captureServer();
    const facade = withStructuredToolOutputs(server);
    facade.registerTool(
      "fails",
      { description: "Fails", inputSchema: {} },
      async () => ({
        isError: true,
        content: [{ type: "text", text: '{"error":"bad","retryable":false}' }],
      }),
    );

    const result = await captured.get("fails")!.handler({});
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  it("declares a business result schema for sTRX eligibility, not just the generic envelope", () => {
    const { server, captured } = captureServer();
    withStructuredToolOutputs(server).registerTool("check_strx_withdrawal_eligibility", { inputSchema: {} },
      async () => ({ content: [] }));
    const resultSchema = captured.get("check_strx_withdrawal_eligibility")!.config.outputSchema.result;
    expect(resultSchema).toBeInstanceOf(z.ZodObject);
    expect(resultSchema.shape.claimableRewards.safeParse(null).success).toBe(true);
    expect(resultSchema.shape.claimableRewards.safeParse(undefined).success).toBe(false);
    expect(resultSchema.shape.claimableRewards.safeParse("unknown").success).toBe(false);
    expect(resultSchema.shape.claimEligibility.safeParse("unknown").success).toBe(true);
  });
});
