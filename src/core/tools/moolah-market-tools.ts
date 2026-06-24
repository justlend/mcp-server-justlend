import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as services from "../services/index.js";
import { getMoolahAddresses } from "../chains.js";
import { TRC20_ABI } from "../abis.js";
import { toolError, tronAddress, amountString, amountOrMaxString } from "./shared.js";

/** Returns true when moolahProxy TRC20 allowance is sufficient for the given amount. */
async function hasProxyAllowance(
  tokenAddress: string,
  tokenDecimals: number,
  amount: string,
  walletAddress: string,
  network: string,
): Promise<boolean> {
  const { moolahProxy } = getMoolahAddresses(network);
  const raw = await services.readContract(
    { address: tokenAddress, functionName: "allowance", args: [walletAddress, moolahProxy], abi: TRC20_ABI },
    network,
  );
  const required = services.utils.parseUnits(amount, tokenDecimals);
  return BigInt(raw.toString()) >= required;
}

export function registerMoolahMarketTools(server: McpServer) {

  // ── Read ────────────────────────────────────────────────────────────────────

  server.registerTool(
    "get_moolah_markets",
    {
      description:
        "List JustLend V2 (Moolah) markets with borrow/supply APY, LLTV, utilization, and liquidity. " +
        "Markets are isolated — each has its own loan token, collateral token, oracle, and LLTV.",
      inputSchema: {
        depositToken: z.string().optional().describe("Filter by loan token symbol (e.g. 'USDT')"),
        collateralToken: z.string().optional().describe("Filter by collateral token symbol (e.g. 'TRX')"),
        pageSize: z.number().optional().describe("Max results. Default: 20"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Moolah Markets", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ depositToken, collateralToken, pageSize = 20, network = services.getGlobalNetwork() }) => {
      try {
        const res = await services.fetchMoolahMarketList({ deposit: depositToken, collateral: collateralToken, pageSize }, network);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_moolah_market",
    {
      description:
        "Get full details for a single Moolah market by its marketId (bytes32 hex). " +
        "Includes APY, LLTV, utilization, total supply/borrow, and vaults supplying to this market. " +
        "Use get_moolah_markets to find marketIds.",
      inputSchema: {
        marketId: z.string().describe("Market ID (bytes32 hex, e.g. '0xabc...')"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Moolah Market", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ marketId, network = services.getGlobalNetwork() }) => {
      try {
        const [info, vaults] = await Promise.all([
          services.fetchMoolahMarketInfo(marketId, network),
          services.fetchMoolahMarketVaultList(marketId, network),
        ]);
        return { content: [{ type: "text", text: JSON.stringify({ market: info, supplyingVaults: vaults }, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_moolah_user_position",
    {
      description:
        "Get a user's position in a specific Moolah market: collateral, borrow amount, lltv, and risk ratio. " +
        "risk close to 1.0 means the position is near liquidation — consider repaying or adding collateral.",
      inputSchema: {
        marketId: z.string().describe("Market ID (bytes32 hex)"),
        address: tronAddress("User address. Default: configured wallet").optional(),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Moolah User Position", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ marketId, address, network = services.getGlobalNetwork() }) => {
      try {
        const userAddr = address || await services.getWalletAddress();
        const position = await services.fetchMoolahUserMarketPosition(marketId, userAddr, network);
        return { content: [{ type: "text", text: JSON.stringify(position, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  // ── Write ───────────────────────────────────────────────────────────────────

  server.registerTool(
    "approve_moolah_proxy",
    {
      description:
        "Approve TRC20 token spending for the Moolah core contract before supplying collateral or repaying. " +
        "Not needed for TRX operations. Pass the EXACT amount you intend to use (recommended). " +
        "Pass amount='max' for unlimited approval ONLY when the user explicitly opts in — it lets the Moolah " +
        "proxy spend the user's entire balance, present and future, until revoked (amount='0').",
      inputSchema: {
        tokenAddress: tronAddress("TRC20 contract address (Base58)"),
        tokenSymbol: z.string().describe("Token symbol for display (e.g. 'USDT')"),
        tokenDecimals: z.number().int().min(0).max(38).describe("Token decimals (e.g. 6 for USDT). Integer in [0, 38]."),
        amount: amountOrMaxString("Exact amount to approve (e.g. '100'), or 'max' for unlimited (NOT recommended; user must opt in)."),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Approve Moolah Proxy", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ tokenAddress, tokenSymbol, tokenDecimals, amount, network = services.getGlobalNetwork() }) => {
      try {
        const result = await services.approveMoolahProxy({ tokenAddress, tokenSymbol, tokenDecimals, amount, network });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "moolah_supply_collateral",
    {
      description:
        "Supply collateral into a Moolah market to enable borrowing. " +
        "For TRC20 collateral, call approve_moolah_proxy first. " +
        "For TRX collateral, TRX is sent directly with no prior approval.",
      inputSchema: {
        marketId: z.string().describe("Market ID (bytes32 hex) — from get_moolah_markets"),
        amount: amountString("Amount of collateral to supply (e.g. '10000' for 10000 TRX)"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Moolah Supply Collateral", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ marketId, amount, network = services.getGlobalNetwork() }) => {
      try {
        const result = await services.moolahSupplyCollateral({ marketId, amount, network });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "moolah_withdraw_collateral",
    {
      description:
        "Withdraw collateral from a Moolah market. " +
        "Use amount='max' to withdraw all collateral (only allowed when no active borrows). " +
        "Withdrawing too much while borrowing will revert — check health factor first.",
      inputSchema: {
        marketId: z.string().describe("Market ID (bytes32 hex)"),
        amount: amountOrMaxString("Amount of collateral to withdraw, or 'max' for all (requires no active borrows)"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Moolah Withdraw Collateral", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ marketId, amount, network = services.getGlobalNetwork() }) => {
      try {
        const result = await services.moolahWithdrawCollateral({ marketId, amount, network });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "moolah_borrow",
    {
      description:
        "Flexible Moolah borrow entry point. " +
        "Provide collateralAmount only → supply collateral without borrowing. " +
        "Provide borrowAmount only → borrow against existing collateral. " +
        "Provide both → supply collateral then borrow in two sequential transactions. " +
        "Collateral must cover the borrow at the market's LLTV or the borrow tx reverts.",
      inputSchema: {
        marketId: z.string().describe("Market ID (bytes32 hex) — from get_moolah_markets"),
        collateralAmount: amountString("Collateral to supply first (e.g. '10000' TRX). Omit to skip.").optional(),
        borrowAmount: amountString("Loan token amount to borrow (e.g. '500' USDT). Omit to skip.").optional(),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Moolah Borrow", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ marketId, collateralAmount, borrowAmount, network = services.getGlobalNetwork() }) => {
      try {
        if (!collateralAmount && !borrowAmount) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "Provide collateralAmount, borrowAmount, or both." }, null, 2) }],
            isError: true,
          };
        }

        if (collateralAmount && borrowAmount) {
          const result = await services.moolahSupplyCollateralAndBorrow({ marketId, collateralAmount, borrowAmount, network });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
        if (collateralAmount) {
          const result = await services.moolahSupplyCollateral({ marketId, amount: collateralAmount, network });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
        // borrowAmount only
        const result = await services.moolahBorrow({ marketId, amount: borrowAmount!, network });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "moolah_repay",
    {
      description:
        "Repay a Moolah market loan. " +
        "Use amount='max' to repay the full outstanding borrow (uses shares math for exact settlement). " +
        "For TRC20 loan tokens, call approve_moolah_proxy first. " +
        "For TRX loans, TRX is sent directly.",
      inputSchema: {
        marketId: z.string().describe("Market ID (bytes32 hex)"),
        amount: amountOrMaxString("Loan amount to repay, or 'max' for full repayment"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Moolah Repay", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ marketId, amount, network = services.getGlobalNetwork() }) => {
      try {
        const result = await services.moolahRepay({ marketId, amount, network });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );
}
