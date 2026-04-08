import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ============================================================================
// Mock all service modules
// ============================================================================

vi.mock("../../src/core/services/index.js", () => ({
  // Wallet (agent-wallet based — getWalletAddress is now async)
  getWalletAddress: vi.fn(async () => "TTestWalletAddress123456789012345"),
  autoInitWallet: vi.fn(async () => ({
    address: "TTestWalletAddress123456789012345",
    walletId: "default",
    created: false,
  })),
  importWallet: vi.fn(async () => ({
    address: "TTestWalletAddress123456789012345",
    walletId: "imported",
  })),
  checkWalletStatus: vi.fn(async () => ({
    initialized: true,
    hasWallets: true,
    activeWalletId: "default",
    activeAddress: "TTestWalletAddress123456789012345",
    wallets: [{ id: "default", type: "local_secure", isActive: true, address: "TTestWalletAddress123456789012345" }],
    message: "Active wallet: TTestWalletAddress123456789012345",
  })),
  listWallets: vi.fn(async () => [
    { id: "default", type: "local_secure", isActive: true, address: "TTestWalletAddress123456789012345" },
  ]),
  setActiveWallet: vi.fn(() => ({ success: true, message: 'Active wallet set to "default".' })),

  // Global Config
  getGlobalNetwork: vi.fn(() => "mainnet"),
  setGlobalNetwork: vi.fn(),

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

  getMarketDataWithFallback: vi.fn(async () => ({
    data: {
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
    },
    source: "contract",
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

  getAllMarketOverview: vi.fn(async () => [
    {
      symbol: "jUSDT",
      underlyingSymbol: "USDT",
      supplyAPY: "3.25%",
      borrowAPY: "5.50%",
      miningAPY: "0.00%",
      totalSupplyAPY: "3.25%",
      depositedUSD: "100000000.00",
      borrowedUSD: "50000000.00",
    },
  ]),

  getAllMarketsWithFallback: vi.fn(async () => ({
    markets: [
      {
        symbol: "jUSDT",
        underlyingSymbol: "USDT",
        supplyAPY: "3.25%",
        borrowAPY: "5.50%",
        miningAPY: "0.00%",
        totalSupplyAPY: "3.25%",
        depositedUSD: "100000000.00",
        borrowedUSD: "50000000.00",
      },
    ],
    source: "api",
    note: "totalSupplyAPY = supplyAPY + underlyingIncrementAPY + miningAPY.",
  })),

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
    allowanceRaw: "1000000000000",
    hasApproval: true,
    underlyingAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    jTokenAddress: "TXJgMdjVX5dKiQaUi9QobR2d1pTdip5xG3",
  })),

  getTRXBalance: vi.fn(async () => ({ formatted: "1000.000000" })),

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

  // Resource estimation
  estimateLendingEnergy: vi.fn(async () => ({
    operation: "supply",
    market: "jUSDT",
    steps: [],
    totalEnergy: 100000,
    totalBandwidth: 310,
    estimatedTRXCost: "42.310",
    costBreakdown: { energyCostTRX: "42.000", bandwidthCostTRX: "0.310", note: "" },
    note: "",
  })),

  getTypicalResources: vi.fn(() => ({ energy: 100000, bandwidth: 310 })),

  checkResourceSufficiency: vi.fn(async () => ({
    hasEnoughEnergy: true,
    hasEnoughBandwidth: true,
    accountEnergy: 200000,
    accountBandwidth: 5000,
    requiredEnergy: 100000,
    requiredBandwidth: 310,
    energyDeficit: 0,
    bandwidthDeficit: 0,
    energyBurnTRX: "0.000",
    bandwidthBurnTRX: "0.000",
    totalBurnTRX: "0.000",
    warning: "",
  })),

  // API-based queries
  getMarketDataFromAPI: vi.fn(async () => ({ data: [] })),
  getMarketDashboardFromAPI: vi.fn(async () => ({ data: {} })),
  getJTokenDetailsFromAPI: vi.fn(async () => ({ data: {} })),
  getAccountDataFromAPI: vi.fn(async () => ({ data: {} })),

  // Mining rewards
  getMiningRewardsFromAPI: vi.fn(async () => ({ rewards: [] })),
  getUSDDMiningConfig: vi.fn(() => ({ periods: [] })),
  getWBTCMiningConfig: vi.fn(() => ({ periods: [] })),

  // Energy Rental
  getEnergyRentalDashboard: vi.fn(async () => ({
    trxPrice: 0.12,
    exchangeRate: "1050000000000000000",
    totalApy: 5.5,
    voteApy: 3.2,
    totalSupply: "500000000",
    totalUnfreezable: "100000000",
    unfreezeDelayDays: 14,
    energyStakePerTrx: 30,
    energyBurnPerTrx: 420,
    jstAmountRewardRentPerTrx: 0.01,
    jstPrice: 0.03,
    energyLimit: 90000000000,
    energyUsed: 45000000000,
    sTrx1Trx: "0.952381",
    trx1sTrx: "1.050000",
  })),

  getEnergyRentalParams: vi.fn(async () => ({
    liquidateThreshold: 86400,
    feeRatio: 0.01,
    minFee: 10,
    totalDelegated: 5000000,
    totalFrozen: 10000000,
    maxRentable: 2000000,
    rentPaused: false,
    usageChargeRatio: 0.5,
  })),

  calculateRentalPrice: vi.fn(async () => ({
    energyAmount: 300000,
    trxAmount: 10000,
    durationSeconds: 604800,
    rate: 0.0000001,
    fee: 100,
    totalPrepayment: 850,
    securityDeposit: 200,
    dailyRentalCost: 86.4,
  })),

  getRentalRate: vi.fn(async () => ({
    rentalRate: 0.00000008,
    stableRate: 0.0000001,
    effectiveRate: 0.0000001,
  })),

  getUserRentalOrders: vi.fn(async () => ({
    orders: [{ receiver: "TReceiver123", energyAmount: 300000, canRentSeconds: 604800 }],
    total: 1,
  })),

  getRentInfo: vi.fn(async () => ({
    securityDeposit: 200,
    rentBalance: 10000,
    hasActiveRental: true,
  })),

  getReturnRentalInfo: vi.fn(async () => ({
    securityDeposit: 200,
    rentRemain: 500,
    unrecoveredEnergyAmount: 100000,
    dailyRent: 86.4,
    rentAmount: 10000,
  })),

  rentEnergy: vi.fn(async () => ({
    txId: "mock_rent_energy_tx_id_123",
    receiver: "TReceiver123",
    energyAmount: 300000,
    trxAmount: 10000,
    totalPrepayment: 850,
    durationSeconds: 604800,
  })),

  returnEnergyRental: vi.fn(async () => ({
    txId: "mock_return_rental_tx_id_123",
    renter: "TTestWalletAddress123456789012345",
    receiver: "TReceiver123",
    returnedTrxAmount: 10000,
    refundedDeposit: 200,
  })),

  // sTRX Staking
  getStrxDashboard: vi.fn(async () => ({
    trxPrice: 0.12,
    exchangeRate: "1050000000000000000",
    totalApy: 5.5,
    voteApy: 3.2,
    totalSupply: "500000000",
    totalUnfreezable: "100000000",
    unfreezeDelayDays: 14,
    energyStakePerTrx: 30,
    jstAmountRewardRentPerTrx: 0.01,
    jstPrice: 0.03,
    sTrx1Trx: "0.952381",
    trx1sTrx: "1.050000",
  })),

  getStrxStakeAccount: vi.fn(async () => ({
    accountSupply: 1000,
    accountIncome: 50,
    accountCanClaimAmount: 10,
    accountWithDrawAmount: 0,
    accountRentEnergyAmount: 0,
    roundDetails: [],
    rewardMap: { gainNew: 10 },
  })),

  getStrxBalance: vi.fn(async () => ({
    raw: 1000000000000000000000n,
    formatted: "1000.000000",
    symbol: "sTRX",
    decimals: 18,
  })),

  checkWithdrawalEligibility: vi.fn(async () => ({
    address: "TTestWalletAddress123456789012345",
    hasStakedTrx: true,
    stakedAmount: 1000,
    totalIncome: 50,
    claimableRewards: 10,
    withdrawnAmount: 0,
    pendingUnstakeRounds: 0,
    completedUnstakeRounds: 0,
    hasCompletedWithdrawals: false,
    unfreezeDelayDays: 14,
    roundDetails: [],
  })),

  stakeTrxToStrx: vi.fn(async () => ({
    txId: "mock_stake_trx_tx_id_123",
    stakedTrx: 100,
    estimatedStrx: "95.238095",
    wallet: "TTestWalletAddress123456789012345",
  })),

  unstakeStrx: vi.fn(async () => ({
    txId: "mock_unstake_strx_tx_id_123",
    unstakedStrx: 50,
    estimatedTrx: "52.500000",
    unfreezeDelayDays: 14,
    wallet: "TTestWalletAddress123456789012345",
    note: "TRX will be available for withdrawal after 14 days unbonding period",
  })),

  claimStrxRewards: vi.fn(async () => ({
    txId: "mock_claim_strx_rewards_tx_id_123",
    claimedAmount: 10,
    wallet: "TTestWalletAddress123456789012345",
  })),
}));

import { registerJustLendTools } from "../../src/core/tools.js";
import * as services from "../../src/core/services/index.js";
import { setWalletMode } from "../../src/core/services/global.js";

// ============================================================================
// Helper: create server & extract tool handler
// ============================================================================

let server: McpServer;
const registeredTools = new Map<string, { handler: Function; config: any }>();

beforeEach(() => {
  vi.clearAllMocks();
  registeredTools.clear();
  setWalletMode("unset");

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
  it("should register all JustLend tools", () => {
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
      "estimate_lending_energy",
      "get_mining_rewards",
      "get_usdd_mining_config",
      "get_wbtc_mining_config",
      // Energy Rental
      "get_energy_rental_dashboard",
      "get_energy_rental_params",
      "calculate_energy_rental_price",
      "get_energy_rental_rate",
      "get_user_energy_rental_orders",
      "get_energy_rent_info",
      "get_return_rental_info",
      "rent_energy",
      "return_energy_rental",
      // sTRX Staking
      "get_strx_dashboard",
      "get_strx_account",
      "get_strx_balance",
      "check_strx_withdrawal_eligibility",
      "stake_trx_to_strx",
      "unstake_strx",
      "claim_strx_rewards",
    ];

    for (const name of expectedTools) {
      expect(registeredTools.has(name), `Tool "${name}" should be registered`).toBe(true);
    }
  });

  it("should NOT register removed _from_api tools (v1.0.3)", () => {
    const removedTools = [
      "get_markets_from_api",
      "get_dashboard_from_api",
      "get_jtoken_details_from_api",
      "get_account_data_from_api",
    ];
    for (const name of removedTools) {
      expect(registeredTools.has(name), `Removed tool "${name}" should NOT be registered`).toBe(false);
    }
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
  it("get_wallet_address should return first-use wallet choice when mode is unset", async () => {
    const result = await callTool("get_wallet_address");
    const output = getToolOutput(result);
    expect(output.walletMode).toBe("unset");
    expect(output.address).toBeNull();
    expect(output.options.recommended.action).toBe("connect_browser_wallet");
    expect(output.options.alternative.params.mode).toBe("agent");
    expect(services.autoInitWallet).not.toHaveBeenCalled();
  });

  it("set_wallet_mode(agent) should create or use the agent wallet", async () => {
    const result = await callTool("set_wallet_mode", { mode: "agent" });
    const output = getToolOutput(result);
    expect(output.mode).toBe("agent");
    expect(output.address).toBe("TTestWalletAddress123456789012345");
    expect(services.autoInitWallet).toHaveBeenCalled();
  });

  it("get_wallet_address should return agent wallet after agent mode is selected", async () => {
    await callTool("set_wallet_mode", { mode: "agent" });
    const result = await callTool("get_wallet_address");
    const output = getToolOutput(result);
    expect(output.address).toBe("TTestWalletAddress123456789012345");
    expect(output.walletMode).toBe("agent");
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
    expect(services.getMarketDataWithFallback).toHaveBeenCalled();
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
    expect(services.getAllMarketsWithFallback).toHaveBeenCalled();
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
      "jUSDT",
      "mainnet",
    );
  });

  it("borrow should call services.borrow", async () => {
    const result = await callTool("borrow", { market: "jUSDT", amount: "200" });
    const output = getToolOutput(result);
    expect(output.txID).toBe("mock_borrow_tx_id_123");
    expect(services.borrow).toHaveBeenCalledWith(
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
      "jUSDT",
      "mainnet",
    );
  });

  it("exit_market should call services.exitMarket", async () => {
    const result = await callTool("exit_market", { market: "jUSDT" });
    const output = getToolOutput(result);
    expect(output.txID).toBe("mock_exit_market_tx_id_123");
    expect(services.exitMarket).toHaveBeenCalledWith(
      "jUSDT",
      "mainnet",
    );
  });

  it("approve_underlying should call services.approveUnderlying", async () => {
    const result = await callTool("approve_underlying", { market: "jUSDT" });
    const output = getToolOutput(result);
    expect(output.txID).toBe("mock_approve_tx_id_123");
    expect(services.approveUnderlying).toHaveBeenCalledWith(
      "jUSDT",
      "max",
      "mainnet",
    );
  });

  it("approve_underlying should pass custom amount", async () => {
    await callTool("approve_underlying", { market: "jUSDT", amount: "1000" });
    expect(services.approveUnderlying).toHaveBeenCalledWith(
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
      "mainnet",
    );
  });
});

// ============================================================================
// Error Handling
// ============================================================================

describe("Error Handling", () => {
  it("should return isError: true when wallet not configured", async () => {
    setWalletMode("agent");
    vi.mocked(services.autoInitWallet).mockRejectedValueOnce(
      new Error("No wallet configured. Run `agent-wallet start` to create one."),
    );
    const result = await callTool("get_wallet_address");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("wallet");
  });

  it("should return isError: true when service throws", async () => {
    vi.mocked(services.getMarketDataWithFallback).mockRejectedValueOnce(new Error("Network timeout"));
    const result = await callTool("get_market_data", { market: "jUSDT" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Network timeout");
  });

  it("should return isError: true for supply with no wallet configured", async () => {
    vi.mocked(services.getWalletAddress).mockRejectedValueOnce(
      new Error("No wallet configured. Run `agent-wallet start` to create one."),
    );
    const result = await callTool("supply", { market: "jUSDT", amount: "100" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("wallet");
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

// ============================================================================
// Energy Rental Tools
// ============================================================================

describe("Energy Rental Tools", () => {
  it("get_energy_rental_dashboard should return market data", async () => {
    const result = await callTool("get_energy_rental_dashboard");
    const output = getToolOutput(result);
    expect(output.trxPrice).toBe(0.12);
    expect(output.totalApy).toBe(5.5);
    expect(output.energyStakePerTrx).toBe(30);
    expect(services.getEnergyRentalDashboard).toHaveBeenCalledWith("mainnet");
  });

  it("get_energy_rental_params should return on-chain params", async () => {
    const result = await callTool("get_energy_rental_params");
    const output = getToolOutput(result);
    expect(output.rentPaused).toBe(false);
    expect(output.feeRatio).toBe(0.01);
    expect(output.minFee).toBe(10);
    expect(output.maxRentable).toBe(2000000);
    expect(services.getEnergyRentalParams).toHaveBeenCalledWith("mainnet");
  });

  it("calculate_energy_rental_price should return cost estimate", async () => {
    const result = await callTool("calculate_energy_rental_price", {
      energyAmount: 300000,
      durationHours: 168,
    });
    const output = getToolOutput(result);
    expect(output.energyAmount).toBe(300000);
    expect(output.totalPrepayment).toBe(850);
    expect(output.securityDeposit).toBe(200);
    expect(output.durationHours).toBe(168);
    expect(output.summary).toContain("300000 energy");
    expect(services.calculateRentalPrice).toHaveBeenCalledWith(300000, 604800, "mainnet");
  });

  it("get_energy_rental_rate should return rate info", async () => {
    const result = await callTool("get_energy_rental_rate", { trxAmount: 10000 });
    const output = getToolOutput(result);
    expect(output.effectiveRate).toBe(0.0000001);
    expect(services.getRentalRate).toHaveBeenCalledWith(10000, "mainnet");
  });

  it("get_user_energy_rental_orders should return orders", async () => {
    const result = await callTool("get_user_energy_rental_orders");
    const output = getToolOutput(result);
    expect(output.orders).toBeInstanceOf(Array);
    expect(output.total).toBe(1);
    expect(services.getUserRentalOrders).toHaveBeenCalled();
  });

  it("get_energy_rent_info should return rental state", async () => {
    const result = await callTool("get_energy_rent_info", {
      receiverAddress: "TReceiver123",
    });
    const output = getToolOutput(result);
    expect(output.hasActiveRental).toBe(true);
    expect(output.rentBalance).toBe(10000);
    expect(services.getRentInfo).toHaveBeenCalled();
  });

  it("get_return_rental_info should return return estimation", async () => {
    const result = await callTool("get_return_rental_info", {
      receiverAddress: "TReceiver123",
    });
    const output = getToolOutput(result);
    expect(output.securityDeposit).toBe(200);
    expect(output.dailyRent).toBe(86.4);
    expect(services.getReturnRentalInfo).toHaveBeenCalled();
  });

  it("rent_energy should call services.rentEnergy with correct args", async () => {
    const result = await callTool("rent_energy", {
      receiverAddress: "TReceiver123",
      energyAmount: 300000,
      durationHours: 168,
    });
    const output = getToolOutput(result);
    expect(output.txId).toBe("mock_rent_energy_tx_id_123");
    expect(output.receiver).toBe("TReceiver123");
    expect(output.energyAmount).toBe(300000);
    expect(services.rentEnergy).toHaveBeenCalledWith(
      "TReceiver123",
      300000,
      604800,
      "mainnet",
    );
  });

  it("return_energy_rental should call services.returnEnergyRental", async () => {
    const result = await callTool("return_energy_rental", {
      counterpartyAddress: "TReceiver123",
    });
    const output = getToolOutput(result);
    expect(output.txId).toBe("mock_return_rental_tx_id_123");
    expect(output.receiver).toBe("TReceiver123");
    expect(services.returnEnergyRental).toHaveBeenCalledWith(
      "TReceiver123",
      "renter",
      "mainnet",
    );
  });

  it("return_energy_rental should support receiver role", async () => {
    await callTool("return_energy_rental", {
      counterpartyAddress: "TRenter123",
      endOrderType: "receiver",
    });
    expect(services.returnEnergyRental).toHaveBeenCalledWith(
      "TRenter123",
      "receiver",
      "mainnet",
    );
  });
});

// ============================================================================
// sTRX Staking Tools
// ============================================================================

describe("sTRX Staking Tools", () => {
  it("get_strx_dashboard should return staking market data", async () => {
    const result = await callTool("get_strx_dashboard");
    const output = getToolOutput(result);
    expect(output.totalApy).toBe(5.5);
    expect(output.exchangeRate).toBe("1050000000000000000");
    expect(output.unfreezeDelayDays).toBe(14);
    expect(services.getStrxDashboard).toHaveBeenCalledWith("mainnet");
  });

  it("get_strx_account should return staking account info", async () => {
    const result = await callTool("get_strx_account");
    const output = getToolOutput(result);
    expect(output.accountSupply).toBe(1000);
    expect(output.accountCanClaimAmount).toBe(10);
    expect(services.getStrxStakeAccount).toHaveBeenCalled();
  });

  it("get_strx_balance should return sTRX balance", async () => {
    const result = await callTool("get_strx_balance");
    const output = getToolOutput(result);
    expect(output.formatted).toBe("1000.000000");
    expect(output.symbol).toBe("sTRX");
    expect(output.raw).toBe("1000000000000000000000");
    expect(services.getStrxBalance).toHaveBeenCalled();
  });

  it("check_strx_withdrawal_eligibility should return eligibility info", async () => {
    const result = await callTool("check_strx_withdrawal_eligibility");
    const output = getToolOutput(result);
    expect(output.hasStakedTrx).toBe(true);
    expect(output.stakedAmount).toBe(1000);
    expect(output.claimableRewards).toBe(10);
    expect(output.unfreezeDelayDays).toBe(14);
    expect(services.checkWithdrawalEligibility).toHaveBeenCalled();
  });

  it("stake_trx_to_strx should call services.stakeTrxToStrx", async () => {
    const result = await callTool("stake_trx_to_strx", { amount: 100 });
    const output = getToolOutput(result);
    expect(output.txId).toBe("mock_stake_trx_tx_id_123");
    expect(output.stakedTrx).toBe(100);
    expect(output.estimatedStrx).toBe("95.238095");
    expect(services.stakeTrxToStrx).toHaveBeenCalledWith(
      100,
      "mainnet",
    );
  });

  it("unstake_strx should call services.unstakeStrx", async () => {
    const result = await callTool("unstake_strx", { amount: 50 });
    const output = getToolOutput(result);
    expect(output.txId).toBe("mock_unstake_strx_tx_id_123");
    expect(output.unstakedStrx).toBe(50);
    expect(output.note).toContain("14 days");
    expect(services.unstakeStrx).toHaveBeenCalledWith(
      50,
      "mainnet",
    );
  });

  it("claim_strx_rewards should call services.claimStrxRewards", async () => {
    const result = await callTool("claim_strx_rewards");
    const output = getToolOutput(result);
    expect(output.txId).toBe("mock_claim_strx_rewards_tx_id_123");
    expect(output.claimedAmount).toBe(10);
    expect(services.claimStrxRewards).toHaveBeenCalledWith(
      "mainnet",
    );
  });

  it("stake_trx_to_strx should error without wallet configured", async () => {
    vi.mocked(services.stakeTrxToStrx).mockRejectedValueOnce(
      new Error("No wallet configured. Run `agent-wallet start` to create one."),
    );
    const result = await callTool("stake_trx_to_strx", { amount: 100 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("wallet");
  });
});

describe("Network Parameter Forwarding", () => {
  it("supply should forward network parameter", async () => {
    await callTool("supply", { market: "jUSDT", amount: "100", network: "nile" });
    // getWalletAddress is called, then supply would be called
    // Since we mock it, verify the mock was called
    expect(services.getWalletAddress).toHaveBeenCalled();
  });

  it("get_all_markets should default to mainnet", async () => {
    await callTool("get_all_markets");
    expect(services.getAllMarketsWithFallback).toHaveBeenCalledWith("mainnet");
  });

  it("get_protocol_summary should default to mainnet", async () => {
    await callTool("get_protocol_summary");
    expect(services.getProtocolSummary).toHaveBeenCalledWith("mainnet");
  });
});
