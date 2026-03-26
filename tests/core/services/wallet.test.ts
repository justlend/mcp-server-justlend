/**
 * Unit tests for wallet.ts — agent-wallet integration.
 * Tests module exports and function signatures.
 * Actual wallet operations require agent-wallet to be configured.
 */
import { describe, it, expect } from "vitest";
import {
  autoInitWallet,
  importWallet,
  getAgentWallet,
  getWalletAddress,
  getWalletAddressFromKey,
  getSigningClient,
  signTransactionWithWallet,
  signMessage,
  signTypedData,
  checkWalletStatus,
  listWallets,
  setActiveWallet,
} from "../../../src/core/services/wallet.js";

describe("wallet module exports", () => {
  it("autoInitWallet is a function", () => {
    expect(typeof autoInitWallet).toBe("function");
  });

  it("importWallet is a function", () => {
    expect(typeof importWallet).toBe("function");
  });

  it("getAgentWallet is a function", () => {
    expect(typeof getAgentWallet).toBe("function");
  });

  it("getWalletAddress is a function", () => {
    expect(typeof getWalletAddress).toBe("function");
  });

  it("getSigningClient is a function", () => {
    expect(typeof getSigningClient).toBe("function");
  });

  it("signTransactionWithWallet is a function", () => {
    expect(typeof signTransactionWithWallet).toBe("function");
  });

  it("signMessage is a function", () => {
    expect(typeof signMessage).toBe("function");
  });

  it("signTypedData is a function", () => {
    expect(typeof signTypedData).toBe("function");
  });

  it("checkWalletStatus is a function", () => {
    expect(typeof checkWalletStatus).toBe("function");
  });

  it("listWallets is a function", () => {
    expect(typeof listWallets).toBe("function");
  });

  it("setActiveWallet is a function", () => {
    expect(typeof setActiveWallet).toBe("function");
  });
});

describe("getWalletAddressFromKey alias", () => {
  it("should be the same function as getWalletAddress", () => {
    expect(getWalletAddressFromKey).toBe(getWalletAddress);
  });
});
