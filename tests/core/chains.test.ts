import { describe, it, expect } from "vitest";
import {
  TronNetwork,
  NETWORKS,
  JUSTLEND_ADDRESSES,
  getNetworkConfig,
  getJustLendAddresses,
  getSupportedNetworks,
  getJTokenInfo,
  getAllJTokens,
} from "../../src/core/chains.js";

// ============================================================================
// Network Configuration
// ============================================================================

describe("Network Configuration", () => {
  it("should define mainnet and nile networks", () => {
    expect(TronNetwork.Mainnet).toBe("mainnet");
    expect(TronNetwork.Nile).toBe("nile");
  });

  it("should have valid mainnet config", () => {
    const config = NETWORKS[TronNetwork.Mainnet];
    expect(config.name).toBe("Mainnet");
    expect(config.fullNode).toContain("trongrid.io");
    expect(config.solidityNode).toBeDefined();
    expect(config.eventServer).toBeDefined();
    expect(config.explorer).toContain("tronscan.org");
  });

  it("should have valid nile config", () => {
    const config = NETWORKS[TronNetwork.Nile];
    expect(config.name).toBe("Nile Testnet");
    expect(config.fullNode).toContain("nile.trongrid.io");
    expect(config.explorer).toContain("nile.tronscan.org");
  });
});

// ============================================================================
// getNetworkConfig
// ============================================================================

describe("getNetworkConfig", () => {
  it("should return mainnet config for 'mainnet'", () => {
    const config = getNetworkConfig("mainnet");
    expect(config.name).toBe("Mainnet");
  });

  it("should accept 'tron' and 'trx' as mainnet aliases", () => {
    expect(getNetworkConfig("tron").name).toBe("Mainnet");
    expect(getNetworkConfig("trx").name).toBe("Mainnet");
  });

  it("should return nile config for 'nile' and 'testnet'", () => {
    expect(getNetworkConfig("nile").name).toBe("Nile Testnet");
    expect(getNetworkConfig("testnet").name).toBe("Nile Testnet");
  });

  it("should be case-insensitive", () => {
    expect(getNetworkConfig("MAINNET").name).toBe("Mainnet");
    expect(getNetworkConfig("Nile").name).toBe("Nile Testnet");
  });

  it("should use mainnet as default", () => {
    const config = getNetworkConfig();
    expect(config.name).toBe("Mainnet");
  });

  it("should throw for unsupported network", () => {
    expect(() => getNetworkConfig("ethereum")).toThrow("Unsupported network");
    expect(() => getNetworkConfig("unknown")).toThrow("Unsupported network");
  });
});

// ============================================================================
// getJustLendAddresses
// ============================================================================

describe("getJustLendAddresses", () => {
  it("should return mainnet addresses with comptroller", () => {
    const addresses = getJustLendAddresses("mainnet");
    expect(addresses.comptroller).toBeDefined();
    expect(addresses.comptroller).toMatch(/^T/); // TRON addresses start with T
  });

  it("should include priceOracle, lens, maximillion on mainnet", () => {
    const addresses = getJustLendAddresses("mainnet");
    expect(addresses.priceOracle).toMatch(/^T/);
    expect(addresses.lens).toMatch(/^T/);
    expect(addresses.maximillion).toMatch(/^T/);
  });

  it("should treat priceOracle/lens/maximillion as optional on nile (none deployed there)", () => {
    const addresses = getJustLendAddresses("nile");
    expect(addresses.priceOracle).toBe(""); // dynamically resolved via comptroller.oracle()
    expect(addresses.lens).toBeUndefined();
    expect(addresses.maximillion).toBeUndefined();
  });

  it("should have jToken entries", () => {
    const addresses = getJustLendAddresses("mainnet");
    expect(Object.keys(addresses.jTokens).length).toBeGreaterThan(0);
    expect(addresses.jTokens["jTRX"]).toBeDefined();
    expect(addresses.jTokens["jUSDT"]).toBeDefined();
  });

  it("should include sTRX and energy rental contract addresses", () => {
    const addresses = getJustLendAddresses("mainnet");
    expect(addresses.strx).toBeDefined();
    expect(addresses.strx.proxy).toMatch(/^T/);
    expect(addresses.strx.market).toMatch(/^T/);
    expect(addresses.energyRateModel).toMatch(/^T/);
  });

  it("should throw for unsupported network", () => {
    expect(() => getJustLendAddresses("bsc")).toThrow("Unsupported network");
  });
});

// ============================================================================
// getSupportedNetworks
// ============================================================================

describe("getSupportedNetworks", () => {
  it("should return mainnet and nile", () => {
    const networks = getSupportedNetworks();
    expect(networks).toContain("mainnet");
    expect(networks).toContain("nile");
    expect(networks).toHaveLength(2);
  });
});

// ============================================================================
// getJTokenInfo
// ============================================================================

describe("getJTokenInfo", () => {
  it("should find jToken by symbol", () => {
    const info = getJTokenInfo("jTRX");
    expect(info).toBeDefined();
    expect(info!.symbol).toBe("jTRX");
    expect(info!.underlyingSymbol).toBe("TRX");
    expect(info!.underlying).toBe(""); // native TRX
  });

  it("should find jUSDT with correct details", () => {
    const info = getJTokenInfo("jUSDT");
    expect(info).toBeDefined();
    expect(info!.symbol).toBe("jUSDT");
    expect(info!.underlyingSymbol).toBe("USDT");
    expect(info!.underlying).toBeTruthy(); // has underlying TRC20 address
    expect(info!.decimals).toBe(8);
    expect(info!.underlyingDecimals).toBe(6);
  });

  it("should find jToken by address (case-insensitive)", () => {
    const addresses = getJustLendAddresses("mainnet");
    const jUSDTAddress = addresses.jTokens["jUSDT"].address;
    const info = getJTokenInfo(jUSDTAddress);
    expect(info).toBeDefined();
    expect(info!.symbol).toBe("jUSDT");
  });

  it("should return undefined for unknown symbol", () => {
    const info = getJTokenInfo("jDOGE");
    expect(info).toBeUndefined();
  });

  it("should return undefined for unknown address", () => {
    const info = getJTokenInfo("TUnknownAddressXXXXXXXXXXXXXXXXXX");
    expect(info).toBeUndefined();
  });
});

// ============================================================================
// getAllJTokens
// ============================================================================

describe("getAllJTokens", () => {
  it("should return all mainnet jTokens", () => {
    const tokens = getAllJTokens("mainnet");
    expect(tokens.length).toBeGreaterThan(0);
    const symbols = tokens.map((t) => t.symbol);
    expect(symbols).toContain("jTRX");
    expect(symbols).toContain("jUSDT");
  });

  it("each jToken should have required fields", () => {
    const tokens = getAllJTokens("mainnet");
    for (const token of tokens) {
      expect(token.address).toMatch(/^T/);
      expect(token.symbol).toMatch(/^j/);
      expect(token.underlyingSymbol).toBeDefined();
      expect(typeof token.decimals).toBe("number");
      expect(typeof token.underlyingDecimals).toBe("number");
    }
  });

  it("should return jTokens for nile testnet", () => {
    const tokens = getAllJTokens("nile");
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) {
      expect(token.address).toMatch(/^T/);
      expect(token.symbol).toMatch(/^j/);
    }
  });
});

// ============================================================================
// JustLend Addresses Data Integrity
// ============================================================================

describe("JustLend Addresses Data Integrity", () => {
  const mainnet = JUSTLEND_ADDRESSES[TronNetwork.Mainnet];

  it("jTRX should have empty underlying (native TRX)", () => {
    expect(mainnet.jTokens["jTRX"].underlying).toBe("");
  });

  it("TRC20 jTokens should have non-empty underlying", () => {
    const trc20Markets = ["jUSDT", "jSUN", "jWIN", "jBTC", "jETH", "jUSDC", "jTUSD"];
    for (const symbol of trc20Markets) {
      const token = mainnet.jTokens[symbol];
      if (token) {
        expect(token.underlying).toBeTruthy();
        expect(token.underlying).toMatch(/^T/);
      }
    }
  });

  it("all jToken decimals should be 8", () => {
    for (const token of Object.values(mainnet.jTokens)) {
      expect(token.decimals).toBe(8);
    }
  });

  it("underlying decimals should be valid (6 or 18)", () => {
    for (const token of Object.values(mainnet.jTokens)) {
      expect([6, 8, 18]).toContain(token.underlyingDecimals);
    }
  });
});
