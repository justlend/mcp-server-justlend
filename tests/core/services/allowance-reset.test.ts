import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the broadcast + confirmation deps so we can assert call order/args without a network.
const safeSend = vi.fn();
const waitForTransaction = vi.fn();

vi.mock("../../../src/core/services/contracts.js", () => ({
  safeSend: (...args: any[]) => safeSend(...args),
}));
vi.mock("../../../src/core/services/transactions.js", () => ({
  waitForTransaction: (...args: any[]) => waitForTransaction(...args),
}));

import { requiresAllowanceReset, approveWithReset } from "../../../src/core/services/allowance.js";

const USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDJ = "TMwFHYXLJaRUPeW6421aqXL4ZEzPRFGkGT";
const USDC = "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8";
const WTRX = "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR"; // not a reset-list token
const SPENDER = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";

describe("requiresAllowanceReset", () => {
  it("matches USDT/USDC/USDJ by contract address", () => {
    expect(requiresAllowanceReset(USDT)).toBe(true);
    expect(requiresAllowanceReset(USDJ)).toBe(true);
    expect(requiresAllowanceReset(USDC)).toBe(true);
  });
  it("matches by symbol (case-insensitive) as a fallback", () => {
    expect(requiresAllowanceReset(WTRX, "usdt")).toBe(true);
    expect(requiresAllowanceReset(undefined, "USDC")).toBe(true);
    expect(requiresAllowanceReset(undefined, " usdj ")).toBe(true);
  });
  it("returns false for non-reset tokens/symbols", () => {
    expect(requiresAllowanceReset(WTRX)).toBe(false);
    expect(requiresAllowanceReset(WTRX, "WTRX")).toBe(false);
    expect(requiresAllowanceReset(WTRX, "TRX")).toBe(false);
    expect(requiresAllowanceReset()).toBe(false);
  });
});

describe("approveWithReset", () => {
  beforeEach(() => {
    safeSend.mockReset();
    waitForTransaction.mockReset();
    waitForTransaction.mockResolvedValue({ id: "confirmed" });
    let n = 0;
    safeSend.mockImplementation(async (params: any) => ({ txID: `tx${++n}:${params.args[1]}` }));
  });

  it("USDT + non-zero allowance + non-zero target: reset(0) first, wait, then approve(target)", async () => {
    const res = await approveWithReset({
      tokenAddress: USDT, spender: SPENDER, approveRaw: "100", currentAllowance: 50n, symbol: "USDT", network: "mainnet",
    });
    expect(safeSend).toHaveBeenCalledTimes(2);
    expect(safeSend.mock.calls[0][0].args).toEqual([SPENDER, "0"]);   // reset first
    expect(safeSend.mock.calls[1][0].args).toEqual([SPENDER, "100"]); // then target
    expect(waitForTransaction).toHaveBeenCalledTimes(1);
    expect(waitForTransaction.mock.calls[0][0]).toBe(res.resetTxID);  // waited on the reset tx
    expect(res.resetTxID).toBeDefined();
    expect(res.txID).toContain("100");
  });

  it("USDT + zero allowance: single approve, no reset/wait", async () => {
    const res = await approveWithReset({
      tokenAddress: USDT, spender: SPENDER, approveRaw: "100", currentAllowance: 0n, network: "mainnet",
    });
    expect(safeSend).toHaveBeenCalledTimes(1);
    expect(safeSend.mock.calls[0][0].args).toEqual([SPENDER, "100"]);
    expect(waitForTransaction).not.toHaveBeenCalled();
    expect(res.resetTxID).toBeUndefined();
  });

  it("USDT revoke (target 0) + non-zero allowance: single approve(0), no pre-reset", async () => {
    await approveWithReset({
      tokenAddress: USDT, spender: SPENDER, approveRaw: "0", currentAllowance: 50n, network: "mainnet",
    });
    expect(safeSend).toHaveBeenCalledTimes(1);
    expect(safeSend.mock.calls[0][0].args).toEqual([SPENDER, "0"]);
    expect(waitForTransaction).not.toHaveBeenCalled();
  });

  it("non-reset token + non-zero allowance: single approve, no reset", async () => {
    await approveWithReset({
      tokenAddress: WTRX, spender: SPENDER, approveRaw: "100", currentAllowance: 50n, network: "mainnet",
    });
    expect(safeSend).toHaveBeenCalledTimes(1);
    expect(waitForTransaction).not.toHaveBeenCalled();
  });
});
