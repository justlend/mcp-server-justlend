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
      description:
        "Get overview data for ALL JustLend markets including supply APY, borrow APY, mining rewards APY, " +
        "underlying staking yield, total supply APY, and TVL. " +
        "Mining APY is calculated from on-chain supply mining programs (USDD/TRX dual mining, WBTC mining, etc.). " +
        "totalSupplyAPY = base supply APY + underlying staking APY + mining APY.",
      inputSchema: {
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get All Markets", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ network = "mainnet" }) => {
      try {
        const markets = await services.getAllMarketOverview(network);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              totalMarkets: markets.length,
              markets,
              note: "totalSupplyAPY = supplyAPY + underlyingIncrementAPY + miningAPY. miningAPY is calculated from daily mining rewards and TVL. underlyingIncrementAPY is the staking yield for wrapped/staked assets (e.g. sTRX ~5.88%, wstUSDT ~1.63%).",
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
      description:
        "Get TRC20 token balance for an address. You can pass either a token symbol (e.g. 'USDD', 'USDT', 'ETH') or a contract address. " +
        "When using a symbol, it resolves to the correct contract address from JustLend markets automatically. " +
        "IMPORTANT: Always prefer using token symbols over raw addresses to avoid using outdated/wrong contract addresses. " +
        "For example, use 'USDD' instead of a raw address — the old USDD (TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn) is deprecated. " +
        "The returned balance is already formatted in human-readable token units (decimals already applied). Do NOT divide the balance by decimals again.",
      inputSchema: {
        token: z.string().optional().describe("Token symbol (e.g. 'USDD', 'USDT', 'TRX', 'ETH', 'BTC', 'SUN', 'JST', 'WIN', 'BTT', 'NFT', 'TUSD', 'WBTC', 'USD1', 'wstUSDT', 'sTRX'). Preferred over tokenAddress."),
        tokenAddress: z.string().optional().describe("TRC20 token contract address. Use 'token' parameter with a symbol name instead when possible."),
        address: z.string().optional().describe("TRON address. Default: configured wallet"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Token Balance", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ token, tokenAddress, address, network = "mainnet" }) => {
      try {
        const tokenInput = token || tokenAddress;
        if (!tokenInput) {
          return { content: [{ type: "text", text: "Error: Either 'token' (symbol) or 'tokenAddress' (contract address) is required." }], isError: true };
        }
        const userAddress = address || services.getWalletAddress();

        // Resolve token symbol to contract address from JustLend markets
        let resolvedAddress = tokenInput;
        const allTokens = getAllJTokens(network);
        // Try to match by underlying symbol (case-insensitive)
        const matchedToken = allTokens.find(
          (t) => t.underlyingSymbol.toLowerCase() === tokenInput.toLowerCase() && t.underlying,
        );
        if (matchedToken) {
          resolvedAddress = matchedToken.underlying;
        }

        const result = await services.getTokenBalance(userAddress, resolvedAddress, network);
        return { content: [{ type: "text", text: JSON.stringify({
          address: userAddress,
          balance: result.balance,
          balanceNote: "This balance is already in human-readable token units (decimals already applied). Do not divide again.",
          symbol: result.symbol,
          decimals: result.decimals,
          tokenAddress: resolvedAddress,
        }, null, 2) }] };
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
  // Typical resource costs are included in descriptions and responses.
  // Use estimate_lending_energy tool for precise on-chain simulation before executing.
  // Each write operation checks energy/bandwidth sufficiency and warns if TRX will be burned.
  // ============================================================================

  /**
   * Helper: check resource sufficiency and return warning object for tool responses.
   */
  async function getResourceWarning(
    ownerAddress: string,
    operation: string,
    isTRX: boolean,
    network: string,
  ) {
    try {
      const typical = services.getTypicalResources(operation, isTRX);
      const warning = await services.checkResourceSufficiency(ownerAddress, typical.energy, typical.bandwidth, network);
      return warning.warning ? { resourceWarning: warning } : {};
    } catch {
      return {};
    }
  }

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
    async ({ market, amount, network = "mainnet" }) => {
      try {
        const privateKey = services.getConfiguredPrivateKey();
        const info = getJTokenInfo(market, network);
        const isTRX = info ? (info.underlyingSymbol === "TRX" || !info.underlying) : false;
        const walletAddr = services.getWalletAddress();
        const resourceWarning = await getResourceWarning(walletAddr, "supply", isTRX, network);
        const result = await services.supply(privateKey, market, amount, network);
        return { content: [{ type: "text", text: JSON.stringify({
          ...result,
          typicalResources: { energy: isTRX ? "~80,000" : "~100,000", bandwidth: isTRX ? "~280" : "~310", note: "TRC20 supply costs more than TRX. Excludes approve step." },
          ...resourceWarning,
        }, null, 2) }] };
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
        "Specify the amount in underlying units. May fail if assets are used as collateral for active borrows. " +
        "Typical cost: ~90,000 energy + ~300 bandwidth.",
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
        const walletAddr = services.getWalletAddress();
        const resourceWarning = await getResourceWarning(walletAddr, "withdraw", false, network);
        const result = await services.withdraw(privateKey, market, amount, network);
        return { content: [{ type: "text", text: JSON.stringify({
          ...result,
          typicalResources: { energy: "~90,000", bandwidth: "~300" },
          ...resourceWarning,
        }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
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
    async ({ market, network = "mainnet" }) => {
      try {
        const privateKey = services.getConfiguredPrivateKey();
        const walletAddr = services.getWalletAddress();
        const resourceWarning = await getResourceWarning(walletAddr, "withdraw_all", false, network);
        const result = await services.withdrawAll(privateKey, market, network);
        return { content: [{ type: "text", text: JSON.stringify({
          ...result,
          typicalResources: { energy: "~90,000", bandwidth: "~300" },
          ...resourceWarning,
        }, null, 2) }] };
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
        "Check your account_summary and health_factor before borrowing. " +
        "Typical cost: ~100,000 energy + ~310 bandwidth.",
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
        const walletAddr = services.getWalletAddress();
        const resourceWarning = await getResourceWarning(walletAddr, "borrow", false, network);
        const result = await services.borrow(privateKey, market, amount, network);
        return { content: [{ type: "text", text: JSON.stringify({
          ...result,
          typicalResources: { energy: "~100,000", bandwidth: "~310" },
          ...resourceWarning,
        }, null, 2) }] };
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
        "Use amount='max' to repay the full outstanding borrow. " +
        "Typical cost: ~80,000~90,000 energy + ~280~320 bandwidth (TRX costs less than TRC20).",
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
        const info = getJTokenInfo(market, network);
        const isTRX = info ? (info.underlyingSymbol === "TRX" || !info.underlying) : false;
        const walletAddr = services.getWalletAddress();
        const resourceWarning = await getResourceWarning(walletAddr, "repay", isTRX, network);
        const result = await services.repay(privateKey, market, amount, network);
        return { content: [{ type: "text", text: JSON.stringify({
          ...result,
          typicalResources: { energy: isTRX ? "~80,000" : "~90,000", bandwidth: isTRX ? "~280" : "~320", note: "TRC20 repay costs more than TRX. Excludes approve step." },
          ...resourceWarning,
        }, null, 2) }] };
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
        "Once entered, your supply in this market counts towards your borrowing capacity. " +
        "Typical cost: ~80,000 energy + ~300 bandwidth.",
      inputSchema: {
        market: z.string().describe("jToken symbol (e.g. 'jUSDT', 'jTRX')"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Enter Market (Enable Collateral)", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ market, network = "mainnet" }) => {
      try {
        const privateKey = services.getConfiguredPrivateKey();
        const walletAddr = services.getWalletAddress();
        const resourceWarning = await getResourceWarning(walletAddr, "enter_market", false, network);
        const result = await services.enterMarket(privateKey, market, network);
        return { content: [{ type: "text", text: JSON.stringify({
          ...result,
          typicalResources: { energy: "~80,000", bandwidth: "~300" },
          ...resourceWarning,
        }, null, 2) }] };
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
        "Check account_summary first to ensure safety. " +
        "Typical cost: ~50,000 energy + ~280 bandwidth.",
      inputSchema: {
        market: z.string().describe("jToken symbol (e.g. 'jUSDT')"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Exit Market (Disable Collateral)", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ market, network = "mainnet" }) => {
      try {
        const privateKey = services.getConfiguredPrivateKey();
        const walletAddr = services.getWalletAddress();
        const resourceWarning = await getResourceWarning(walletAddr, "exit_market", false, network);
        const result = await services.exitMarket(privateKey, market, network);
        return { content: [{ type: "text", text: JSON.stringify({
          ...result,
          typicalResources: { energy: "~50,000", bandwidth: "~280" },
          ...resourceWarning,
        }, null, 2) }] };
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
        "Use amount='max' for unlimited approval. " +
        "Typical cost: ~23,000 energy + ~265 bandwidth.",
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
        const walletAddr = services.getWalletAddress();
        const resourceWarning = await getResourceWarning(walletAddr, "approve", false, network);
        const result = await services.approveUnderlying(privateKey, market, amount, network);
        return { content: [{ type: "text", text: JSON.stringify({
          ...result,
          typicalResources: { energy: "~23,000", bandwidth: "~265" },
          ...resourceWarning,
        }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
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
    async ({ network = "mainnet" }) => {
      try {
        const privateKey = services.getConfiguredPrivateKey();
        const walletAddr = services.getWalletAddress();
        const resourceWarning = await getResourceWarning(walletAddr, "claim_rewards", false, network);
        const result = await services.claimRewards(privateKey, network);
        return { content: [{ type: "text", text: JSON.stringify({
          ...result,
          typicalResources: { energy: "~60,000", bandwidth: "~330" },
          ...resourceWarning,
        }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
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
        "Use this tool whenever the user asks about gas/energy/cost for any lending operation.",
      inputSchema: {
        operation: z.enum(["supply", "withdraw", "withdraw_all", "borrow", "repay", "approve", "enter_market", "exit_market", "claim_rewards"])
          .describe("The operation to estimate resources for"),
        market: z.string().describe("jToken symbol (e.g. 'jUSDT', 'jTRX', 'jUSDD'). Required for all operations except claim_rewards."),
        amount: z.string().optional().describe("Amount in underlying token units (e.g. '100'). Default: '1'. Not needed for enter_market, exit_market, approve, withdraw_all, claim_rewards."),
        address: z.string().optional().describe("TRON address for simulation. Default: configured wallet"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Estimate Operation Resources", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ operation, market, amount = "1", address, network = "mainnet" }) => {
      try {
        const userAddress = address || services.getWalletAddress();
        const result = await services.estimateLendingEnergy(operation, market, amount, userAddress, network);
        // Also check resource sufficiency
        const resourceCheck = await services.checkResourceSufficiency(userAddress, result.totalEnergy, result.totalBandwidth, network);
        return { content: [{ type: "text", text: JSON.stringify({
          ...result,
          ...(resourceCheck.warning ? { resourceWarning: resourceCheck } : {}),
        }, null, 2) }] };
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

  // ============================================================================
  // JST VOTING / GOVERNANCE
  // ============================================================================

  server.registerTool(
    "get_proposal_list",
    {
      description: "Get the list of JustLend DAO governance proposals. Returns all proposals with their status (Active, Passed, Defeated, etc.), vote counts, and details.",
      inputSchema: {
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Proposal List", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ network = "mainnet" }) => {
      try {
        const data = await services.getProposalList(network);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_user_vote_status",
    {
      description: "Get a user's voting status across all governance proposals. Shows which proposals the user has voted on, their vote amounts (for/against/abstain), and which proposals have withdrawable votes.",
      inputSchema: {
        address: z.string().optional().describe("TRON address. Default: configured wallet"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get User Vote Status", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, network = "mainnet" }) => {
      try {
        const userAddress = address || services.getWalletAddress();
        const data = await services.getUserVoteStatus(userAddress, network);
        return { content: [{ type: "text", text: JSON.stringify({ address: userAddress, ...data }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_vote_info",
    {
      description:
        "Get voting power info for a user: JST wallet balance, available (surplus) votes, total deposited votes, and votes currently cast in proposals. " +
        "This is the key tool to check before voting — it shows how many votes are available to use.",
      inputSchema: {
        address: z.string().optional().describe("TRON address. Default: configured wallet"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Vote Info", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, network = "mainnet" }) => {
      try {
        const userAddress = address || services.getWalletAddress();
        const data = await services.getVoteInfo(userAddress, network);
        return { content: [{ type: "text", text: JSON.stringify({
          address: userAddress,
          ...data,
          explanation: {
            jstBalance: "JST tokens in wallet (not yet deposited for voting)",
            surplusVotes: "Available votes that can be cast on proposals",
            totalVote: "Total votes deposited (WJST balance)",
            castVote: "Votes currently locked in active proposals",
          },
        }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_locked_votes",
    {
      description: "Get the number of votes a user has locked in a specific proposal.",
      inputSchema: {
        proposalId: z.number().describe("The proposal ID to check"),
        address: z.string().optional().describe("TRON address. Default: configured wallet"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Locked Votes", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ proposalId, address, network = "mainnet" }) => {
      try {
        const userAddress = address || services.getWalletAddress();
        const data = await services.getLockedVotes(userAddress, proposalId, network);
        return { content: [{ type: "text", text: JSON.stringify({ address: userAddress, ...data }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "check_jst_allowance_for_voting",
    {
      description: "Check if JST has been approved for the WJST voting contract. Must be approved before depositing JST to get votes.",
      inputSchema: {
        address: z.string().optional().describe("TRON address. Default: configured wallet"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Check JST Voting Allowance", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, network = "mainnet" }) => {
      try {
        const userAddress = address || services.getWalletAddress();
        const data = await services.checkJSTAllowanceForVoting(userAddress, network);
        return { content: [{ type: "text", text: JSON.stringify({ address: userAddress, ...data }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "approve_jst_for_voting",
    {
      description:
        "Approve JST token for the WJST voting contract. Required before depositing JST to get voting power. " +
        "Use amount='max' for unlimited approval.",
      inputSchema: {
        amount: z.string().optional().describe("Amount to approve, or 'max' for unlimited. Default: max"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Approve JST for Voting", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ amount = "max", network = "mainnet" }) => {
      try {
        const privateKey = services.getConfiguredPrivateKey();
        const result = await services.approveJSTForVoting(privateKey, amount, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "deposit_jst_for_votes",
    {
      description:
        "Deposit JST into the WJST contract to get voting power. " +
        "Requires prior approval of JST for the WJST contract (use approve_jst_for_voting first). " +
        "1 JST = 1 Vote. Deposited JST can be withdrawn back after voting.",
      inputSchema: {
        amount: z.string().describe("Amount of JST to deposit (e.g. '1000')"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Deposit JST for Votes", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ amount, network = "mainnet" }) => {
      try {
        const privateKey = services.getConfiguredPrivateKey();
        const result = await services.depositJSTForVotes(privateKey, amount, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "withdraw_votes_to_jst",
    {
      description:
        "Withdraw WJST back to JST. Can only withdraw votes that are not currently locked in active proposals. " +
        "Use get_vote_info to check your surplus (available) votes before withdrawing.",
      inputSchema: {
        amount: z.string().describe("Amount of votes/WJST to withdraw back to JST (e.g. '1000')"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Withdraw Votes to JST", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ amount, network = "mainnet" }) => {
      try {
        const privateKey = services.getConfiguredPrivateKey();
        const result = await services.withdrawVotesToJST(privateKey, amount, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "cast_vote",
    {
      description:
        "Cast a vote on a governance proposal. You must have available votes (deposit JST first if needed). " +
        "Support: true = vote FOR, false = vote AGAINST. " +
        "You can add more votes to a proposal you already voted on.",
      inputSchema: {
        proposalId: z.number().describe("The proposal ID to vote on"),
        support: z.boolean().describe("true = vote FOR the proposal, false = vote AGAINST"),
        votes: z.string().describe("Amount of votes to cast (e.g. '1000')"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Cast Vote", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ proposalId, support, votes, network = "mainnet" }) => {
      try {
        const privateKey = services.getConfiguredPrivateKey();
        const result = await services.castVote(privateKey, proposalId, support, votes, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "withdraw_votes_from_proposal",
    {
      description:
        "Withdraw (reclaim) votes from a completed or canceled proposal. " +
        "Only works for proposals that are no longer active. " +
        "After withdrawing, the votes become available again for other proposals or can be converted back to JST.",
      inputSchema: {
        proposalId: z.number().describe("The proposal ID to withdraw votes from"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Withdraw Votes from Proposal", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ proposalId, network = "mainnet" }) => {
      try {
        const privateKey = services.getConfiguredPrivateKey();
        const result = await services.withdrawVotesFromProposal(privateKey, proposalId, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );
}
