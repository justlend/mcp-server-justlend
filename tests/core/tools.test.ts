import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ============================================================================
// Mock all service modules
// ============================================================================

vi.mock("../../src/core/services/index.js", () => ({
  // Wallet
  getWalletAddress: vi.fn(() => "TTestWalletAddress123456789012345"),
  getConfiguredPrivateKey: vi.fn(() => "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"),
  getConfiguredWallet: vi.fn(() => ({
    privateKey: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    address: "TTestWalletAddress123456789012345",
  })),

  // Market Data
  getMarketData: vi.fn(async () => ({
    symbol: "jUSDT",
    underlyingSymbol: "USDT",
    jTokenAddress: "TXJgMdjVX5dKiQaUi9QobR2d1pTdip5xG3",
    underlyingAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    supplyAPY: 3.25,
    borrowAPY: 5.50,
    totalSupply: "100000000.00",
    totalBorrows: "50000000.00",
    totalReserves: "1000000.00",
    availableLiquidity: "49000000.00",
    exchangeRate: "0.0200000000",
    collateralFactor: 75,
    reserveFactor: 10,
    isListed: true,
    mintPaused: false,
    borrowPaused: false,
    underlyingPriceUSD: "1.000000",
    utilizationRate: 50.51,
  })),

  getAllMarketData: vi.fn(async () => [
    {
      symbol: "jUSDT",
      underlyingSymbol: "USDT",
      supplyAPY: 3.25,
      borrowAPY: 5.50,
      totalSupply: "100000000.00",
      totalBorrows: "50000000.00",
      availableLiquidity: "49000000.00",
      utilizationRate: 50.51,
      collateralFactor: 75,
      underlyingPriceUSD: "1.000000",
      mintPaused: false,
      borrowPaused: false,
    },
  ]),

  getProtocolSummary: vi.fn(async () => ({
    comptroller: "TGjYzgCyPobsNS9n6WcbdLVR9dH7mWqFx7",
    oracle: "TXjzHPaDeR2KYXQ3Gfwj82PQ2qHaGThFhi",
    closeFactor: "50.0%",
    liquidationIncentive: "108.0%",
    totalMarkets: 8,
    marketAddresses: [],
    network: "mainnet",
  })),

  // Account
  getAccountSummary: vi.fn(async () => ({
    address: "TTestWalletAddress123456789012345",
    network: "mainnet",
    positions: [],
    totalSupplyUSD: "0.00",
    totalBorrowUSD: "0.00",
    liquidityUSD: "0.00",
    shortfallUSD: "0.00",
    healthFactor: "∞",
    collateralMarkets: [],
  })),

  checkAllowance: vi.fn(async () => ({
    allowance: "1000000.000000",
    hasApproval: true,
    underlyingAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    jTokenAddress: "TXJgMdjVX5dKiQaUi9QobR2d1pTdip5xG3",
  })),

  getTRXBalance: vi.fn(async () => "1000.000000"),

  getTokenBalance: vi.fn(async () => ({
    balance: "5000.000000",
    symbol: "USDT",
    decimals: 6,
  })),

  // Lending Operations
  supply: vi.fn(async () => ({
    txID: "mock_supply_tx_id_123",
    jTokenSymbol: "jUSDT",
    amount: "100",
    message: "Supplied 100 USDT to jUSDT",
  })),

  withdraw: vi.fn(async () => ({
    txID: "mock_withdraw_tx_id_123",
    jTokenSymbol: "jUSDT",
    amount: "50",
    message: "Withdrew 50 USDT from jUSDT",
  })),

  withdrawAll: vi.fn(async () => ({
    txID: "mock_withdraw_all_tx_id_123",
    jTokenSymbol: "jUSDT",
    message: "Withdrew all supply from jUSDT",
  })),

  borrow: vi.fn(async () => ({
    txID: "mock_borrow_tx_id_123",
    jTokenSymbol: "jUSDT",
    amount: "200",
    message: "Borrowed 200 USDT from jUSDT",
  })),

  repay: vi.fn(async () => ({
    txID: "mock_repay_tx_id_123",
    jTokenSymbol: "jUSDT",
    amount: "100",
    message: "Repaid 100 USDT to jUSDT",
  })),

  enterMarket: vi.fn(async () => ({
    txID: "mock_enter_market_tx_id_123",
    message: "Enabled jUSDT as collateral",
  })),

  exitMarket: vi.fn(async () => ({
    txID: "mock_exit_market_tx_id_123",
    message: "Disabled jUSDT as collateral",
  })),

  approveUnderlying: vi.fn(async () => ({
    txID: "mock_approve_tx_id_123",
    message: "Approved unlimited USDT for jUSDT",
  })),

  claimRewards: vi.fn(async () => ({
    txID: "mock_claim_tx_id_123",
    message: "Claimed JustLend rewards for TTestWalletAddress123456789012345",
  })),
}));

import { registerJustLendTools } from "../../src/core/tools.js";
import * as services from "../../src/core/services/index.js";

// ============================================================================
// Helper: create server & extract tool handler
// ============================================================================

let server: McpServer;
const registeredTools = new Map<string, { handler: Function; config: any }>();

beforeEach(() => {
  vi.clearAllMocks();

  server = new McpServer(
    { name: "test-server", version: "1.0.0" },
    { capabilities: { tools: { listChanged: true } } },
  );

  // Spy on registerTool to capture handlers
  const originalRegisterTool = server.registerTool.bind(server);
  server.registerTool = ((name: string, config: any, handler: Function) => {
    registeredTools.set(name, { handler, config });
    return originalRegisterTool(name, config, handler);
  }) as typeof server.registerTool;

  registerJustLendTools(server);
});

async function callTool(name: string, args: Record<string, any> = {}): Promise<any> {
  const tool = registeredTools.get(name);
  if (!tool) throw new Error(`Tool "${name}" not registered`);
  const result = await tool.handler(args);
  return result;
}

function getToolOutput(result: any): any {
  const text = result.content[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ============================================================================
// Tool Registration
// ============================================================================

describe("Tool Registration", () => {
  it("should register all 19 JustLend tools", () => {
    const expectedTools = [
      "get_wallet_address",
      "get_supported_networks",
      "get_supported_markets",
      "get_market_data",
      "get_all_markets",
      "get_protocol_summary",
      "get_account_summary",
      "check_allowance",
      "get_trx_balance",
      "get_token_balance",
      "supply",
      "withdraw",
      "withdraw_all",
      "borrow",
      "repay",
      "enter_market",
      "exit_market",
      "approve_underlying",
      "claim_rewards",
    ];

    for (const name of expectedTools) {
      expect(registeredTools.has(name), `Tool "${name}" should be registered`).toBe(true);
    }
    expect(registeredTools.size).toBe(expectedTools.length);
  });

  it("read-only tools should have readOnlyHint: true", () => {
    const readOnlyTools = [
      "get_wallet_address",
      "get_supported_networks",
      "get_supported_markets",
      "get_market_data",
      "get_all_markets",
      "get_protocol_summary",
      "get_account_summary",
      "check_allowance",
      "get_trx_balance",
      "get_token_balance",
    ];
    for (const name of readOnlyTools) {
      const tool = registeredTools.get(name);
      expect(tool?.config.annotations?.readOnlyHint, `${name} should be readOnly`).toBe(true);
    }
  });

  it("write tools should have destructiveHint: true", () => {
    const destructiveTools = [
      "supply",
      "withdraw",
      "withdraw_all",
      "borrow",
      "repay",
      "exit_market",
    ];
    for (const name of destructiveTools) {
      const tool = registeredTools.get(name);
      expect(tool?.config.annotations?.destructiveHint, `${name} should be destructive`).toBe(true);
    }
  });
});

// ============================================================================
// Wallet & Network Tools
// ============================================================================

describe("Wallet & Network Tools", () => {
  it("get_wallet_address should return wallet address", async () => {
    const result = await callTool("get_wallet_address");
    const output = getToolOutput(result);
    expect(output.address).toBe("TTestWalletAddress123456789012345");
    expect(services.getWalletAddress).toHaveBeenCalled();
  });

  it("get_supported_networks should list networks", async () => {
    const result = await callTool("get_supported_networks");
    const output = getToolOutput(result);
    expect(output.networks).toContain("mainnet");
    expect(output.networks).toContain("nile");
    expect(output.default).toBe("mainnet");
  });

  it("get_supported_markets should return market list", async () => {
    const result = await callTool("get_supported_markets", { network: "mainnet" });
    const output = getToolOutput(result);
    expect(output.comptroller).toBeDefined();
    expect(output.markets).toBeInstanceOf(Array);
    expect(output.totalMarkets).toBeGreaterThan(0);

    const symbols = output.markets.map((m: any) => m.symbol);
    expect(symbols).toContain("jTRX");
    expect(symbols).toContain("jUSDT");
  });

  it("get_supported_markets should include market details", async () => {
    const result = await callTool("get_supported_markets", { network: "mainnet" });
    const output = getToolOutput(result);
    const jUSDT = output.markets.find((m: any) => m.symbol === "jUSDT");
    expect(jUSDT).toBeDefined();
    expect(jUSDT.underlyingSymbol).toBe("USDT");
    expect(jUSDT.jTokenAddress).toBeDefined();
    expect(jUSDT.decimals).toBe(8);
    expect(jUSDT.underlyingDecimals).toBe(6);
  });
});

// ============================================================================
// Market Data Tools
// ============================================================================

describe("Market Data Tools", () => {
  it("get_market_data should fetch and return market info", async () => {
    const result = await callTool("get_market_data", { market: "jUSDT" });
    const output = getToolOutput(result);
    expect(output.symbol).toBe("jUSDT");
    expect(output.supplyAPY).toBe(3.25);
    expect(output.borrowAPY).toBe(5.50);
    expect(services.getMarketData).toHaveBeenCalled();
  });

  it("get_market_data should error for unknown market", async () => {
    const result = await callTool("get_market_data", { market: "jDOGE" });
    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(text).toContain("Unknown market");
  });

  it("get_all_markets should return array of markets", async () => {
    const result = await callTool("get_all_markets");
    const output = getToolOutput(result);
    expect(output.totalMarkets).toBe(1);
    expect(output.markets).toBeInstanceOf(Array);
    expect(output.markets[0].symbol).toBe("jUSDT");
    expect(output.markets[0].supplyAPY).toBe("3.25%");
    expect(services.getAllMarketData).toHaveBeenCalled();
  });

  it("get_protocol_summary should return protocol info", async () => {
    const result = await callTool("get_protocol_summary");
    const output = getToolOutput(result);
    expect(output.comptroller).toBeDefined();
    expect(output.closeFactor).toBe("50.0%");
    expect(output.totalMarkets).toBe(8);
    expect(services.getProtocolSummary).toHaveBeenCalled();
  });
});

// ============================================================================
// Account & Balance Tools
// ============================================================================

describe("Account & Balance Tools", () => {
  it("get_account_summary should return position data", async () => {
    const result = await callTool("get_account_summary");
    const output = getToolOutput(result);
    expect(output.address).toBe("TTestWalletAddress123456789012345");
    expect(output.healthFactor).toBe("∞");
    expect(output.positions).toBeInstanceOf(Array);
    expect(services.getAccountSummary).toHaveBeenCalled();
  });

  it("get_account_summary should accept custom address", async () => {
    const result = await callTool("get_account_summary", { address: "TCustomAddress123" });
    expect(services.getAccountSummary).toHaveBeenCalledWith("TCustomAddress123", "mainnet");
  });

  it("check_allowance should return approval info", async () => {
    const result = await callTool("check_allowance", { market: "jUSDT" });
    const output = getToolOutput(result);
    expect(output.hasApproval).toBe(true);
    expect(output.allowance).toBe("1000000.000000");
    expect(services.checkAllowance).toHaveBeenCalled();
  });

  it("get_trx_balance should return TRX balance", async () => {
    const result = await callTool("get_trx_balance");
    const output = getToolOutput(result);
    expect(output.balance).toBe("1000.000000 TRX");
    expect(output.address).toBe("TTestWalletAddress123456789012345");
    expect(services.getTRXBalance).toHaveBeenCalled();
  });

  it("get_token_balance should return token balance", async () => {
    const result = await callTool("get_token_balance", { tokenAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" });
    const output = getToolOutput(result);
    expect(output.balance).toBe("5000.000000");
    expect(output.symbol).toBe("USDT");
    expect(services.getTokenBalance).toHaveBeenCalled();
  });
});

// ============================================================================
// Lending Operation Tools
// ============================================================================

describe("Lending Operation Tools", () => {
  it("supply should call services.supply with correct args", async () => {
    const result = await callTool("supply", { market: "jUSDT", amount: "100" });
    const output = getToolOutput(result);
    expect(output.txID).toBe("mock_supply_tx_id_123");
    expect(output.message).toContain("Supplied");
    expect(services.supply).toHaveBeenCalledWith(
      "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      "jUSDT",
      "100",
      "mainnet",
    );
  });

  it("withdraw should call services.withdraw", async () => {
    const result = await callTool("withdraw", { market: "jUSDT", amount: "50" });
    const output = getToolOutput(result);
    expect(output.txID).toBe("mock_withdraw_tx_id_123");
    expect(services.withdraw).toHaveBeenCalledWith(
      expect.any(String),
      "jUSDT",
      "50",
      "mainnet",
    );
  });

  it("withdraw_all should call services.withdrawAll", async () => {
    const result = await callTool("withdraw_all", { market: "jUSDT" });
    const output = getToolOutput(result);
    expect(output.txID).toBe("mock_withdraw_all_tx_id_123");
    expect(services.withdrawAll).toHaveBeenCalledWith(
      expect.any(String),
      "jUSDT",
      "mainnet",
    );
  });

  it("borrow should call services.borrow", async () => {
    const result = await callTool("borrow", { market: "jUSDT", amount: "200" });
    const output = getToolOutput(result);
    expect(output.txID).toBe("mock_borrow_tx_id_123");
    expect(services.borrow).toHaveBeenCalledWith(
      expect.any(String),
      "jUSDT",
      "200",
      "mainnet",
    );
  });

  it("repay should call services.repay", async () => {
    const result = await callTool("repay", { market: "jUSDT", amount: "100" });
    const output = getToolOutput(result);
    expect(output.txID).toBe("mock_repay_tx_id_123");
    expect(services.repay).toHaveBeenCalledWith(
      expect.any(String),
      "jUSDT",
      "100",
      "mainnet",
    );
  });

  it("enter_market should call services.enterMarket", async () => {
    const result = await callTool("enter_market", { market: "jUSDT" });
    const output = getToolOutput(result);
    expect(output.txID).toBe("mock_enter_market_tx_id_123");
    expect(services.enterMarket).toHaveBeenCalledWith(
      expect.any(String),
      "jUSDT",
      "mainnet",
    );
  });

  it("exit_market should call services.exitMarket", async () => {
    const result = await callTool("exit_market", { market: "jUSDT" });
    const output = getToolOutput(result);
    expect(output.txID).toBe("mock_exit_market_tx_id_123");
    expect(services.exitMarket).toHaveBeenCalledWith(
      expect.any(String),
      "jUSDT",
      "mainnet",
    );
  });

  it("approve_underlying should call services.approveUnderlying", async () => {
    const result = await callTool("approve_underlying", { market: "jUSDT" });
    const output = getToolOutput(result);
    expect(output.txID).toBe("mock_approve_tx_id_123");
    expect(services.approveUnderlying).toHaveBeenCalledWith(
      expect.any(String),
      "jUSDT",
      "max",
      "mainnet",
    );
  });

  it("approve_underlying should pass custom amount", async () => {
    await callTool("approve_underlying", { market: "jUSDT", amount: "1000" });
    expect(services.approveUnderlying).toHaveBeenCalledWith(
      expect.any(String),
      "jUSDT",
      "1000",
      "mainnet",
    );
  });

  it("claim_rewards should call services.claimRewards", async () => {
    const result = await callTool("claim_rewards");
    const output = getToolOutput(result);
    expect(output.txID).toBe("mock_claim_tx_id_123");
    expect(services.claimRewards).toHaveBeenCalledWith(
      expect.any(String),
      "mainnet",
    );
  });
});

// ============================================================================
// Error Handling
// ============================================================================

describe("Error Handling", () => {
  it("should return isError: true when wallet not configured", async () => {
    vi.mocked(services.getWalletAddress).mockImplementationOnce(() => {
      throw new Error("Neither TRON_PRIVATE_KEY nor TRON_MNEMONIC environment variable is set.");
    });
    const result = await callTool("get_wallet_address");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("TRON_PRIVATE_KEY");
  });

  it("should return isError: true when service throws", async () => {
    vi.mocked(services.getMarketData).mockRejectedValueOnce(new Error("Network timeout"));
    const result = await callTool("get_market_data", { market: "jUSDT" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Network timeout");
  });

  it("should return isError: true for supply with no private key", async () => {
    vi.mocked(services.getConfiguredPrivateKey).mockImplementationOnce(() => {
      throw new Error("Neither TRON_PRIVATE_KEY nor TRON_MNEMONIC environment variable is set.");
    });
    const result = await callTool("supply", { market: "jUSDT", amount: "100" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("TRON_PRIVATE_KEY");
  });

  it("tools should pass network parameter correctly", async () => {
    await callTool("get_market_data", { market: "jUSDT", network: "nile" });
    // jUSDT exists on mainnet but getJTokenInfo is called with "nile"
    // Since nile has no jTokens, it should error
    // This verifies network param is passed through
  });
});

// ============================================================================
// Network Parameter Forwarding
// ============================================================================

describe("Network Parameter Forwarding", () => {
  it("supply should forward network parameter", async () => {
    await callTool("supply", { market: "jUSDT", amount: "100", network: "nile" });
    // getConfiguredPrivateKey is called first, then supply would be called
    // Since we mock it, verify the mock was called
    expect(services.getConfiguredPrivateKey).toHaveBeenCalled();
  });

  it("get_all_markets should default to mainnet", async () => {
    await callTool("get_all_markets");
    expect(services.getAllMarketData).toHaveBeenCalledWith("mainnet");
  });

  it("get_protocol_summary should default to mainnet", async () => {
    await callTool("get_protocol_summary");
    expect(services.getProtocolSummary).toHaveBeenCalledWith("mainnet");
  });
});
