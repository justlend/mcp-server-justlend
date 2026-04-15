import { beforeEach, describe, expect, it, vi } from "vitest";

const mockBalanceOf = vi.fn();
const mockDecimals = vi.fn();
const mockSymbol = vi.fn();
const mockSafeSend = vi.fn();
const mockTrxBalance = vi.fn();
const mockSendTrx = vi.fn();
const mockCheckResourceSufficiency = vi.fn();

vi.mock("../../../src/core/services/wallet.js", () => ({
  getSigningClient: vi.fn(async () => ({
    defaultAddress: { base58: "TWallet" },
    trx: {
      getBalance: mockTrxBalance,
    },
    transactionBuilder: {
      sendTrx: mockSendTrx,
    },
    contract: vi.fn(() => ({
      at: vi.fn(async () => ({
        methods: {
          balanceOf: vi.fn(() => ({ call: mockBalanceOf })),
          decimals: vi.fn(() => ({ call: mockDecimals })),
          symbol: vi.fn(() => ({ call: mockSymbol })),
        },
      })),
    })),
  })),
  signTransactionWithWallet: vi.fn(),
}));

vi.mock("../../../src/core/services/contracts.js", () => ({
  safeSend: (...args: any[]) => mockSafeSend(...args),
}));

vi.mock("../../../src/core/services/lending.js", () => ({
  checkResourceSufficiency: (...args: any[]) => mockCheckResourceSufficiency(...args),
}));

import { transferTRC20, transferTRX } from "../../../src/core/services/transfer.js";

describe("transfer precision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSafeSend.mockResolvedValue({ txID: "0xtransfer" });
    mockTrxBalance.mockResolvedValue("999999999999999999999999");
    mockCheckResourceSufficiency.mockResolvedValue({
      energyBurnTRX: "0",
      bandwidthBurnTRX: "0",
    });
  });

  it("returns formatted transfer amounts without precision loss", async () => {
    mockBalanceOf.mockResolvedValueOnce("900719925474099312345678901234");
    mockDecimals.mockResolvedValueOnce("6");
    mockSymbol.mockResolvedValueOnce("USDT");
    mockSymbol.mockResolvedValueOnce("USDT");
    mockDecimals.mockResolvedValueOnce("6");

    const result = await transferTRC20("TToken", "TRecipient", "900719925474099312345678901234", "mainnet");

    expect(result).toEqual({
      txHash: "0xtransfer",
      amount: {
        raw: "900719925474099312345678901234",
        formatted: "900719925474099312345678.901234",
      },
      token: {
        symbol: "USDT",
        decimals: 6,
      },
    });
  });

  it("keeps insufficient-balance errors exact for large values", async () => {
    mockBalanceOf.mockResolvedValueOnce("900719925474099312345678900000");
    mockSymbol.mockResolvedValueOnce("USDT");
    mockDecimals.mockResolvedValueOnce("6");

    await expect(
      transferTRC20("TToken", "TRecipient", "900719925474099312345678901234", "mainnet"),
    ).rejects.toThrow(
      "Insufficient USDT balance. Have 900719925474099312345678.9, need 900719925474099312345678.901234",
    );
  });

  it("rejects TRX transfers that exceed TronWeb's safe numeric limit", async () => {
    await expect(
      transferTRX("TRecipient", "10000000000", "mainnet"),
    ).rejects.toThrow("TRX transfer amount exceeds the safe SDK limit");
    expect(mockSendTrx).not.toHaveBeenCalled();
  });
});
