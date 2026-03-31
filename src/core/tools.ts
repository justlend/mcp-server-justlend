import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getJustLendAddresses, getAllJTokens, getJTokenInfo,
  getSupportedNetworks, getNetworkConfig,
} from "./chains.js";
import * as services from "./services/index.js";
import { utils } from "./services/utils.js";

/**
 * Sanitize error messages for MCP client responses.
 * Strips internal details (contract addresses, node URLs, stack traces)
 * while preserving user-actionable information.
 */
function sanitizeError(error: any): string {
  const msg = error?.message || String(error);
  // Remove full URLs that might expose internal infrastructure
  return msg.replace(/https?:\/\/[^\s,)]+/g, "[redacted-url]");
}

/**
 * Register all JustLend MCP tools.
 *
 * SECURITY: Private keys are managed by @bankofai/agent-wallet, never stored in environment
 * variables or passed as tool arguments. Run `agent-wallet start` to set up the encrypted wallet.
 */
export function registerJustLendTools(server: McpServer) {

  // ============================================================================
  // WALLET & NETWORK (Read-only)
  // ============================================================================

  server.registerTool(
    "get_wallet_address",
    {
      description: "Get the configured wallet address. Auto-generates a new encrypted wallet if none exists.",
      inputSchema: {},
      annotations: { title: "Get Wallet Address", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const { address, walletId, created } = await services.autoInitWallet();
        if (created) {
          return { content: [{ type: "text", text: JSON.stringify({
            address,
            walletId,
            newlyCreated: true,
            message: "New wallet auto-generated. Encrypted private key stored in ~/.agent-wallet/. Fund this address with TRX before performing write operations.",
          }, null, 2) }] };
        }
        const status = await services.checkWalletStatus();
        return { content: [{ type: "text", text: JSON.stringify({
          address,
          walletId,
          totalWallets: status.wallets.length,
          message: "This wallet will be used for all JustLend operations",
        }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "list_wallets",
    {
      description: "List all wallets configured in agent-wallet. Shows wallet IDs, types, active status, and addresses.",
      inputSchema: {},
      annotations: { title: "List Wallets", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const status = await services.checkWalletStatus();
        return { content: [{ type: "text", text: JSON.stringify({
          initialized: status.initialized,
          activeWalletId: status.activeWalletId,
          wallets: status.wallets,
          message: status.message,
        }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "set_active_wallet",
    {
      description: "Set the active wallet by wallet ID. Use list_wallets to see available wallet IDs.",
      inputSchema: {
        walletId: z.string().describe("The wallet ID to set as active"),
      },
      annotations: { title: "Set Active Wallet", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ walletId }: { walletId: string }) => {
      const result = services.setActiveWallet(walletId);
      if (!result.success) {
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: true };
      }
      // Return new status after switching
      const status = await services.checkWalletStatus();
      return { content: [{ type: "text", text: JSON.stringify({
        ...result,
        activeAddress: status.activeAddress,
        wallets: status.wallets,
      }, null, 2) }] };
    },
  );

  server.registerTool(
    "import_wallet",
    {
      description:
        "Import an existing wallet from a private key. The key is stored encrypted in ~/.agent-wallet/. " +
        "Use this to import an existing funded wallet instead of the auto-generated one. " +
        "WARNING: The private key will be transmitted through the MCP protocol and may appear in AI conversation logs. " +
        "For maximum security, use the agent-wallet CLI directly: `npx agent-wallet import`.",
      inputSchema: {
        privateKey: z.string().describe("Private key hex string (64 characters, with or without 0x prefix)"),
        walletId: z.string().optional().describe("Wallet identifier. Default: 'imported'"),
      },
      annotations: { title: "Import Wallet", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ privateKey, walletId }: { privateKey: string; walletId?: string }) => {
      try {
        const result = await services.importWallet(privateKey, walletId);
        return { content: [{ type: "text", text: JSON.stringify({
          address: result.address,
          walletId: result.walletId,
          message: "Wallet imported and encrypted. Set as active if it was the first wallet.",
          securityNote: "For future imports, prefer using the CLI: `npx agent-wallet import` to avoid exposing keys in conversation logs.",
        }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
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
    async ({ network = services.getGlobalNetwork() }) => {
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
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
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
    async ({ market, network = services.getGlobalNetwork() }) => {
      try {
        const info = getJTokenInfo(market, network);
        if (!info) throw new Error(`Unknown market: ${market}. Use get_supported_markets to see available markets.`);
        const data = await services.getMarketData(info, network);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
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
    async ({ network = services.getGlobalNetwork() }) => {
      try {
        const result = await services.getAllMarketsWithFallback(network);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              totalMarkets: result.markets.length,
              markets: result.markets,
              note: result.note,
              ...(result.source === "contract" ? { source: "contract" } : {}),
            }, null, 2),
          }],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
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
    async ({ network = services.getGlobalNetwork() }) => {
      try {
        const summary = await services.getProtocolSummary(network);
        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
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
    async ({ network = services.getGlobalNetwork() }) => {
      try {
        const data = await services.getMarketDataFromAPI(network);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
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
    async ({ network = services.getGlobalNetwork() }) => {
      try {
        const data = await services.getMarketDashboardFromAPI(network);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
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
    async ({ jtokenAddr, network = services.getGlobalNetwork() }) => {
      try {
        const data = await services.getJTokenDetailsFromAPI(jtokenAddr, network);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
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
        "Get a comprehensive view of a user's JustLend positions (supply, borrow, health factor). " +
        "IMPORTANT: Returns a snapshot tied to a specific block. " +
        "You MUST call this again after any transaction (supply, withdraw, etc.) to get updated balances and health factor.",
      inputSchema: {
        address: z.string().describe("TRON address (Base58 T... format) to check. Leave empty to use configured wallet.").optional(),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Account Summary", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, network = services.getGlobalNetwork() }) => {
      try {
        const userAddress = address || await services.getWalletAddress();
        const summary = await services.getAccountSummary(userAddress, network);
        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "check_allowance",
    {
      description:
        "Check if the underlying TRC20 token has been approved for a jToken market. " +
        "Must be approved before supply() or repay() for TRC20 markets. Not needed for jTRX. " +
        "The returned 'allowance' is in human-readable token units (e.g. '1' means 1 USDT, not 1 raw unit). " +
        "Compare it directly with the amount the user wants to supply/repay. 'allowanceUnit' indicates the token symbol.",
      inputSchema: {
        market: z.string().describe("jToken symbol (e.g. 'jUSDT')"),
        amount: z.string().optional().describe("Amount to check sufficiency against (human-readable, e.g. '0.5'). If provided, returns whether allowance is sufficient."),
        address: z.string().optional().describe("Address to check. Default: configured wallet"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Check Allowance", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ market, amount, address, network = services.getGlobalNetwork() }) => {
      try {
        const userAddress = address || await services.getWalletAddress();
        const result = await services.checkAllowance(userAddress, market, network);

        let sufficiency = {};
        if (amount) {
          const info = getJTokenInfo(market, network);
          const decimals = info?.underlyingDecimals ?? 6;
          const allowanceRaw = BigInt(result.allowanceRaw);
          const requiredRaw = utils.parseUnits(amount, decimals);

          const isSufficient = allowanceRaw >= requiredRaw;
          sufficiency = {
            requiredAmount: amount,
            isSufficient,
            message: isSufficient
              ? `Allowance of ${result.allowance} ${result.allowanceUnit} is sufficient for ${amount} ${result.allowanceUnit}. No approve needed.`
              : `Allowance of ${result.allowance} ${result.allowanceUnit} is NOT sufficient for ${amount} ${result.allowanceUnit}. Please call approve_underlying first.`,
          };
        }

        return { content: [{ type: "text", text: JSON.stringify({ ...result, ...sufficiency }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
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
    async ({ address, network = services.getGlobalNetwork() }) => {
      try {
        const userAddress = address || await services.getWalletAddress();
        const balance = await services.getTRXBalance(userAddress, network);
        return { content: [{ type: "text", text: JSON.stringify({ address: userAddress, balance: `${balance.formatted} TRX` }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
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
    async ({ token, tokenAddress, address, network = services.getGlobalNetwork() }) => {
      try {
        const tokenInput = token || tokenAddress;
        if (!tokenInput) {
          return { content: [{ type: "text", text: "Error: Either 'token' (symbol) or 'tokenAddress' (contract address) is required." }], isError: true };
        }
        const userAddress = address || await services.getWalletAddress();

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
        return {
          content: [{
            type: "text", text: JSON.stringify({
              address: userAddress,
              balance: result.balance,
              balanceNote: "This balance is already in human-readable token units (decimals already applied). Do not divide again.",
              symbol: result.symbol,
              decimals: result.decimals,
              tokenAddress: resolvedAddress,
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_account_data_from_api",
    {
      description: "Get user account data from JustLend API. Returns lending positions, balances, mining rewards, health factor, etc. " +
        "Note: API data may have a slight delay compared to contract queries. Refresh after transactions for accuracy.",
      inputSchema: {
        address: z.string().describe("TRON address to check. Leave empty to use configured wallet.").optional(),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Account Data from API", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, network = services.getGlobalNetwork() }) => {
      try {
        const userAddress = address || await services.getWalletAddress();
        const data = await services.getAccountDataFromAPI(userAddress, network);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
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
    async ({ address, network = services.getGlobalNetwork() }) => {
      try {
        const userAddress = address || await services.getWalletAddress();
        const rewards = await services.getMiningRewardsFromAPI(userAddress, network);
        return { content: [{ type: "text", text: JSON.stringify(rewards, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_usdd_mining_config",
    {
      description: "Get USDD mining configuration including mining periods, reward tokens (USDD/TRX dual mining), and schedule.",
      inputSchema: {
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get USDD Mining Config", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ network = services.getGlobalNetwork() }) => {
      try {
        const config = await services.getUSDDMiningConfig(network);
        return { content: [{ type: "text", text: JSON.stringify(config, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
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
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  // ============================================================================
  // JST VOTING / GOVERNANCE
  // ============================================================================

  server.registerTool(
    "get_proposal_list",
    {
      description: "Get the list of JustLend DAO governance proposals. Returns proposals with their status (Active, Passed, Defeated, etc.), vote counts, and details. Sorted by newest first.",
      inputSchema: {
        network: z.string().optional().describe("Network. Default: mainnet"),
        limit: z.number().optional().describe("Max number of proposals to return. Default: 10. Use 0 for all."),
      },
      annotations: { title: "Get Proposal List", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ network = services.getGlobalNetwork(), limit = 10 }) => {
      try {
        const data = await services.getProposalList(network);
        const proposals = limit > 0 ? data.proposals.slice(0, limit) : data.proposals;
        return { content: [{ type: "text", text: JSON.stringify({ proposals, total: data.total, returned: proposals.length }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
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
    async ({ address, network = services.getGlobalNetwork() }) => {
      try {
        const userAddress = address || await services.getWalletAddress();
        const data = await services.getUserVoteStatus(userAddress, network);
        return { content: [{ type: "text", text: JSON.stringify({ address: userAddress, ...data }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
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
    async ({ address, network = services.getGlobalNetwork() }) => {
      try {
        const userAddress = address || await services.getWalletAddress();
        const data = await services.getVoteInfo(userAddress, network);
        return {
          content: [{
            type: "text", text: JSON.stringify({
              address: userAddress,
              ...data,
              explanation: {
                jstBalance: "JST tokens in wallet (not yet deposited for voting)",
                surplusVotes: "Available votes that can be cast on proposals",
                totalVote: "Total votes deposited (WJST balance)",
                castVote: "Votes currently locked in active proposals",
              },
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
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
    async ({ proposalId, address, network = services.getGlobalNetwork() }) => {
      try {
        const userAddress = address || await services.getWalletAddress();
        const data = await services.getLockedVotes(userAddress, proposalId, network);
        return { content: [{ type: "text", text: JSON.stringify({ address: userAddress, ...data }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
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
    async ({ address, network = services.getGlobalNetwork() }) => {
      try {
        const userAddress = address || await services.getWalletAddress();
        const data = await services.checkJSTAllowanceForVoting(userAddress, network);
        return { content: [{ type: "text", text: JSON.stringify({ address: userAddress, ...data }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
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
    async ({ amount = "max", network = services.getGlobalNetwork() }) => {
      try {

        const result = await services.approveJSTForVoting(amount, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
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
    async ({ amount, network = services.getGlobalNetwork() }) => {
      try {

        const result = await services.depositJSTForVotes(amount, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
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
    async ({ amount, network = services.getGlobalNetwork() }) => {
      try {

        const result = await services.withdrawVotesToJST(amount, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
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
    async ({ proposalId, support, votes, network = services.getGlobalNetwork() }) => {
      try {

        const result = await services.castVote(proposalId, support, votes, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
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
    async ({ proposalId, network = services.getGlobalNetwork() }) => {
      try {

        const result = await services.withdrawVotesFromProposal(proposalId, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  // ============================================================================
  // ENERGY RENTAL (Read)
  // ============================================================================

  server.registerTool(
    "get_energy_rental_dashboard",
    {
      description:
        "Get JustLend energy rental market dashboard data including TRX price, exchange rate, " +
        "total APY, energy per TRX, total supply, and other market parameters.",
      inputSchema: {
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Energy Rental Dashboard", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ network = services.getGlobalNetwork() }) => {
      try {
        const dashboard = await services.getEnergyRentalDashboard(network);
        return { content: [{ type: "text", text: JSON.stringify(dashboard, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_energy_rental_params",
    {
      description:
        "Get on-chain energy rental parameters: liquidation threshold, fee ratio, min fee, " +
        "total delegated/frozen TRX, max rentable amount, rent paused status, usage charge ratio.",
      inputSchema: {
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Energy Rental Parameters", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ network = services.getGlobalNetwork() }) => {
      try {
        const params = await services.getEnergyRentalParams(network);
        return { content: [{ type: "text", text: JSON.stringify(params, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "calculate_energy_rental_price",
    {
      description:
        "Calculate the cost to rent a specific amount of energy for a given duration. " +
        "Returns TRX amount needed, rental rate, fee, total prepayment, security deposit, and daily cost. " +
        "For NEW rentals: provide energyAmount and durationHours. " +
        "For RENEWALS: provide energyAmount and receiverAddress. The tool auto-detects existing rentals " +
        "and calculates the incremental cost (subtracting existing security deposit). " +
        "durationHours is optional for renewals (defaults to 0 = no additional time).",
      inputSchema: {
        energyAmount: z.coerce.number().min(50000).describe("Amount of energy to rent (minimum 300,000 for new rental, minimum 50,000 for renewal)"),
        durationHours: z.coerce.number().min(0).optional().describe("Rental duration in hours. Required for new rentals (minimum 1). Optional for renewals (default 0 = no additional time)."),
        receiverAddress: z.string().optional().describe("Receiver address. If provided, checks for existing rental to calculate renewal cost."),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Calculate Energy Rental Price", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ energyAmount, durationHours, receiverAddress, network = services.getGlobalNetwork() }) => {
      try {
        // Check if this is a renewal by looking for existing rental
        if (receiverAddress) {
          const walletAddress = await services.getWalletAddress();
          const existingRental = await services.getRentInfo(walletAddress, receiverAddress, network);

          if (existingRental.hasActiveRental) {
            // Get remaining seconds from order
            const orders = await services.getUserRentalOrders(walletAddress, "renter", 0, 50, network);
            const matchingOrder = orders.orders.find(
              (o: any) => o.receiver === receiverAddress && o.renter === walletAddress,
            );
            const remainingSeconds = matchingOrder ? Number(matchingOrder.canRentSeconds || 0) : 0;
            const additionalSeconds = (durationHours || 0) * 3600;

            const estimate = await services.calculateRenewalPrice(
              energyAmount,
              existingRental.rentBalance,
              existingRental.securityDeposit,
              remainingSeconds,
              additionalSeconds,
              network,
            );
            return {
              content: [{
                type: "text", text: JSON.stringify({
                  ...estimate,
                  isRenewal: true,
                  durationHours: estimate.durationSeconds / 3600,
                  summary: `Renewal: adding ${energyAmount} energy costs ~${estimate.renewalPrepayment.toFixed(2)} TRX ` +
                    `(existing deposit: ${estimate.existingSecurityDeposit.toFixed(2)} TRX, ` +
                    `existing TRX: ${estimate.existingTrxAmount.toFixed(2)}, ` +
                    `total TRX after: ${estimate.totalTrxAmount})`,
                }, null, 2)
              }]
            };
          }
        }

        // New rental calculation
        if (!durationHours || durationHours < 1) {
          throw new Error("durationHours is required (minimum 1) for new rentals");
        }
        const durationSeconds = durationHours * 3600;
        const estimate = await services.calculateRentalPrice(energyAmount, durationSeconds, network);
        return {
          content: [{
            type: "text", text: JSON.stringify({
              ...estimate,
              isRenewal: false,
              durationHours,
              summary: `Renting ${energyAmount} energy for ${durationHours} hours costs ~${estimate.totalPrepayment.toFixed(2)} TRX ` +
                `(daily: ${estimate.dailyRentalCost.toFixed(2)} TRX, deposit: ${estimate.securityDeposit.toFixed(2)} TRX)`,
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_energy_rental_rate",
    {
      description:
        "Get the current energy rental rate for a given TRX amount. " +
        "Returns rental rate, stable rate, and effective rate (max of both).",
      inputSchema: {
        trxAmount: z.number().min(0).describe("TRX amount to check rate for (0 for base rate)"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Energy Rental Rate", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ trxAmount, network = services.getGlobalNetwork() }) => {
      try {
        const rate = await services.getRentalRate(trxAmount, network);
        return { content: [{ type: "text", text: JSON.stringify(rate, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_user_energy_rental_orders",
    {
      description:
        "Get a user's energy rental orders from JustLend. Can filter by role: " +
        "'renter' (orders where user is renting out), 'receiver' (orders where user receives energy), or 'all'.",
      inputSchema: {
        address: z.string().optional().describe("Address to query. Default: configured wallet"),
        type: z.enum(["renter", "receiver", "all"]).optional().describe("Filter by role. Default: all"),
        page: z.number().optional().describe("Page number (0-indexed). Default: 0"),
        pageSize: z.number().optional().describe("Results per page. Default: 10"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "User Energy Rental Orders", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ address, type = "all", page = 0, pageSize = 10, network = services.getGlobalNetwork() }) => {
      try {
        const addr = address || await services.getWalletAddress();
        const orders = await services.getUserRentalOrders(addr, type, page, pageSize, network);
        return { content: [{ type: "text", text: JSON.stringify(orders, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_energy_rent_info",
    {
      description:
        "Get on-chain energy rental info for a specific renter-receiver pair. " +
        "Returns security deposit, rent balance, and whether an active rental exists.",
      inputSchema: {
        renterAddress: z.string().optional().describe("Renter address. Default: configured wallet"),
        receiverAddress: z.string().describe("Receiver address"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Energy Rent Info", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ renterAddress, receiverAddress, network = services.getGlobalNetwork() }) => {
      try {
        const renter = renterAddress || await services.getWalletAddress();
        const info = await services.getRentInfo(renter, receiverAddress, network);
        return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_return_rental_info",
    {
      description:
        "Get estimated refund info for returning/canceling an energy rental. " +
        "Shows how much TRX would be refunded (estimatedRefundTrx), remaining rent, " +
        "security deposit, usage rental cost, unrecovered energy, and daily rent cost.",
      inputSchema: {
        renterAddress: z.string().optional().describe("Renter address. Default: configured wallet"),
        receiverAddress: z.string().describe("Receiver address"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Return Rental Info", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ renterAddress, receiverAddress, network = services.getGlobalNetwork() }) => {
      try {
        const renter = renterAddress || await services.getWalletAddress();
        const info = await services.getReturnRentalInfo(renter, receiverAddress, network);
        return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  // ============================================================================
  // ENERGY RENTAL (Write)
  // ============================================================================

  server.registerTool(
    "rent_energy",
    {
      description:
        "Rent energy from JustLend for a specified receiver address. " +
        "Automatically calculates TRX needed based on energy amount. " +
        "For NEW rentals: durationHours is required (minimum 1 hour), minimum energy is 300,000. " +
        "For RENEWALS (existing active rental to the same receiver): durationHours is NOT needed — " +
        "the remaining duration from the existing order is used automatically. Minimum energy for renewal is 50,000. " +
        "Pre-checks: rental not paused, amount within limits, sufficient TRX balance.",
      inputSchema: {
        receiverAddress: z.string().describe("Address that will receive the energy"),
        energyAmount: z.coerce.number().min(50000).describe("Amount of energy to rent (minimum 300,000 for new rental, minimum 50,000 for renewal)"),
        durationHours: z.coerce.number().min(1).optional().describe("Rental duration in hours (minimum 1 hour). Required for new rentals. Ignored for renewals (uses existing order's remaining duration)."),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Rent Energy", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ receiverAddress, energyAmount, durationHours, network = services.getGlobalNetwork() }) => {
      try {

        const durationSeconds = durationHours ? durationHours * 3600 : undefined;
        const result = await services.rentEnergy(receiverAddress, energyAmount, durationSeconds, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "return_energy_rental",
    {
      description:
        "Return (cancel) an active energy rental. As a renter, provide the receiver address. " +
        "As a receiver, provide the renter address. " +
        "Pre-checks: active rental must exist between the two addresses.",
      inputSchema: {
        counterpartyAddress: z.string().describe("The other party's address (receiver if you are renter, renter if you are receiver)"),
        endOrderType: z.enum(["renter", "receiver"]).optional().describe("Your role: 'renter' (default) or 'receiver'"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Return Energy Rental", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ counterpartyAddress, endOrderType = "renter", network = services.getGlobalNetwork() }) => {
      try {

        const result = await services.returnEnergyRental(counterpartyAddress, endOrderType, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

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

  // ============================================================================
  // GLOBAL CONFIGURATION
  // ============================================================================

  server.registerTool(
    "set_network",
    {
      description: "Set the global default network used by all JustLend operations unless explicitly overridden.",
      inputSchema: {
        network: z.string().describe("Network name (mainnet, nile)."),
      },
      annotations: { title: "Set Global Network", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ network }) => {
      try {
        services.setGlobalNetwork(network);
        return { content: [{ type: "text", text: `Successfully switched global default network to: ${network}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_network",
    {
      description: "Get the current global default network used by all JustLend operations.",
      inputSchema: {},
      annotations: { title: "Get Global Network", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      return { content: [{ type: "text", text: `Current global default network: ${services.getGlobalNetwork()}` }] };
    },
  );

  // ============================================================================
  // TRANSFER
  // ============================================================================

  server.registerTool(
    "transfer_trx",
    {
      description:
        "Transfer TRX to another TRON address. " +
        "Checks balance sufficiency (including gas) before sending. " +
        "Typical cost: ~0 energy + ~270 bandwidth.",
      inputSchema: {
        to: z.string().describe("Recipient TRON address (Base58 T... format)"),
        amount: z.string().describe("Amount of TRX to transfer (e.g. '1', '10.5')"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Transfer TRX", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ to, amount, network = services.getGlobalNetwork() }) => {
      try {
        const txId = await services.transferTRX(to, amount, network);
        return { content: [{ type: "text", text: JSON.stringify({
          success: true,
          txId,
          from: await services.getWalletAddress(),
          to,
          amount: `${amount} TRX`,
          network,
        }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "transfer_trc20",
    {
      description:
        "Transfer TRC20 tokens to another TRON address. " +
        "You can pass a token symbol (e.g. 'USDT', 'JST') or a contract address. " +
        "Amount is in human-readable units (e.g. '100' for 100 USDT). " +
        "Checks balance sufficiency before sending.",
      inputSchema: {
        to: z.string().describe("Recipient TRON address (Base58 T... format)"),
        amount: z.string().describe("Amount to transfer in human-readable units (e.g. '100' for 100 USDT)"),
        token: z.string().optional().describe("Token symbol (e.g. 'USDT', 'JST', 'SUN'). Preferred over tokenAddress."),
        tokenAddress: z.string().optional().describe("TRC20 token contract address. Use 'token' parameter instead when possible."),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Transfer TRC20", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ to, amount, token, tokenAddress, network = services.getGlobalNetwork() }) => {
      try {
        // Resolve token address from symbol if needed
        let resolvedAddress = tokenAddress;
        if (token && !resolvedAddress) {
          const info = getJTokenInfo(`j${token}`, network);
          if (!info) {
            throw new Error(`Unknown token symbol: ${token}. Please provide the token contract address directly.`);
          }
          resolvedAddress = info.underlying;
        }
        if (!resolvedAddress) {
          throw new Error("Either 'token' or 'tokenAddress' must be provided.");
        }

        // Convert human-readable amount to raw amount
        let decimals = 18;
        if (token) {
          const info = getJTokenInfo(`j${token}`, network);
          if (info) decimals = info.underlyingDecimals;
        }
        const rawAmount = utils.parseUnits(amount, decimals).toString();

        const result = await services.transferTRC20(resolvedAddress, to, rawAmount, network);
        return { content: [{ type: "text", text: JSON.stringify({
          success: true,
          txId: result.txHash,
          from: await services.getWalletAddress(),
          to,
          amount: `${amount} ${result.token.symbol}`,
          network,
        }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );
}
