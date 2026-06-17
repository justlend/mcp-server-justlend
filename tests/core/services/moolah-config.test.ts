import { describe, it, expect } from "vitest";
import {
  getMoolahAddresses,
  getMoolahVaultInfo,
  getMoolahApiHost,
} from "../../../src/core/chains.js";

// Pure config validation — no network calls.

describe("Moolah V2 config", () => {
  describe("getMoolahAddresses (mainnet)", () => {
    const m = getMoolahAddresses("mainnet");

    it("exposes all 6 core contract addresses", () => {
      expect(m.moolahProxy).toMatch(/^T[A-Za-z0-9]{33}$/);
      expect(m.trxProviderProxy).toMatch(/^T[A-Za-z0-9]{33}$/);
      expect(m.publicLiquidatorProxy).toMatch(/^T[A-Za-z0-9]{33}$/);
      expect(m.wtrxProxy).toMatch(/^T[A-Za-z0-9]{33}$/);
      expect(m.resilientOracleProxy).toMatch(/^T[A-Za-z0-9]{33}$/);
      expect(m.irmProxy).toMatch(/^T[A-Za-z0-9]{33}$/);
    });

    it("includes TRX, USDT, and USDD vaults", () => {
      expect(Object.keys(m.vaults).sort()).toEqual(["TRX", "USDD", "USDT"]);
    });

    it("TRX vault has empty underlying (native)", () => {
      const v = m.vaults.TRX;
      expect(v.underlying).toBe("");
      expect(v.underlyingSymbol).toBe("TRX");
      expect(v.underlyingDecimals).toBe(6);
    });

    it("USDT vault has the canonical mainnet USDT address", () => {
      expect(m.vaults.USDT.underlying).toBe("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");
      expect(m.vaults.USDT.underlyingDecimals).toBe(6);
    });

    it("USDD vault has 18 decimals", () => {
      expect(m.vaults.USDD.underlyingDecimals).toBe(18);
      expect(m.vaults.USDD.sharesDecimals).toBe(18);
    });

    it("every vault has a Base58 vault address", () => {
      for (const key of Object.keys(m.vaults)) {
        expect(m.vaults[key].address).toMatch(/^T[A-Za-z0-9]{33}$/);
      }
    });
  });

  describe("getMoolahVaultInfo", () => {
    it("resolves 'USDT' on mainnet", () => {
      const v = getMoolahVaultInfo("USDT", "mainnet");
      expect(v.address).toMatch(/^T/);
      expect(v.underlyingSymbol).toBe("USDT");
    });

    it("is case-insensitive for symbol", () => {
      const a = getMoolahVaultInfo("usdt", "mainnet");
      const b = getMoolahVaultInfo("USDT", "mainnet");
      expect(a.address).toBe(b.address);
    });

    it("throws for unknown vault symbol", () => {
      expect(() => getMoolahVaultInfo("FOO", "mainnet")).toThrow();
    });
  });

  describe("getMoolahApiHost", () => {
    it("returns a non-empty https host for mainnet", () => {
      const host = getMoolahApiHost("mainnet");
      expect(host).toMatch(/^https:\/\//);
    });

    it("throws for nile — V2 REST backend is mainnet-only", () => {
      expect(() => getMoolahApiHost("nile")).toThrow(/mainnet/);
    });
  });

  describe("getMoolahAddresses (nile)", () => {
    const m = getMoolahAddresses("nile");

    it("has all core addresses filled (no empty TODOs)", () => {
      expect(m.moolahProxy).toMatch(/^T[A-Za-z0-9]{33}$/);
      expect(m.trxProviderProxy).toMatch(/^T[A-Za-z0-9]{33}$/);
      expect(m.publicLiquidatorProxy).toMatch(/^T[A-Za-z0-9]{33}$/);
      expect(m.wtrxProxy).toMatch(/^T[A-Za-z0-9]{33}$/);
      expect(m.resilientOracleProxy).toMatch(/^T[A-Za-z0-9]{33}$/);
      expect(m.irmProxy).toMatch(/^T[A-Za-z0-9]{33}$/);
    });

    it("has TRX and USDT vaults but NOT USDD (USDD vault is not deployed on nile)", () => {
      expect(Object.keys(m.vaults).sort()).toEqual(["TRX", "USDT"]);
    });

    it("nile USDT uses a different underlying than mainnet", () => {
      const nileUsdt = m.vaults.USDT.underlying;
      expect(nileUsdt).toBe("TPYwAC9Y4uUcT2QH3WPPjqxzJSJWymMoMS");
      // Mainnet USDT is TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t — confirm they differ
      expect(nileUsdt).not.toBe("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");
    });
  });
});
