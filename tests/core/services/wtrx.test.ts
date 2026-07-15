import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSafeSend = vi.fn();
const mockTrxBalance = vi.fn();
const mockWtrxBalanceOf = vi.fn();
const mockCheckResourceSufficiency = vi.fn();
const mockIsAddress = vi.fn();

vi.mock("tronweb", () => ({
  TronWeb: {
    isAddress: (a: string) => mockIsAddress(a),
    toSun: (v: any) => String(Math.trunc(Number(v) * 1_000_000)),
    fromSun: (v: any) => String(Number(v) / 1_000_000),
  },
}));

vi.mock("../../../src/core/services/wallet.js", () => ({
  getSigningClient: vi.fn(async () => ({
    defaultAddress: { base58: "TWallet" },
    trx: { getBalance: mockTrxBalance },
    // wtrx unwrap reads balance via tronWeb.contract(WTRX_ABI, addr).methods.balanceOf(...).call()
    contract: vi.fn(() => ({
      methods: {
        balanceOf: vi.fn(() => ({ call: mockWtrxBalanceOf })),
      },
    })),
  })),
}));

vi.mock("../../../src/core/services/contracts.js", () => ({
  safeSend: (...args: any[]) => mockSafeSend(...args),
}));

vi.mock("../../../src/core/services/lending.js", () => ({
  checkResourceSufficiency: (...args: any[]) => mockCheckResourceSufficiency(...args),
}));

vi.mock("../../../src/core/chains.js", () => ({
  getMoolahAddresses: () => ({ wtrxProxy: "TWtrxProxyAddress" }),
}));

import { wrapTrx, unwrapTrx } from "../../../src/core/services/wtrx.js";

describe("wtrx wrap / unwrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAddress.mockReturnValue(true);
    mockSafeSend.mockResolvedValue({ txID: "0xwtrx" });
    mockTrxBalance.mockResolvedValue("1000000000000"); // 1,000,000 TRX
    mockWtrxBalanceOf.mockResolvedValue("1000000000000"); // 1,000,000 WTRX
    mockCheckResourceSufficiency.mockResolvedValue({ energyBurnTRX: "0", bandwidthBurnTRX: "0" });
  });

  it("wrapTrx builds a payable deposit() with the amount as callValue in SUN", async () => {
    const result = await wrapTrx("1.5", "mainnet");

    expect(mockSafeSend).toHaveBeenCalledTimes(1);
    const [params, network] = mockSafeSend.mock.calls[0];
    expect(params.address).toBe("TWtrxProxyAddress");
    expect(params.functionName).toBe("deposit");
    expect(params.callValue).toBe("1500000"); // 1.5 TRX -> SUN (6 dp)
    expect(params.args).toBeUndefined(); // native-TRX payable call, no ABI args
    expect(network).toBe("mainnet");
    expect(result.txID).toBe("0xwtrx");
    expect(result.wtrx).toBe("1.5"); // 1:1
  });

  it("wrapTrx rejects an insufficient TRX balance before broadcasting", async () => {
    mockTrxBalance.mockResolvedValueOnce("1000000"); // 1 TRX, need 1.5
    await expect(wrapTrx("1.5", "mainnet")).rejects.toThrow(/Insufficient TRX balance/);
    expect(mockSafeSend).not.toHaveBeenCalled();
  });

  it("wrapTrx rejects zero / negative / over-precision amounts before any network call", async () => {
    await expect(wrapTrx("0", "mainnet")).rejects.toThrow(/greater than 0/);
    await expect(wrapTrx("-1", "mainnet")).rejects.toThrow(/Invalid numeric value/);
    await expect(wrapTrx("1.1234567", "mainnet")).rejects.toThrow(/Too many decimal places/); // 7 dp > 6
    expect(mockSafeSend).not.toHaveBeenCalled();
  });

  it("unwrapTrx builds withdraw(uint256) with the amount in SUN and no callValue", async () => {
    const result = await unwrapTrx("2.25", "mainnet");

    expect(mockSafeSend).toHaveBeenCalledTimes(1);
    const [params] = mockSafeSend.mock.calls[0];
    expect(params.address).toBe("TWtrxProxyAddress");
    expect(params.functionName).toBe("withdraw");
    expect(params.args).toEqual(["2250000"]); // 2.25 WTRX -> SUN
    expect(params.callValue).toBeUndefined(); // withdraw is non-payable
    expect(result.trx).toBe("2.25"); // 1:1
  });

  it("unwrapTrx rejects an insufficient WTRX balance before broadcasting", async () => {
    mockWtrxBalanceOf.mockResolvedValueOnce("1000000"); // 1 WTRX, need 2.25
    await expect(unwrapTrx("2.25", "mainnet")).rejects.toThrow(/Insufficient WTRX balance/);
    expect(mockSafeSend).not.toHaveBeenCalled();
  });

  it("unwrapTrx rejects a zero amount before broadcasting", async () => {
    await expect(unwrapTrx("0", "mainnet")).rejects.toThrow(/greater than 0/);
    expect(mockSafeSend).not.toHaveBeenCalled();
  });
});
