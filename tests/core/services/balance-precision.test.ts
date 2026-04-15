import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetBalance = vi.fn();
const mockBalanceOf = vi.fn();
const mockDecimals = vi.fn();
const mockSymbol = vi.fn();

vi.mock("../../../src/core/services/clients.js", () => ({
  getTronWeb: vi.fn(() => ({
    trx: {
      getBalance: mockGetBalance,
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
}));

import { getTRXBalance, getTRC20Balance } from "../../../src/core/services/balance.js";

describe("balance precision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("formats large TRX balances without precision loss", async () => {
    mockGetBalance.mockResolvedValueOnce("900719925474099312345678");

    const result = await getTRXBalance("TTestAddress", "mainnet");

    expect(result.wei).toBe(900719925474099312345678n);
    expect(result.ether).toBe("900719925474099312.345678");
    expect(result.formatted).toBe("900719925474099312.345678");
  });

  it("formats large TRC20 balances without precision loss", async () => {
    mockBalanceOf.mockResolvedValueOnce("900719925474099312345678901234");
    mockDecimals.mockResolvedValueOnce("6");
    mockSymbol.mockResolvedValueOnce("USDT");

    const result = await getTRC20Balance("TToken", "TWallet", "mainnet");

    expect(result.raw).toBe(900719925474099312345678901234n);
    expect(result.formatted).toBe("900719925474099312345678.901234");
    expect(result.token).toEqual({
      symbol: "USDT",
      decimals: 6,
      address: "TToken",
    });
  });
});
