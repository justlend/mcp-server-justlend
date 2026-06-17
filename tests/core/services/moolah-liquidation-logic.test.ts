import { describe, it, expect, vi } from "vitest";

// Mock dependencies so moolahLiquidate input validation runs without touching the chain.
vi.mock("../../../src/core/services/wallet.js", () => ({
  getSigningClient: vi.fn(),
}));
vi.mock("../../../src/core/services/contracts.js", () => ({
  safeSend: vi.fn(),
  readContract: vi.fn(),
}));
vi.mock("../../../src/core/services/moolah-query.js", () => ({
  getMoolahLoanTokenAmountNeed: vi.fn(),
}));

import { moolahLiquidate } from "../../../src/core/services/moolah-liquidation.js";

// A valid Base58 TRON address — moolahLiquidate validates `borrower` before the
// seizedAssets/repaidShares mutual-exclusion check, so a malformed placeholder
// would (correctly) be rejected for the wrong reason.
const VALID_BORROWER = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

describe("moolahLiquidate input validation", () => {
  it("rejects an invalid borrower address", async () => {
    await expect(
      moolahLiquidate({
        marketId: "0x" + "00".repeat(32),
        borrower: "TXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        seizedAssets: "100",
        repaidShares: "0",
      }),
    ).rejects.toThrow(/Invalid TRON borrower address/i);
  });

  it("rejects when both seizedAssets and repaidShares are zero", async () => {
    await expect(
      moolahLiquidate({
        marketId: "0x" + "00".repeat(32),
        borrower: VALID_BORROWER,
        seizedAssets: "0",
        repaidShares: "0",
      }),
    ).rejects.toThrow(/Provide either seizedAssets or repaidShares/i);
  });

  it("rejects when both seizedAssets and repaidShares are non-zero", async () => {
    await expect(
      moolahLiquidate({
        marketId: "0x" + "00".repeat(32),
        borrower: VALID_BORROWER,
        seizedAssets: "100",
        repaidShares: "50",
      }),
    ).rejects.toThrow(/EITHER seizedAssets OR repaidShares/i);
  });
});
