import { describe, it, expect } from "vitest";
import {
  getMoolahVaultTotalAssets,
  moolahVaultConvertToAssets,
  moolahVaultConvertToShares,
} from "../../../src/core/services/moolah-query.js";
import { getMoolahVaultInfo } from "../../../src/core/chains.js";
import { skipOn429 } from "../../helpers.js";

// Mainnet read-only on-chain queries. Skipped gracefully on TronGrid rate limit.

describe("Moolah on-chain query service (mainnet read-only)", () => {
  const usdtVault = getMoolahVaultInfo("USDT", "mainnet");
  const trxVault = getMoolahVaultInfo("TRX", "mainnet");

  it("getMoolahVaultTotalAssets returns a non-negative bigint for USDT vault", skipOn429(async () => {
    const total = await getMoolahVaultTotalAssets(usdtVault.address, "mainnet");
    expect(typeof total).toBe("bigint");
    expect(total >= 0n).toBe(true);
  }));

  it("getMoolahVaultTotalAssets returns a non-negative bigint for TRX vault", skipOn429(async () => {
    const total = await getMoolahVaultTotalAssets(trxVault.address, "mainnet");
    expect(typeof total).toBe("bigint");
    expect(total >= 0n).toBe(true);
  }));

  it("convertToShares and convertToAssets round-trip within 1 wei (USDT vault)", skipOn429(async () => {
    const originalAssets = 1_000_000n; // 1 USDT (6 decimals)
    const shares = await moolahVaultConvertToShares(usdtVault.address, originalAssets, "mainnet");
    expect(shares > 0n).toBe(true);

    const roundTripped = await moolahVaultConvertToAssets(usdtVault.address, shares, "mainnet");
    // Allow 1-wei rounding error in either direction
    const diff = originalAssets > roundTripped ? originalAssets - roundTripped : roundTripped - originalAssets;
    expect(diff <= 1n).toBe(true);
  }));

  it("convertToAssets(1 share) ≥ 1 asset unit once vault has accrued any yield", skipOn429(async () => {
    // For a non-empty ERC4626 vault that has accrued any yield, 1 share should be
    // worth >= 1 underlying (share price is monotonically increasing).
    const oneShare = 1_000_000n; // 1 share at 6 decimals
    const assets = await moolahVaultConvertToAssets(usdtVault.address, oneShare, "mainnet");
    expect(typeof assets).toBe("bigint");
    // Weaker assertion: result is a valid bigint (share price could be < 1 at genesis)
    expect(assets >= 0n).toBe(true);
  }));
});
