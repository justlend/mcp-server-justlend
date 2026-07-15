import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the chain client so no network is touched — we drive getTransactionInfo directly.
const getTransactionInfo = vi.fn();
vi.mock("../../../src/core/services/clients.js", () => ({
  getTronWeb: () => ({ trx: { getTransactionInfo: (...a: any[]) => getTransactionInfo(...a) } }),
}));

import { waitForTransaction } from "../../../src/core/services/transactions.js";

describe("waitForTransaction requireSuccess", () => {
  beforeEach(() => getTransactionInfo.mockReset());

  it("returns info on a SUCCESS receipt", async () => {
    getTransactionInfo.mockResolvedValue({ id: "abc", receipt: { result: "SUCCESS" } });
    const info = await waitForTransaction("abc", "nile", { requireSuccess: true });
    expect(info.id).toBe("abc");
  });

  it("throws with the decoded revert reason on a mined-but-reverted receipt", async () => {
    getTransactionInfo.mockResolvedValue({
      id: "abc",
      receipt: { result: "REVERT" },
      resMessage: Buffer.from("boom").toString("hex"),
    });
    await expect(
      waitForTransaction("abc", "nile", { requireSuccess: true }),
    ).rejects.toThrow(/failed on-chain: boom/);
  });

  it("throws with the status when there is no resMessage", async () => {
    getTransactionInfo.mockResolvedValue({ id: "abc", receipt: { result: "OUT_OF_ENERGY" } });
    await expect(
      waitForTransaction("abc", "nile", { requireSuccess: true }),
    ).rejects.toThrow(/failed on-chain: status OUT_OF_ENERGY/);
  });

  it("returns a reverted receipt when requireSuccess is off (default, unchanged behavior)", async () => {
    getTransactionInfo.mockResolvedValue({ id: "abc", receipt: { result: "REVERT" } });
    const info = await waitForTransaction("abc", "nile");
    expect(info.receipt.result).toBe("REVERT");
  });
});
