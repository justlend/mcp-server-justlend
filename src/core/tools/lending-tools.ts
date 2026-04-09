import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getJTokenInfo } from "../chains.js";
import * as services from "../services/index.js";
import { utils } from "../services/utils.js";
import { sanitizeError } from "./shared.js";

/**
 * Helper: check resource sufficiency and return warning object for tool responses.
 */
async function getResourceWarning(
  ownerAddress: string,
  operation: string,
  isTRX: boolean,
  network: string,
  jTokenSymbol?: string,
  amount?: string,
) {
  try {
    const estimated = await services.simulateOperationResources(
      operation, jTokenSymbol || "", amount || "0", ownerAddress, network,
    );
    const warning = await services.checkResourceSufficiency(ownerAddress, estimated.energy, estimated.bandwidth, network);
    return warning.warning ? { resourceWarning: { ...warning, estimationSource: estimated.source } } : {};
  } catch {
    return {};
  }
}

export function registerLendingTools(server: McpServer) {

  // ============================================================================
  // LENDING OPERATIONS (Write — require private key)
  // Typical resource costs are included in descriptions and responses.
  // Use estimate_lending_energy tool for precise on-chain simulation before executing.
  // Each write operation checks energy/bandwidth sufficiency and warns if TRX will be burned.
  // ============================================================================

  server.registerTool(
    "supply",
    {
      description:
        "Supply (deposit) assets into a JustLend market to earn interest. " +
        "For TRC20 markets, you must first call approve_underlying. For jTRX, TRX is sent directly. " +
        "Returns a jToken balance representing your deposit. " +
        "Typical cost: ~100,000 energy + ~310 bandwidth for TRC20, ~80,000 energy + ~280 bandwidth for TRX. " +
        "Use estimate_lending_energy tool for precise estimates before executing.",
      inputSchema: {
        market: z.string().describe("jToken symbol (e.g. 'jUSDT', 'jTRX')"),
        amount: z.string().describe("Amount of underlying to supply (e.g. '1000' for 1000 USDT)"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Supply Assets", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ market, amount, network = services.getGlobalNetwork() }) => {
      try {

        const info = getJTokenInfo(market, network);
        const isTRX = info ? (info.underlyingSymbol === "TRX" || !info.underlying) : false;
        const walletAddr = await services.getWalletAddress();

        // For TRC20 markets, check allowance first and inform user
        if (!isTRX) {
          const allowanceResult = await services.checkAllowance(walletAddr, market, network);
          const decimals = info?.underlyingDecimals ?? 6;
          const currentAllowanceRaw = BigInt(allowanceResult.allowanceRaw);
          const requiredAmountRaw = utils.parseUnits(amount, decimals);

          if (currentAllowanceRaw < requiredAmountRaw) {
            const underlyingSymbol = info?.underlyingSymbol ?? market;
            return {
              content: [{
                type: "text", text: JSON.stringify({
                  status: "approval_required",
                  market,
                  amount,
                  currentAllowance: allowanceResult.allowance,
                  hasApproval: allowanceResult.hasApproval,
                  message: `Current ${underlyingSymbol} allowance is ${allowanceResult.allowance}. You need to approve at least ${amount} ${underlyingSymbol} before supplying. Please call approve_underlying first.`,
                }, null, 2)
              }]
            };
          }
        }

        const resourceWarning = await getResourceWarning(walletAddr, "supply", isTRX, network, market, amount);
        const result = await services.supply(market, amount, network);
        return {
          content: [{
            type: "text", text: JSON.stringify({
              ...result,
              ...resourceWarning,
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "withdraw",
    {
      description:
        "Withdraw (redeem) supplied assets from a JustLend market. " +
        "Specify the amount in underlying units. May fail if assets are used as collateral for active borrows. " +
        "Typical cost: ~90,000 energy + ~300 bandwidth.",
      inputSchema: {
        market: z.string().describe("jToken symbol (e.g. 'jUSDT', 'jTRX')"),
        amount: z.string().describe("Amount of underlying to withdraw (e.g. '500')"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Withdraw Assets", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ market, amount, network = services.getGlobalNetwork() }) => {
      try {

        const walletAddr = await services.getWalletAddress();
        const resourceWarning = await getResourceWarning(walletAddr, "withdraw", false, network, market, amount);
        const result = await services.withdraw(market, amount, network);
        return {
          content: [{
            type: "text", text: JSON.stringify({
              ...result,
              ...resourceWarning,
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "withdraw_all",
    {
      description:
        "Withdraw ALL supplied assets from a JustLend market by redeeming all jTokens. " +
        "Typical cost: ~90,000 energy + ~300 bandwidth.",
      inputSchema: {
        market: z.string().describe("jToken symbol (e.g. 'jUSDT')"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Withdraw All", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ market, network = services.getGlobalNetwork() }) => {
      try {

        const walletAddr = await services.getWalletAddress();
        const resourceWarning = await getResourceWarning(walletAddr, "withdraw_all", false, network, market);
        const result = await services.withdrawAll(market, network);
        return {
          content: [{
            type: "text", text: JSON.stringify({
              ...result,
              ...resourceWarning,
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "borrow",
    {
      description:
        "Borrow assets from a JustLend market against your collateral. " +
        "You must have entered a market as collateral (enter_market) and have sufficient liquidity. " +
        "Check your account_summary and health_factor before borrowing. " +
        "Typical cost: ~100,000 energy + ~313 bandwidth.",
      inputSchema: {
        market: z.string().describe("jToken symbol (e.g. 'jUSDT', 'jTRX')"),
        amount: z.string().describe("Amount of underlying to borrow (e.g. '500')"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Borrow Assets", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ market, amount, network = services.getGlobalNetwork() }) => {
      try {

        const walletAddr = await services.getWalletAddress();
        const resourceWarning = await getResourceWarning(walletAddr, "borrow", false, network, market, amount);
        const result = await services.borrow(market, amount, network);
        return {
          content: [{
            type: "text", text: JSON.stringify({
              ...result,
              ...resourceWarning,
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "repay",
    {
      description:
        "Repay borrowed assets to a JustLend market. " +
        "For TRC20 markets, must have approved underlying first. " +
        "Use amount='max' to repay the full outstanding borrow. " +
        "Typical cost: ~80,000~90,000 energy + ~280~320 bandwidth (TRX costs less than TRC20).",
      inputSchema: {
        market: z.string().describe("jToken symbol (e.g. 'jUSDT', 'jTRX')"),
        amount: z.string().describe("Amount to repay (e.g. '500'), or 'max' for full repayment"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Repay Borrow", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ market, amount, network = services.getGlobalNetwork() }) => {
      try {

        const info = getJTokenInfo(market, network);
        const isTRX = info ? (info.underlyingSymbol === "TRX" || !info.underlying) : false;
        const walletAddr = await services.getWalletAddress();

        // For TRC20 markets, check allowance first and inform user (skip for 'max' repay)
        if (!isTRX && amount !== "max") {
          const allowanceResult = await services.checkAllowance(walletAddr, market, network);
          const decimals = info?.underlyingDecimals ?? 6;
          const currentAllowanceRaw = BigInt(allowanceResult.allowanceRaw);
          const requiredAmountRaw = utils.parseUnits(amount, decimals);

          if (currentAllowanceRaw < requiredAmountRaw) {
            const underlyingSymbol = info?.underlyingSymbol ?? market;
            return {
              content: [{
                type: "text", text: JSON.stringify({
                  status: "approval_required",
                  market,
                  amount,
                  currentAllowance: allowanceResult.allowance,
                  hasApproval: allowanceResult.hasApproval,
                  message: `Current ${underlyingSymbol} allowance is ${allowanceResult.allowance}. You need to approve at least ${amount} ${underlyingSymbol} before repaying. Please call approve_underlying first.`,
                }, null, 2)
              }]
            };
          }
        }

        const resourceWarning = await getResourceWarning(walletAddr, "repay", isTRX, network, market, amount);
        const result = await services.repay(market, amount, network);
        return {
          content: [{
            type: "text", text: JSON.stringify({
              ...result,
              ...resourceWarning,
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "enter_market",
    {
      description:
        "Enable a jToken market as collateral. Required before borrowing against supplied assets. " +
        "Once entered, your supply in this market counts towards your borrowing capacity. " +
        "Typical cost: ~80,000 energy + ~300 bandwidth.",
      inputSchema: {
        market: z.string().describe("jToken symbol (e.g. 'jUSDT', 'jTRX')"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Enter Market (Enable Collateral)", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ market, network = services.getGlobalNetwork() }) => {
      try {

        const walletAddr = await services.getWalletAddress();
        const resourceWarning = await getResourceWarning(walletAddr, "enter_market", false, network, market);
        const result = await services.enterMarket(market, network);
        return {
          content: [{
            type: "text", text: JSON.stringify({
              ...result,
              ...resourceWarning,
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "exit_market",
    {
      description:
        "Disable a jToken market as collateral. " +
        "Pre-checks: 1) market must have no outstanding borrows; 2) remaining collateral must still cover all borrows. " +
        "Typical cost: ~50,000 energy + ~280 bandwidth.",
      inputSchema: {
        market: z.string().describe("jToken symbol (e.g. 'jUSDT')"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Exit Market (Disable Collateral)", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ market, network = services.getGlobalNetwork() }) => {
      try {

        const walletAddr = await services.getWalletAddress();
        const resourceWarning = await getResourceWarning(walletAddr, "exit_market", false, network, market);
        const result = await services.exitMarket(market, network);

        // Check if transaction events contain a Failure
        const failureEvent = result.events?.find((e: any) => e.name === "Failure");
        if (failureEvent) {
          return {
            content: [{
              type: "text", text: JSON.stringify({
                ...result,
                ...resourceWarning,
                error: `Transaction succeeded on-chain but contract returned Failure: error=${failureEvent.params.error}, info=${failureEvent.params.info}, detail=${failureEvent.params.detail}`,
              }, null, 2)
            }], isError: true
          };
        }

        return {
          content: [{
            type: "text", text: JSON.stringify({
              ...result,
              ...resourceWarning,
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "approve_underlying",
    {
      description:
        "Approve the jToken contract to spend your underlying TRC20 tokens. " +
        "Required before supply() or repay() for TRC20-backed markets (not needed for jTRX). " +
        "Use amount='max' for unlimited approval. " +
        "Typical cost: ~23,000 energy + ~265 bandwidth.",
      inputSchema: {
        market: z.string().describe("jToken symbol (e.g. 'jUSDT')"),
        amount: z.string().optional().describe("Amount to approve, or 'max' for unlimited. Default: max"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Approve Underlying Token", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ market, amount = "max", network = services.getGlobalNetwork() }) => {
      try {

        const walletAddr = await services.getWalletAddress();
        const resourceWarning = await getResourceWarning(walletAddr, "approve", false, network, market, amount);
        const result = await services.approveUnderlying(market, amount, network);
        return {
          content: [{
            type: "text", text: JSON.stringify({
              ...result,
              ...resourceWarning,
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "claim_rewards",
    {
      description:
        "Claim accrued JustLend mining rewards for the configured wallet. " +
        "Typical cost: ~60,000 energy + ~330 bandwidth.",
      inputSchema: {
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Claim Rewards", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ network = services.getGlobalNetwork() }) => {
      try {

        const walletAddr = await services.getWalletAddress();
        const resourceWarning = await getResourceWarning(walletAddr, "claim_rewards", false, network);
        const result = await services.claimRewards(network);
        return {
          content: [{
            type: "text", text: JSON.stringify({
              ...result,
              ...resourceWarning,
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  // ============================================================================
  // ENERGY ESTIMATION
  // ============================================================================

  server.registerTool(
    "estimate_lending_energy",
    {
      description:
        "Estimate energy, bandwidth, and TRX cost for any JustLend operation BEFORE executing it. " +
        "Covers ALL operations: supply, withdraw, withdraw_all, borrow, repay, approve, enter_market, exit_market, claim_rewards. " +
        "Tries on-chain simulation first; falls back to historical typical values if simulation fails. " +
        "Returns per-step breakdown (e.g. approve + mint for supply), total energy, total bandwidth, and estimated TRX cost. " +
        "For supply/repay: automatically checks current allowance — if sufficient, the approve step is skipped. " +
        "For approve: supports custom spender address (not just jToken). " +
        "Use this tool whenever the user asks about gas/energy/cost for any lending operation.",
      inputSchema: {
        operation: z.enum(["supply", "withdraw", "withdraw_all", "borrow", "repay", "approve", "enter_market", "exit_market", "claim_rewards"])
          .describe("The operation to estimate resources for"),
        market: z.string().describe("jToken symbol (e.g. 'jUSDT', 'jTRX', 'jUSDD'). Required for all operations except claim_rewards."),
        amount: z.string().optional().describe("Amount in underlying token units (e.g. '100'). Default: '1'. Not needed for enter_market, exit_market, approve, withdraw_all, claim_rewards."),
        spender: z.string().optional().describe("Custom spender address for approve operation. Default: jToken contract address. Only used when operation is 'approve'."),
        address: z.string().optional().describe("TRON address for simulation. Default: configured wallet"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Estimate Operation Resources", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ operation, market, amount = "1", spender, address, network = services.getGlobalNetwork() }) => {
      try {
        const userAddress = address || await services.getWalletAddress();
        const result = await services.estimateLendingEnergy(operation, market, amount, userAddress, network, spender);
        // Also check resource sufficiency
        const resourceCheck = await services.checkResourceSufficiency(userAddress, result.totalEnergy, result.totalBandwidth, network);
        return {
          content: [{
            type: "text", text: JSON.stringify({
              ...result,
              ...(resourceCheck.warning ? { resourceWarning: resourceCheck } : {}),
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );
}
