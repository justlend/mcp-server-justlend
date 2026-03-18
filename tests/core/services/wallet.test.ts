/**
 * Unit tests for wallet.ts — pure logic tested without real keys.
 * Write-operation tests (signMessage, signTypedData) are skipped unless
 * TRON_PRIVATE_KEY is set in the environment.
 */
import { describe, it, expect } from "vitest";
import {
  getConfiguredWallet,
  getConfiguredPrivateKey,
  getWalletAddress,
  getWalletAddressFromKey,
} from "../../../src/core/services/wallet.js";

const HAS_KEY = Boolean(process.env.TRON_PRIVATE_KEY || process.env.TRON_MNEMONIC);

describe("getWalletAddressFromKey alias", () => {
  it("should be the same function as getWalletAddress", () => {
    expect(getWalletAddressFromKey).toBe(getWalletAddress);
  });
});

describe("getConfiguredWallet (no env)", () => {
  it("throws when neither TRON_PRIVATE_KEY nor TRON_MNEMONIC is set", () => {
    if (HAS_KEY) {
      console.error("Skipping — env key is set");
      return;
    }
    expect(() => getConfiguredWallet()).toThrow();
  });
});

describe("getConfiguredWallet (with env)", () => {
  it.skipIf(!HAS_KEY)("returns a wallet with privateKey and address", () => {
    const wallet = getConfiguredWallet();
    expect(wallet.privateKey).toBeTruthy();
    expect(wallet.address).toBeTruthy();
    expect(wallet.address).toMatch(/^T/); // TRON addresses start with T
  });

  it.skipIf(!HAS_KEY)("getConfiguredPrivateKey returns a non-empty string", () => {
    const key = getConfiguredPrivateKey();
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
    // Should not have 0x prefix
    expect(key.startsWith("0x")).toBe(false);
  });

  it.skipIf(!HAS_KEY)("getWalletAddress returns a valid TRON address", () => {
    const address = getWalletAddress();
    expect(address).toMatch(/^T/);
    expect(address.length).toBeGreaterThanOrEqual(34);
  });
});
