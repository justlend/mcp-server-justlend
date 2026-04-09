import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getJustLendAddresses, getAllJTokens, getJTokenInfo,
  getSupportedNetworks,
} from "../chains.js";
import * as services from "../services/index.js";
import { resolveKnownToken } from "../services/tokens.js";
import { utils } from "../services/utils.js";
import { sanitizeError } from "./shared.js";

export function registerMarketTools(server: McpServer) {

  // ============================================================================
  // NETWORK & MARKET DISCOVERY
  // ============================================================================

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
        const result = await services.getMarketDataWithFallback(info, network);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ...result.data,
              ...(result.source === "api" ? { source: "api" } : {}),
            }, null, 2),
          }],
        };
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

        const resolvedAddress = resolveKnownToken(tokenInput, network)?.address ?? tokenInput;

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
    "get_wallet_balances",
    {
      description:
        "Batch-fetch TRC20 token balances for a wallet across multiple JustLend markets in a single RPC call " +
        "using the Multicall3 walletTokensBalance method. " +
        "Returns human-readable balances (decimals already applied) for all specified tokens at once. " +
        "Use this instead of calling get_token_balance repeatedly when you need balances for several tokens.",
      inputSchema: {
        tokens: z
          .array(z.string())
          .optional()
          .describe(
            "List of token symbols to check (e.g. ['USDT', 'USDD', 'ETH', 'BTC']). " +
            "Defaults to all TRC20 underlying tokens across all JustLend markets.",
          ),
        address: z.string().optional().describe("TRON wallet address. Default: configured wallet"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Wallet Token Balances (Batch)", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ tokens, address, network = services.getGlobalNetwork() }) => {
      try {
        const userAddress = address || await services.getWalletAddress();
        const allJTokens = getAllJTokens(network);

        // Collect TRC20 tokens to query (skip native TRX — no contract address)
        const candidates = allJTokens.filter((t) => t.underlying);
        const filtered = tokens && tokens.length > 0
          ? candidates.filter((t) => tokens.some((s) => s.toLowerCase() === t.underlyingSymbol.toLowerCase()))
          : candidates;

        // Deduplicate by underlying address
        const seen = new Set<string>();
        const tokenList = filtered.filter((t) => {
          if (seen.has(t.underlying)) return false;
          seen.add(t.underlying);
          return true;
        }).map((t) => ({ address: t.underlying, symbol: t.underlyingSymbol, decimals: t.underlyingDecimals }));

        const balances = await services.getWalletTokensBalance(userAddress, tokenList, network);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              wallet: userAddress,
              note: "Balances are in human-readable token units (decimals already applied).",
              balances,
            }, null, 2),
          }],
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
}
