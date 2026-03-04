import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getJustLendAddresses, getAllJTokens, getJTokenInfo,
  getSupportedNetworks, getNetworkConfig,
} from "./chains.js";
import * as services from "./services/index.js";

/**
 * Register all JustLend MCP tools.
 *
 * SECURITY: Private keys are read from environment variables, never passed as tool arguments.
 * Write operations require TRON_PRIVATE_KEY or TRON_MNEMONIC to be set.
 */
export function registerJustLendTools(server: McpServer) {

  // ============================================================================
  // WALLET & NETWORK (Read-only)
  // ============================================================================

  server.registerTool(
    "get_wallet_address",
    {
      description: "Get the configured wallet address. This wallet is used for all lending operations.",
      inputSchema: {},
      annotations: { title: "Get Wallet Address", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const address = services.getWalletAddress();
        return { content: [{ type: "text", text: JSON.stringify({ address, message: "This wallet will be used for all JustLend operations" }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_supported_networks",
    {
      description: "List all supported TRON networks for JustLend.",
      inputSchema: {},
      annotations: { title: "Get Supported Networks", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify({ networks: getSupportedNetworks(), default: "mainnet" }, null, 2) }],
    }),
  );

  server.registerTool(
    "get_supported_markets",
    {
      description: "List all available JustLend lending markets (jTokens) with their addresses and underlying assets.",
      inputSchema: {
        network: z.string().optional().describe("Network (mainnet, nile). Default: mainnet"),
      },
      annotations: { title: "Get Supported Markets", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ network = "mainnet" }) => {
      try {
        const tokens = getAllJTokens(network);
        const addresses = getJustLendAddresses(network);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              comptroller: addresses.comptroller,
              oracle: addresses.priceOracle,
              markets: tokens.map((t) => ({
                symbol: t.symbol,
                underlyingSymbol: t.underlyingSymbol,
                jTokenAddress: t.address,
                underlyingAddress: t.underlying || "native TRX",
                decimals: t.decimals,
                underlyingDecimals: t.underlyingDecimals,
              })),
              totalMarkets: tokens.length,
            }, null, 2),
          }],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  // ============================================================================
  // MARKET DATA (Read-only)
  // ============================================================================

  server.registerTool(
    "get_market_data",
    {
      description:
        "Get detailed market data for a specific JustLend market: supply/borrow APY, TVL, utilization, " +
        "collateral factor, price, and status. Use jToken symbol like 'jUSDT' or 'jTRX'.",
      inputSchema: {
        market: z.string().describe("jToken symbol (e.g. 'jUSDT', 'jTRX') or jToken address"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Market Data", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ market, network = "mainnet" }) => {
      try {
        const info = getJTokenInfo(market, network);
        if (!info) throw new Error(`Unknown market: ${market}. Use get_supported_markets to see available markets.`);
        const data = await services.getMarketData(info, network);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_all_markets",
    {
      description: "Get overview data for ALL JustLend markets at once: APYs, TVL, utilization rates, prices.",
      inputSchema: {
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get All Markets", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ network = "mainnet" }) => {
      try {
        const markets = await services.getAllMarketData(network);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              totalMarkets: markets.length,
              markets: markets.map((m) => ({
                symbol: m.symbol,
                underlyingSymbol: m.underlyingSymbol,
                supplyAPY: `${m.supplyAPY}%`,
                borrowAPY: `${m.borrowAPY}%`,
                totalSupply: m.totalSupply,
                totalBorrows: m.totalBorrows,
                availableLiquidity: m.availableLiquidity,
                utilizationRate: `${m.utilizationRate}%`,
                collateralFactor: `${m.collateralFactor}%`,
                priceUSD: m.underlyingPriceUSD,
                mintPaused: m.mintPaused,
                borrowPaused: m.borrowPaused,
              })),
            }, null, 2),
          }],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_protocol_summary",
    {
      description: "Get JustLend protocol-level info: Comptroller config, close factor, liquidation incentive, total markets.",
      inputSchema: {
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Protocol Summary", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ network = "mainnet" }) => {
      try {
        const summary = await services.getProtocolSummary(network);
        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  // ============================================================================
  // API-BASED QUERIES (More stable and comprehensive)
  // ============================================================================

  server.registerTool(
    "get_markets_from_api",
    {
      description: "Get all market data from JustLend API. More stable than contract queries. Returns comprehensive market data including APY, TVL, utilization, prices, mining rewards, etc.",
      inputSchema: {
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Markets from API", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ network = "mainnet" }) => {
      try {
        const data = await services.getMarketDataFromAPI(network);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_dashboard_from_api",
    {
      description: "Get JustLend protocol dashboard from API. Returns protocol-level statistics: total supply, total borrow, TVL, number of suppliers/borrowers, etc.",
      inputSchema: {
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Dashboard from API", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ network = "mainnet" }) => {
      try {
        const data = await services.getMarketDashboardFromAPI(network);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_jtoken_details_from_api",
    {
      description: "Get detailed jToken information from API. Returns comprehensive market details including interest rate model, reserve info, etc.",
      inputSchema: {
        jtokenAddr: z.string().describe("jToken contract address"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get jToken Details from API", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ jtokenAddr, network = "mainnet" }) => {
      try {
        const data = await services.getJTokenDetailsFromAPI(jtokenAddr, network);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  // ============================================================================
  // ACCOUNT / POSITION (Read-only)
  // ============================================================================

  server.registerTool(
    "get_account_summary",
    {
      description:
        "Get a comprehensive view of a user's JustLend positions: supply balances, borrow balances, " +
        "collateral status, health factor, liquidation risk, and USD values for each market.",
      inputSchema: {
        address: z.string().describe("TRON address (Base58 T... format) to check. Leave empty to use configured wallet.").optional(),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Account Summary", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, network = "mainnet" }) => {
      try {
        const userAddress = address || services.getWalletAddress();
        const summary = await services.getAccountSummary(userAddress, network);
        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "check_allowance",
    {
      description:
        "Check if the underlying TRC20 token has been approved for a jToken market. " +
        "Must be approved before supply() or repay() for TRC20 markets. Not needed for jTRX.",
      inputSchema: {
        market: z.string().describe("jToken symbol (e.g. 'jUSDT')"),
        address: z.string().optional().describe("Address to check. Default: configured wallet"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Check Allowance", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ market, address, network = "mainnet" }) => {
      try {
        const userAddress = address || services.getWalletAddress();
        const result = await services.checkAllowance(userAddress, market, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_trx_balance",
    {
      description: "Get TRX balance for an address.",
      inputSchema: {
        address: z.string().optional().describe("TRON address. Default: configured wallet"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get TRX Balance", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, network = "mainnet" }) => {
      try {
        const userAddress = address || services.getWalletAddress();
        const balance = await services.getTRXBalance(userAddress, network);
        return { content: [{ type: "text", text: JSON.stringify({ address: userAddress, balance: `${balance.formatted} TRX` }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_token_balance",
    {
      description: "Get TRC20 token balance for an address.",
      inputSchema: {
        tokenAddress: z.string().describe("TRC20 token contract address"),
        address: z.string().optional().describe("TRON address. Default: configured wallet"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Token Balance", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ tokenAddress, address, network = "mainnet" }) => {
      try {
        const userAddress = address || services.getWalletAddress();
        const result = await services.getTokenBalance(userAddress, tokenAddress, network);
        return { content: [{ type: "text", text: JSON.stringify({ address: userAddress, ...result }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_account_data_from_api",
    {
      description: "Get user account data from JustLend API. More stable and comprehensive than contract queries. Returns lending positions, balances, mining rewards, health factor, etc.",
      inputSchema: {
        address: z.string().describe("TRON address to check. Leave empty to use configured wallet.").optional(),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Account Data from API", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, network = "mainnet" }) => {
      try {
        const userAddress = address || services.getWalletAddress();
        const data = await services.getAccountDataFromAPI(userAddress, network);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  // ============================================================================
  // LENDING OPERATIONS (Write — require private key)
  // ============================================================================

  server.registerTool(
    "supply",
    {
      description:
        "Supply (deposit) assets into a JustLend market to earn interest. " +
        "For TRC20 markets, you must first call approve_underlying. For jTRX, TRX is sent directly. " +
        "Returns a jToken balance representing your deposit.",
      inputSchema: {
        market: z.string().describe("jToken symbol (e.g. 'jUSDT', 'jTRX')"),
        amount: z.string().describe("Amount of underlying to supply (e.g. '1000' for 1000 USDT)"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Supply Assets", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ market, amount, network = "mainnet" }) => {
      try {
        const privateKey = services.getConfiguredPrivateKey();
        const result = await services.supply(privateKey, market, amount, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "withdraw",
    {
      description:
        "Withdraw (redeem) supplied assets from a JustLend market. " +
        "Specify the amount in underlying units. May fail if assets are used as collateral for active borrows.",
      inputSchema: {
        market: z.string().describe("jToken symbol (e.g. 'jUSDT', 'jTRX')"),
        amount: z.string().describe("Amount of underlying to withdraw (e.g. '500')"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Withdraw Assets", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ market, amount, network = "mainnet" }) => {
      try {
        const privateKey = services.getConfiguredPrivateKey();
        const result = await services.withdraw(privateKey, market, amount, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "withdraw_all",
    {
      description: "Withdraw ALL supplied assets from a JustLend market by redeeming all jTokens.",
      inputSchema: {
        market: z.string().describe("jToken symbol (e.g. 'jUSDT')"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Withdraw All", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ market, network = "mainnet" }) => {
      try {
        const privateKey = services.getConfiguredPrivateKey();
        const result = await services.withdrawAll(privateKey, market, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "borrow",
    {
      description:
        "Borrow assets from a JustLend market against your collateral. " +
        "You must have entered a market as collateral (enter_market) and have sufficient liquidity. " +
        "Check your account_summary and health_factor before borrowing.",
      inputSchema: {
        market: z.string().describe("jToken symbol (e.g. 'jUSDT', 'jTRX')"),
        amount: z.string().describe("Amount of underlying to borrow (e.g. '500')"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Borrow Assets", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ market, amount, network = "mainnet" }) => {
      try {
        const privateKey = services.getConfiguredPrivateKey();
        const result = await services.borrow(privateKey, market, amount, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "repay",
    {
      description:
        "Repay borrowed assets to a JustLend market. " +
        "For TRC20 markets, must have approved underlying first. " +
        "Use amount='max' to repay the full outstanding borrow.",
      inputSchema: {
        market: z.string().describe("jToken symbol (e.g. 'jUSDT', 'jTRX')"),
        amount: z.string().describe("Amount to repay (e.g. '500'), or 'max' for full repayment"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Repay Borrow", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ market, amount, network = "mainnet" }) => {
      try {
        const privateKey = services.getConfiguredPrivateKey();
        const result = await services.repay(privateKey, market, amount, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "enter_market",
    {
      description:
        "Enable a jToken market as collateral. Required before borrowing against supplied assets. " +
        "Once entered, your supply in this market counts towards your borrowing capacity.",
      inputSchema: {
        market: z.string().describe("jToken symbol (e.g. 'jUSDT', 'jTRX')"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Enter Market (Enable Collateral)", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ market, network = "mainnet" }) => {
      try {
        const privateKey = services.getConfiguredPrivateKey();
        const result = await services.enterMarket(privateKey, market, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "exit_market",
    {
      description:
        "Disable a jToken market as collateral. Will fail if doing so would make your account undercollateralized. " +
        "Check account_summary first to ensure safety.",
      inputSchema: {
        market: z.string().describe("jToken symbol (e.g. 'jUSDT')"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Exit Market (Disable Collateral)", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ market, network = "mainnet" }) => {
      try {
        const privateKey = services.getConfiguredPrivateKey();
        const result = await services.exitMarket(privateKey, market, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "approve_underlying",
    {
      description:
        "Approve the jToken contract to spend your underlying TRC20 tokens. " +
        "Required before supply() or repay() for TRC20-backed markets (not needed for jTRX). " +
        "Use amount='max' for unlimited approval.",
      inputSchema: {
        market: z.string().describe("jToken symbol (e.g. 'jUSDT')"),
        amount: z.string().optional().describe("Amount to approve, or 'max' for unlimited. Default: max"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Approve Underlying Token", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ market, amount = "max", network = "mainnet" }) => {
      try {
        const privateKey = services.getConfiguredPrivateKey();
        const result = await services.approveUnderlying(privateKey, market, amount, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "claim_rewards",
    {
      description: "Claim accrued JustLend mining rewards for the configured wallet.",
      inputSchema: {
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Claim Rewards", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ network = "mainnet" }) => {
      try {
        const privateKey = services.getConfiguredPrivateKey();
        const result = await services.claimRewards(privateKey, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  // ============================================================================
  // MINING REWARDS
  // ============================================================================

  server.registerTool(
    "get_mining_rewards",
    {
      description: "Get mining rewards for supply markets (USDD, WBTC, etc.). Returns unclaimed rewards, mining APY, and reward breakdown from API.",
      inputSchema: {
        address: z.string().optional().describe("TRON address. Leave empty to use configured wallet."),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Mining Rewards", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, network = "mainnet" }) => {
      try {
        const userAddress = address || services.getWalletAddress();
        const rewards = await services.getMiningRewardsFromAPI(userAddress, network);
        return { content: [{ type: "text", text: JSON.stringify(rewards, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_usdd_mining_config",
    {
      description: "Get USDD mining configuration including mining periods, reward tokens (USDD/TRX dual mining), and schedule.",
      inputSchema: {},
      annotations: { title: "Get USDD Mining Config", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const config = services.getUSDDMiningConfig();
        return { content: [{ type: "text", text: JSON.stringify(config, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_wbtc_mining_config",
    {
      description: "Get WBTC mining configuration and supply mining activity details.",
      inputSchema: {},
      annotations: { title: "Get WBTC Mining Config", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const config = services.getWBTCMiningConfig();
        return { content: [{ type: "text", text: JSON.stringify(config, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );
}
