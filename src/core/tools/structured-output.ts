import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/** Stable envelope version for MCP `structuredContent`. Consumers should pin major 1. */
export const TOOL_OUTPUT_SCHEMA_VERSION = "1.0.0" as const;

/**
 * Common output schema applied to every tool. Text content remains unchanged for
 * backwards compatibility; schema-aware clients should consume structuredContent.
 */
export const TOOL_OUTPUT_SCHEMA = {
  schemaVersion: z.literal(TOOL_OUTPUT_SCHEMA_VERSION),
  tool: z.string(),
  result: z.unknown(),
};

/** Key decision output: null means unavailable, never an inferred zero/false. */
export const STRX_ELIGIBILITY_RESULT_SCHEMA = z.object({
  address: z.string(),
  hasStakedTrx: z.boolean().nullable(),
  stakedAmount: z.number().finite().nonnegative().nullable().describe("TRX, human-readable; null when unknown"),
  totalIncome: z.number().finite().nonnegative().nullable().describe("TRX, human-readable; null when unknown"),
  claimableRewards: z.number().finite().nonnegative().nullable().describe("TRX available to claim; null when unknown"),
  withdrawnAmount: z.number().finite().nonnegative().nullable().describe("TRX, human-readable; null when unknown"),
  pendingUnstakeRounds: z.number().int().nonnegative().nullable(),
  completedUnstakeRounds: z.number().int().nonnegative().nullable(),
  hasCompletedWithdrawals: z.boolean().nullable(),
  unfreezeDelayDays: z.number().finite().nonnegative().nullable(),
  roundDetails: z.array(z.object({ endTimestamp: z.union([z.string(), z.number()]) }).passthrough()).nullable()
    .describe("API rounds with Unix-millisecond expiry; null when unavailable, [] only for a known empty queue"),
  claimEligibility: z.enum(["eligible", "ineligible", "unknown"]),
  source: z.string().describe("Account source, normally api or contract"),
  dashboardSource: z.string(),
  dataStatus: z.enum(["complete", "partial"]).describe("Completeness of these eligibility fields, not all dashboard fields"),
  unknownFields: z.array(z.string()),
  note: z.string().optional().describe("Source/degradation details; retain when presenting a result"),
});

export interface StructuredToolOutput {
  schemaVersion: typeof TOOL_OUTPUT_SCHEMA_VERSION;
  tool: string;
  result: unknown;
}

type AnyToolHandler = (...args: any[]) => CallToolResult | Promise<CallToolResult>;

function parseTextContent(response: CallToolResult): unknown {
  const texts = response.content
    .filter((item): item is Extract<(typeof response.content)[number], { type: "text" }> => item.type === "text")
    .map((item) => item.text);

  if (texts.length === 0) return null;
  const parse = (text: string): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
  return texts.length === 1 ? parse(texts[0]!) : texts.map(parse);
}

export function toStructuredToolOutput(tool: string, response: CallToolResult): StructuredToolOutput {
  return {
    schemaVersion: TOOL_OUTPUT_SCHEMA_VERSION,
    tool,
    result: response.structuredContent ?? parseTextContent(response),
  };
}

/**
 * Return the minimal McpServer-compatible registration facade used by tool
 * modules. It injects a common `outputSchema` and wraps successful callbacks
 * with `structuredContent`; `isError` results keep their existing error contract.
 */
export function withStructuredToolOutputs(server: McpServer): McpServer {
  const registerTool = ((name: string, config: Record<string, unknown>, handler: AnyToolHandler) =>
    (server.registerTool as any)(
      name,
      { ...config, outputSchema: name === "check_strx_withdrawal_eligibility"
        ? { ...TOOL_OUTPUT_SCHEMA, result: STRX_ELIGIBILITY_RESULT_SCHEMA }
        : TOOL_OUTPUT_SCHEMA },
      async (...args: any[]) => {
        const response = await handler(...args);
        if (response.isError) return response;
        return {
          ...response,
          structuredContent: toStructuredToolOutput(name, response),
        };
      },
    )) as McpServer["registerTool"];

  return { registerTool } as unknown as McpServer;
}
