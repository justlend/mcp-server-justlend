import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as services from "../services/index.js";
import { toolError, tronAddress, amountOrMaxString, rawUnitsString } from "./shared.js";

export function registerMoolahLiquidationTools(server: McpServer) {

  // ── Read ────────────────────────────────────────────────────────────────────

  server.registerTool(
    "get_moolah_pending_liquidations",
    {
      description:
        "List Moolah positions eligible or approaching liquidation. " +
        "riskLevel > 1.0 means the position is liquidatable right now. " +
        "Use minRiskLevel=0.9 to find positions near the threshold.",
      inputSchema: {
        minRiskLevel: z.number().optional().describe("Minimum risk level (e.g. 0.9 for near-liquidatable, 1.0 for liquidatable now)"),
        maxRiskLevel: z.number().optional().describe("Maximum risk level filter"),
        debtToken: z.string().optional().describe("Filter by loan token symbol (e.g. 'USDT')"),
        collateralToken: z.string().optional().describe("Filter by collateral token symbol (e.g. 'TRX')"),
        page: z.number().optional().describe("Page number (0-indexed). Default: 0"),
        pageSize: z.number().optional().describe("Results per page. Default: 20"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Pending Liquidations", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ minRiskLevel, maxRiskLevel, debtToken, collateralToken, page = 0, pageSize = 20, network = services.getGlobalNetwork() }) => {
      try {
        const res = await services.fetchMoolahPendingLiquidations(
          { minRiskLevel, maxRiskLevel, debt: debtToken, collateral: collateralToken, page, pageSize },
          network,
        );
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_moolah_liquidation_quote",
    {
      description:
        "Estimate the loan token cost to liquidate a position. " +
        "Provide either seizedAssets (collateral to take) OR repaidShares (borrow shares to repay), not both. " +
        "Returns the exact loan token amount needed. Use this before calling moolah_liquidate.",
      inputSchema: {
        marketId: z.string().describe("Market ID (bytes32 hex)"),
        seizedAssets: rawUnitsString("Collateral amount to seize (raw units). Provide this OR repaidShares.").optional(),
        repaidShares: rawUnitsString("Borrow shares to repay (raw units). Provide this OR seizedAssets.").optional(),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Liquidation Quote", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ marketId, seizedAssets = "0", repaidShares = "0", network = services.getGlobalNetwork() }) => {
      try {
        const loanNeeded = await services.getMoolahLoanTokenAmountNeed(
          marketId,
          BigInt(seizedAssets),
          BigInt(repaidShares),
          network,
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              marketId,
              seizedAssets,
              repaidShares,
              loanTokenAmountNeeded: loanNeeded.toString(),
              note: "Amount is in raw token units. Divide by 10^decimals for human-readable value.",
            }, null, 2),
          }],
        };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_moolah_liquidation_records",
    {
      description:
        "Historical liquidation events on Moolah — both bot-executed and public liquidations.",
      inputSchema: {
        type: z.enum(["bot", "public"]).optional().describe("Filter by liquidator type"),
        debtToken: z.string().optional().describe("Filter by loan token symbol"),
        collateralToken: z.string().optional().describe("Filter by collateral token symbol"),
        page: z.number().optional().describe("Page number (0-indexed). Default: 0"),
        pageSize: z.number().optional().describe("Results per page. Default: 20"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Liquidation Records", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ type, debtToken, collateralToken, page = 0, pageSize = 20, network = services.getGlobalNetwork() }) => {
      try {
        const res = await services.fetchMoolahLiquidationRecords(
          { type, debt: debtToken, collateral: collateralToken, page, pageSize },
          network,
        );
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  // ── Write ───────────────────────────────────────────────────────────────────

  server.registerTool(
    "moolah_liquidate",
    {
      description:
        "Liquidate an undercollateralized Moolah position. " +
        "You must hold the loan token and have approved it via approve_liquidator_token. " +
        "Provide EITHER seizedAssets (collateral to seize) OR repaidShares (borrow shares to repay), not both. " +
        "Use get_moolah_liquidation_quote first to estimate the required loan token amount.",
      inputSchema: {
        marketId: z.string().describe("Market ID (bytes32 hex)"),
        borrower: tronAddress("Address of the borrower to liquidate (Base58)"),
        seizedAssets: rawUnitsString("Collateral units to seize (raw). Provide this OR repaidShares.").optional(),
        repaidShares: rawUnitsString("Borrow shares to repay (raw). Provide this OR seizedAssets.").optional(),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Moolah Liquidate", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ marketId, borrower, seizedAssets = "0", repaidShares = "0", network = services.getGlobalNetwork() }) => {
      try {
        const result = await services.moolahLiquidate({ marketId, borrower, seizedAssets, repaidShares, network });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "approve_liquidator_token",
    {
      description:
        "Approve loan token spending for the Moolah public liquidator contract. " +
        "Required before calling moolah_liquidate. Pass the EXACT amount you intend to use (recommended). " +
        "Pass amount='max' for unlimited approval ONLY when the user explicitly opts in — it lets the liquidator " +
        "contract spend the user's entire balance, present and future, until revoked (amount='0').",
      inputSchema: {
        tokenAddress: tronAddress("Loan token contract address (Base58)"),
        tokenSymbol: z.string().describe("Token symbol for display (e.g. 'USDT')"),
        tokenDecimals: z.number().int().min(0).max(38).describe("Token decimals (e.g. 6 for USDT). Integer in [0, 38]."),
        amount: amountOrMaxString("Exact amount to approve (e.g. '100'), or 'max' for unlimited (NOT recommended; user must opt in)."),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Approve Liquidator Token", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ tokenAddress, tokenSymbol, tokenDecimals, amount, network = services.getGlobalNetwork() }) => {
      try {
        const result = await services.approveLiquidatorToken({ tokenAddress, tokenSymbol, tokenDecimals, amount, network });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );
}
