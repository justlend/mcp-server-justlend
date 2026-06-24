import { describe, it, expect, vi } from "vitest";

// Mock chain deps so the input-validation guards run without touching the network.
// The "requires explicit amount" and "invalid address" guards all throw BEFORE any
// signing-client / broadcast call, so these mocks should never actually be invoked.
vi.mock("../../../src/core/services/wallet.js", () => ({
  getSigningClient: vi.fn(async () => {
    throw new Error("getSigningClient should not be reached when input validation fails");
  }),
}));
vi.mock("../../../src/core/services/contracts.js", () => ({
  safeSend: vi.fn(),
  readContract: vi.fn(),
}));

import { approveMoolahVault } from "../../../src/core/services/moolah-vault.js";
import { approveMoolahProxy } from "../../../src/core/services/moolah-market.js";
import { approveLiquidatorToken } from "../../../src/core/services/moolah-liquidation.js";

// A valid Base58 TRON address (USDT mainnet contract) for the token-address arg.
const VALID_TOKEN = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

describe("Moolah approve guards — no silent unlimited approval", () => {
  it("approveMoolahVault throws when amount is omitted (no default 'max')", async () => {
    await expect(
      approveMoolahVault({ vaultSymbol: "USDT", network: "mainnet" }),
    ).rejects.toThrow(/requires an explicit amount/i);
  });

  it("approveMoolahProxy throws when amount is omitted", async () => {
    await expect(
      approveMoolahProxy({ tokenAddress: VALID_TOKEN, tokenSymbol: "USDT", tokenDecimals: 6, network: "mainnet" }),
    ).rejects.toThrow(/requires an explicit amount/i);
  });

  it("approveLiquidatorToken throws when amount is omitted", async () => {
    await expect(
      approveLiquidatorToken({ tokenAddress: VALID_TOKEN, tokenSymbol: "USDT", tokenDecimals: 6, network: "mainnet" }),
    ).rejects.toThrow(/requires an explicit amount/i);
  });

  it("approveMoolahProxy rejects an invalid token address", async () => {
    await expect(
      approveMoolahProxy({ tokenAddress: "TXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", tokenSymbol: "USDT", tokenDecimals: 6, amount: "100", network: "mainnet" }),
    ).rejects.toThrow(/Invalid TRON token address/i);
  });

  it("approveLiquidatorToken rejects an invalid token address", async () => {
    await expect(
      approveLiquidatorToken({ tokenAddress: "TXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", tokenSymbol: "USDT", tokenDecimals: 6, amount: "100", network: "mainnet" }),
    ).rejects.toThrow(/Invalid TRON token address/i);
  });

  // Service-layer defense in depth: even when the schema is bypassed (direct call),
  // a non-integer / out-of-range tokenDecimals must be rejected before parseUnits
  // scales the amount — otherwise a wrong decimals value silently inflates the approval.
  it("approveMoolahProxy rejects non-integer tokenDecimals before scaling", async () => {
    await expect(
      approveMoolahProxy({ tokenAddress: VALID_TOKEN, tokenSymbol: "USDT", tokenDecimals: 2.5, amount: "100", network: "mainnet" }),
    ).rejects.toThrow(/Invalid USDT decimals/i);
  });

  it("approveLiquidatorToken rejects out-of-range tokenDecimals before scaling", async () => {
    await expect(
      approveLiquidatorToken({ tokenAddress: VALID_TOKEN, tokenSymbol: "USDT", tokenDecimals: 99, amount: "100", network: "mainnet" }),
    ).rejects.toThrow(/Invalid USDT decimals/i);
  });
});
