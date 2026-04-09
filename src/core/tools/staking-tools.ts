import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as services from "../services/index.js";
import { sanitizeError } from "./shared.js";

export function registerStakingTools(server: McpServer) {

  // ============================================================================
  // sTRX STAKING (Read)
  // ============================================================================

  server.registerTool(
    "get_strx_dashboard",
    {
      description:
        "Get sTRX staking dashboard data including TRX price, sTRX/TRX exchange rate, " +
        "total APY, vote APY, total supply, unfreeze delay days, and energy stake per TRX.",
      inputSchema: {
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "sTRX Dashboard", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ network = services.getGlobalNetwork() }) => {
      try {
        const dashboard = await services.getStrxDashboard(network);
        return { content: [{ type: "text", text: JSON.stringify(dashboard, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_strx_account",
    {
      description:
        "Get user's sTRX staking account info including staked amount, income, " +
        "claimable rewards, withdrawn amount, and rental energy amount.",
      inputSchema: {
        address: z.string().optional().describe("Address to query. Default: configured wallet"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "sTRX Account Info", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ address, network = services.getGlobalNetwork() }) => {
      try {
        const addr = address || await services.getWalletAddress();
        const account = await services.getStrxStakeAccount(addr, network);
        return { content: [{ type: "text", text: JSON.stringify(account, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_strx_balance",
    {
      description: "Get the sTRX token balance for an address.",
      inputSchema: {
        address: z.string().optional().describe("Address to check. Default: configured wallet"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "sTRX Balance", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ address, network = services.getGlobalNetwork() }) => {
      try {
        const addr = address || await services.getWalletAddress();
        const balance = await services.getStrxBalance(addr, network);
        return {
          content: [{
            type: "text", text: JSON.stringify({
              ...balance,
              raw: balance.raw.toString(),
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "check_strx_withdrawal_eligibility",
    {
      description:
        "Check if user has TRX available to withdraw after sTRX unstaking unbonding period. " +
        "Shows staked amount, claimable rewards, pending/completed unstake rounds, and withdrawal status.",
      inputSchema: {
        address: z.string().optional().describe("Address to check. Default: configured wallet"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Check sTRX Withdrawal Eligibility", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ address, network = services.getGlobalNetwork() }) => {
      try {
        const addr = address || await services.getWalletAddress();
        const eligibility = await services.checkWithdrawalEligibility(addr, network);
        return { content: [{ type: "text", text: JSON.stringify(eligibility, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  // ============================================================================
  // sTRX STAKING (Write)
  // ============================================================================

  server.registerTool(
    "stake_trx_to_strx",
    {
      description:
        "Stake TRX via JustLend to receive sTRX tokens. " +
        "sTRX earns staking rewards (vote APY + energy rental income). " +
        "Pre-checks: sufficient TRX balance for staking amount + gas.",
      inputSchema: {
        amount: z.number().min(1).describe("Amount of TRX to stake"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Stake TRX to sTRX", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ amount, network = services.getGlobalNetwork() }) => {
      try {

        const result = await services.stakeTrxToStrx(amount, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "unstake_strx",
    {
      description:
        "Unstake sTRX to receive TRX back. " +
        "Note: unstaked TRX has an unbonding period (typically 14 days) before withdrawal. " +
        "Pre-checks: sufficient sTRX balance.",
      inputSchema: {
        amount: z.number().min(0.000001).describe("Amount of sTRX to unstake"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Unstake sTRX", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ amount, network = services.getGlobalNetwork() }) => {
      try {

        const result = await services.unstakeStrx(amount, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "claim_strx_rewards",
    {
      description:
        "Claim all available sTRX staking rewards. " +
        "Pre-checks: verifies there are claimable rewards before executing.",
      inputSchema: {
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Claim sTRX Rewards", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ network = services.getGlobalNetwork() }) => {
      try {

        const result = await services.claimStrxRewards(network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );
}
