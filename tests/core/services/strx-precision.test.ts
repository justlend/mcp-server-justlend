import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDashboardData = vi.fn();
const mockBalanceOf = vi.fn();
const mockViewBalanceOfUnderlying = vi.fn();
const mockExchangeRate = vi.fn();
const mockTotalSupply = vi.fn();
const mockTotalUnfreezable = vi.fn();
const mockUnfreezeDelayDays = vi.fn();
const mockTrxBalance = vi.fn();
const mockSafeSend = vi.fn();
const mockCheckResourceSufficiency = vi.fn();

const mockContract = {
  methods: {
    balanceOf: vi.fn(() => ({ call: mockBalanceOf })),
    viewBalanceOfUnderlying: vi.fn(() => ({ call: mockViewBalanceOfUnderlying })),
    exchangeRate: vi.fn(() => ({ call: mockExchangeRate })),
    totalSupply: vi.fn(() => ({ call: mockTotalSupply })),
    totalUnfreezable: vi.fn(() => ({ call: mockTotalUnfreezable })),
    getUnfreezeDelayDays: vi.fn(() => ({ call: mockUnfreezeDelayDays })),
  },
};

vi.mock("../../../src/core/chains.js", () => ({
  getApiHost: vi.fn(() => "https://api.example"),
  getJustLendAddresses: vi.fn(() => ({ strx: { proxy: "TStrxProxy111111111111111111111111" } })),
}));

vi.mock("../../../src/core/services/http.js", () => ({
  fetchWithTimeout: vi.fn(async () => ({
    json: async () => mockDashboardData(),
  })),
}));

vi.mock("../../../src/core/services/clients.js", () => ({
  getTronWeb: vi.fn(() => ({
    contract: vi.fn(() => mockContract),
  })),
}));

vi.mock("../../../src/core/services/wallet.js", () => ({
  getSigningClient: vi.fn(async () => ({
    defaultAddress: { base58: "TWallet111111111111111111111111111" },
    trx: { getBalance: mockTrxBalance },
    contract: vi.fn(() => mockContract),
    toBigNumber: (value: string | number) => ({
      times: (scale: number) => ({
        integerValue: () => ({ toString: () => String(Math.trunc(Number(value) * scale)) }),
      }),
    }),
  })),
}));

vi.mock("../../../src/core/services/contracts.js", () => ({
  safeSend: (...args: any[]) => mockSafeSend(...args),
}));

vi.mock("../../../src/core/services/lending.js", () => ({
  checkResourceSufficiency: (...args: any[]) => mockCheckResourceSufficiency(...args),
}));

import {
  getStrxBalance,
  getStrxDashboard,
  getStrxStakeAccount,
  stakeTrxToStrx,
} from "../../../src/core/services/strx-staking.js";
import { cacheInvalidatePrefix } from "../../../src/core/services/cache.js";

describe("sTRX precision-safe formatting and staking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cacheInvalidatePrefix("strx:");
    mockSafeSend.mockResolvedValue({ txID: "0xstake" });
    mockTrxBalance.mockResolvedValue("100000000000000000000");
    mockCheckResourceSufficiency.mockResolvedValue({ energyBurnTRX: "0", bandwidthBurnTRX: "0" });
    mockDashboardData.mockReturnValue({ code: 1, message: "force on-chain fallback" });
    mockExchangeRate.mockResolvedValue("1234567890123456789");
    mockTotalSupply.mockResolvedValue("900719925474099312345678901234567890");
    mockTotalUnfreezable.mockResolvedValue("9007199254740993123456789");
    mockUnfreezeDelayDays.mockResolvedValue("14");
    mockBalanceOf.mockResolvedValue("900719925474099312345678901234567890");
    mockViewBalanceOfUnderlying.mockResolvedValue("9007199254740993123456789");
  });

  it("formats on-chain dashboard values without Number downcasts", async () => {
    const dashboard = await getStrxDashboard("mainnet");

    expect(dashboard.totalSupply).toBe("900719925474099312.34567890123456789");
    expect(dashboard.totalUnfreezable).toBe("9007199254740993123.456789");
    expect(dashboard.sTrx1Trx).toBe("0.810000");
    expect(dashboard.trx1sTrx).toBe("1.234567");
  });

  it("formats account and balance raw values without precision loss", async () => {
    const account = await getStrxStakeAccount("T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb", "mainnet");
    const balance = await getStrxBalance("T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb", "mainnet");

    expect(account.accountSupply).toBe("9007199254740993123.456789");
    expect(account.strxBalance).toBe("900719925474099312.34567890123456789");
    expect(balance.formatted).toBe("900719925474099312.345678");
  });

  it("stakes using string input and exact Sun conversion", async () => {
    const result = await stakeTrxToStrx("9007199254.740993", "nile");

    expect(mockSafeSend).toHaveBeenCalledWith(expect.objectContaining({
      functionName: "deposit",
      callValue: "9007199254740993",
    }), "nile");
    expect(result.stakedTrx).toBe("9007199254.740993");
  });
});
