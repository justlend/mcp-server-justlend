import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as services from "../services/index.js";
import { toolError, tronAddress } from "./shared.js";

export function registerMoolahDashboardTools(server: McpServer) {

  server.registerTool(
    "get_moolah_dashboard",
    {
      description:
        "JustLend V2 (Moolah) protocol overview: top vaults (APY, TVL) and top markets (borrow/supply rates). " +
        "If address is provided, also includes the user's aggregated V2 position (total supply, borrow, health factor).",
      inputSchema: {
        address: tronAddress("User address to include V2 position summary. Default: configured wallet").optional(),
        depositToken: z.string().optional().describe("Filter vaults and markets by deposit token symbol"),
        collateralToken: z.string().optional().describe("Filter markets by collateral token symbol"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Moolah Dashboard", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, depositToken, collateralToken, network = services.getGlobalNetwork() }) => {
      try {
        const userAddr = address || await services.getWalletAddress().catch(() => "");

        const dashboardPromise = services.getMoolahDashboard({ depositToken, collateralToken, network });
        const positionPromise = userAddr
          ? services.fetchMoolahUserPosition(userAddr, network).catch(() => null)
          : Promise.resolve(null);

        const [dashboard, userPosition] = await Promise.all([dashboardPromise, positionPromise]);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ ...dashboard, userPosition }, null, 2),
          }],
        };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_moolah_history",
    {
      description:
        "Get a user's JustLend V2 position history (net worth, supply, borrow over time) " +
        "and recent transaction records (supply, borrow, repay, etc.).",
      inputSchema: {
        address: tronAddress("User address. Default: configured wallet").optional(),
        timeFilter: z.enum(["ONE_DAY", "ONE_WEEK", "ONE_MONTH"]).optional().describe("History time range. Default: ONE_WEEK"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Moolah History", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, timeFilter = "ONE_WEEK", network = services.getGlobalNetwork() }) => {
      try {
        const userAddr = address || await services.getWalletAddress();
        const [summary, records] = await Promise.all([
          services.getMoolahUserSummary({ userAddress: userAddr, timeFilter, network }),
          services.fetchMoolahUserRecords(userAddr, { pageSize: 20 }, network),
        ]);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ position: summary.position, history: summary.history, recentTransactions: records.list }, null, 2),
          }],
        };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_moolah_records",
    {
      description:
        "Get a user's paginated V2 (Moolah) transaction history — supply, withdraw, borrow, repay, liquidate events. " +
        "Distinct from get_moolah_history (which returns position curves + a small recent-txs preview) — this one is the " +
        "full paginated record list. Works on both mainnet and nile.",
      inputSchema: {
        address: tronAddress("User address. Default: configured wallet").optional(),
        pageNo: z.number().optional().describe("Page number, 1-indexed. Default: 1"),
        pageSize: z.number().optional().describe("Records per page. Default: 20"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Moolah Records", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, pageNo = 1, pageSize = 20, network = services.getGlobalNetwork() }) => {
      try {
        const userAddr = address || await services.getWalletAddress();
        const res = await services.fetchMoolahUserRecords(userAddr, { pageNo, pageSize }, network);
        return { content: [{ type: "text", text: JSON.stringify({ address: userAddr, ...res }, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_moolah_vault_history",
    {
      description:
        "Time series of a V2 Moolah vault's APY, TVL, and supply mining data. " +
        "Returns currentSupplyUsd, supplyBaseApy, supplyMiningApy, and a historyRecords array. " +
        "Use vaultAddress from get_moolah_vaults or chains.ts vault map.",
      inputSchema: {
        vaultAddress: tronAddress("Vault contract address (Base58 T...)"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Moolah Vault History", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ vaultAddress, network = services.getGlobalNetwork() }) => {
      try {
        const res = await services.fetchMoolahVaultApyHistory(vaultAddress, network);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "estimate_moolah_energy",
    {
      description:
        "Estimate energy, bandwidth, and TRX cost for a JustLend V2 (Moolah) write operation BEFORE executing it. " +
        "Returns historical typical values (on-chain simulation for Moolah's tuple-args ops is not yet wired). " +
        "Set isTRX=true when the underlying / loan / collateral token is native TRX (TrxProviderProxy route). " +
        "Covers: vault_deposit, vault_withdraw, vault_redeem, approve_vault, supply_collateral, withdraw_collateral, " +
        "borrow, repay, approve_proxy, liquidate, approve_liquidator.",
      inputSchema: {
        operation: z.enum([
          "vault_deposit", "vault_withdraw", "vault_redeem", "approve_vault",
          "supply_collateral", "withdraw_collateral", "borrow", "repay", "approve_proxy",
          "liquidate", "approve_liquidator",
        ]).describe("Moolah operation to estimate"),
        isTRX: z.boolean().optional().describe("Whether the route uses native TRX (via TrxProviderProxy). Default: false"),
        address: tronAddress("Owner address for resource-sufficiency check. Default: configured wallet").optional(),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Estimate Moolah Energy", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ operation, isTRX = false, address, network = services.getGlobalNetwork() }) => {
      try {
        const owner = address || await services.getWalletAddress().catch(() => undefined);
        const res = await services.estimateMoolahEnergy({ operation, isTRX, ownerAddress: owner, network });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_moolah_market_history",
    {
      description:
        "Time series of a V2 Moolah market's borrow/supply APY, utilization, and totals. " +
        "Returns current totalBorrow/totalCollateral + borrowApy/supplyApy + list[] of historical points. " +
        "Use marketId (bytes32 hex) from get_moolah_markets.",
      inputSchema: {
        marketId: z.string().describe("Market ID (bytes32 hex, e.g. '0xabc...')"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Moolah Market History", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ marketId, network = services.getGlobalNetwork() }) => {
      try {
        const res = await services.fetchMoolahMarketApyHistory(marketId, network);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );
}
