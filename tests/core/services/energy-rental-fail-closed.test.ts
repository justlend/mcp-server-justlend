/** Offline regressions: no real RPC, wallet signing or broadcasts. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/core/services/clients.js", () => ({ getTronWeb: vi.fn() }));
vi.mock("../../../src/core/services/wallet.js", () => ({ getSigningClient: vi.fn() }));
vi.mock("../../../src/core/services/contracts.js", () => ({ safeSend: vi.fn() }));
vi.mock("../../../src/core/services/transactions.js", () => ({ waitForTransaction: vi.fn() }));
vi.mock("../../../src/core/services/lending.js", () => ({ checkResourceSufficiency: vi.fn() }));

import { getTronWeb } from "../../../src/core/services/clients.js";
import { getSigningClient } from "../../../src/core/services/wallet.js";
import { safeSend } from "../../../src/core/services/contracts.js";
import { checkResourceSufficiency } from "../../../src/core/services/lending.js";
import {
  calculateRentalPrice, calculateRenewalPrice, getEnergyRentalParams,
  getEnergyRentalDashboard, getRentalRate, getRentInfo, rentEnergy, returnEnergyRental,
} from "../../../src/core/services/energy-rental.js";

const ADDRESS = "TU3kjFuhtEo42tsCBtfYUAZxoqQ4yuSLQ5";
const word = (value: bigint | number) => BigInt(value).toString(16).padStart(64, "0");
const response = (...values: (bigint | number)[]) => ({
  result: { result: true }, constant_result: [values.map(word).join("")],
});
const params = ["liquidateThreshold()", "feeRatio()", "minFee()", "totalDelegatedOfType(uint256)",
  "totalFrozenOfType(uint256)", "maxRentableOfType(uint256)", "rentPaused(uint256)", "usageChargeRatio()"];
const rates = ["_rentalRate(uint256,uint256)", "_stableRate(uint256)"];
let replies: Record<string, unknown>;
let rpc: ReturnType<typeof vi.fn>;
let resources: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;
let balance: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  replies = {
    "liquidateThreshold()": response(3600), "feeRatio()": response(80_000_000_000_000n),
    "minFee()": response(20_000_000), "totalDelegatedOfType(uint256)": response(100_000_000),
    "totalFrozenOfType(uint256)": response(200_000_000),
    "maxRentableOfType(uint256)": response(10_000_000_000_000n),
    "rentPaused(uint256)": response(0), "rentPaused()": response(0),
    "usageChargeRatio()": response(500_000_000_000_000_000n),
    "_rentalRate(uint256,uint256)": response(1_000_000_000_000n),
    "_stableRate(uint256)": response(2_000_000_000_000n),
    "getRentInfo(address,address,uint256)": response(0, 0, 0),
    "rentals(address,address,uint256)": response(0, 0, 0),
  };
  rpc = vi.fn(async (_address, selector: string) => {
    if (replies[selector] instanceof Error) throw replies[selector];
    return replies[selector] ?? { result: { result: false }, constant_result: [] };
  });
  resources = vi.fn(async () => ({ TotalEnergyLimit: 90_000_000_000, TotalEnergyWeight: 30_000_000 }));
  balance = vi.fn(async () => 1_000_000_000);
  const client = {
    defaultAddress: { base58: ADDRESS }, transactionBuilder: { triggerSmartContract: rpc },
    trx: { getAccountResources: resources, getBalance: balance },
  };
  vi.mocked(getTronWeb).mockReturnValue(client as any);
  vi.mocked(getSigningClient).mockResolvedValue(client as any);
  vi.mocked(checkResourceSufficiency).mockResolvedValue({ energyBurnTRX: "0", bandwidthBurnTRX: "0" } as any);
  vi.mocked(safeSend).mockResolvedValue({ txID: "mock-rental-tx" } as any);
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: {
    energyStakePerTrx: 3000, exchangeRate: "1000000000000000000",
  } }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("required rental inputs", () => {
  it("reads real values rather than the former defaults, with the Mainnet pause selector", async () => {
    const result = await getEnergyRentalParams();
    expect(result).toMatchObject({ liquidateThreshold: 3600, feeRatio: 0.00008, minFee: 20, rentPaused: false });
    expect(rpc.mock.calls.map(call => call[1])).toEqual(params);
  });

  it.each(params)("rejects missing %s instead of inventing a quote parameter", async selector => {
    replies[selector] = { result: { result: true }, constant_result: [] };
    await expect(getEnergyRentalParams()).rejects.toThrow("cannot verify");
  });

  it.each([
    { result: { result: false }, constant_result: [word(3600)] },
    { result: {}, constant_result: [word(3600)] },
    { result: { result: true }, constant_result: ["01"] },
    { result: { result: true }, constant_result: ["z".repeat(64)] },
    { result: { result: true }, constant_result: [word(1) + "a"] },
  ])("rejects failed or malformed constant results %#", async value => {
    replies["liquidateThreshold()"] = value;
    await expect(getEnergyRentalParams()).rejects.toThrow("cannot verify");
  });

  it.each(["rentPaused(uint256)", "usageChargeRatio()"])("rejects invalid %s values", async selector => {
    replies[selector] = response(selector.startsWith("rentPaused") ? 2n : 10n ** 18n + 1n);
    await expect(getEnergyRentalParams()).rejects.toThrow("invalid pause flag or usage charge ratio");
  });

  it.each(rates)("does not replace a missing %s with a default or rate model", async selector => {
    replies[selector] = new Error("RPC timeout");
    await expect(getRentalRate(100)).rejects.toThrow("RPC timeout");
    expect(rpc.mock.calls.map(call => call[1])).toEqual(rates);
  });

  it("requires both rates and chooses their maximum, including a real zero rate", async () => {
    expect(await getRentalRate(100)).toEqual({ rentalRate: 0.000001, stableRate: 0.000002, effectiveRate: 0.000002 });
    replies[rates[0]] = response(3_000_000_000_000n);
    replies[rates[1]] = response(0);
    expect(await getRentalRate(100)).toEqual({ rentalRate: 0.000003, stableRate: 0, effectiveRate: 0.000003 });
  });

  it("keeps Nile's pause selector but errors if a quote getter is unsupported", async () => {
    await expect(getEnergyRentalParams("nile")).resolves.toMatchObject({ rentPaused: false });
    expect(rpc.mock.calls.some(call => call[1] === "rentPaused()")).toBe(true);
    replies["usageChargeRatio()"] = { result: { result: false } };
    await expect(getEnergyRentalParams("nile")).rejects.toThrow("cannot verify");
    replies[rates[1]] = { result: { result: false } };
    await expect(getRentalRate(100, "nile")).rejects.toThrow("cannot verify");
  });

  it.each(["NILE", "testnet", "TESTNET"])("uses the Nile read selectors for alias %s", async network => {
    const quote = await calculateRentalPrice(300000, 86400, network);
    expect(quote.dataSources.energyConversion).toBe("chain-resources");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc.mock.calls.some(call => call[1] === "rentPaused()")).toBe(true);
    expect(rpc.mock.calls.some(call => call[1] === "rentPaused(uint256)")).toBe(false);
  });
});

describe("energy conversion and quote provenance", () => {
  it("preserves higher-stable-rate, extra-threshold and minimum-fee calculation", async () => {
    const quote = await calculateRentalPrice(300000, 86400);
    expect(quote.trxAmount).toBe(100);
    expect(quote.fee).toBe(20);
    expect(quote.totalPrepayment).toBeCloseTo(55.28, 8);
    expect(quote.dataSources).toEqual({ network: "mainnet", energyConversion: "dashboard-api",
      parameters: "market-contract", rates: "market-contract" });
    expect(safeSend).not.toHaveBeenCalled();
    expect(getSigningClient).not.toHaveBeenCalled();
  });

  it("preserves a dynamic fee above the minimum and renewal subtraction", async () => {
    const quote = await calculateRentalPrice(3_000_000_000, 86400);
    expect(quote.fee).toBe(80);
    expect(quote.totalPrepayment).toBeCloseTo(352880, 8);
    const renewal = await calculateRenewalPrice(300000, 100, 20, 86400, 0);
    expect(renewal.totalTrxAmount).toBe(200);
    expect(renewal.renewalPrepayment).toBeCloseTo(70.56, 8);
    expect(renewal.dataSources.rates).toBe("market-contract");
  });

  it("allows an API-to-chain conversion fallback only with actual global resource values", async () => {
    fetchMock.mockRejectedValue(new Error("API unavailable"));
    const quote = await calculateRentalPrice(300000, 86400);
    expect(quote.totalPrepayment).toBeCloseTo(55.28, 8);
    expect(quote.dataSources.energyConversion).toBe("chain-resources");
  });

  it.each([{}, { TotalEnergyLimit: 90000000000 }, { TotalEnergyLimit: 0, TotalEnergyWeight: 1 },
    { TotalEnergyLimit: 90000000000, TotalEnergyWeight: 0 },
    { TotalEnergyLimit: Infinity, TotalEnergyWeight: 1 },
    { TotalEnergyLimit: 1, TotalEnergyWeight: 2 },
  ])("does not invent missing or invalid global resource values %#", async values => {
    fetchMock.mockRejectedValue(new Error("API unavailable"));
    resources.mockResolvedValue(values);
    await expect(calculateRentalPrice(300000, 86400)).rejects.toThrow("Energy rental data unavailable");
  });

  it.each([0, -1, "Infinity", "bad", null, true, [3000]])("does not trust invalid API energy conversion %s", async value => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { energyStakePerTrx: value } })));
    resources.mockResolvedValue({});
    await expect(getEnergyRentalDashboard()).rejects.toThrow("Energy rental data unavailable");
  });

  it("does not trust an HTTP failure even when its body looks successful", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { energyStakePerTrx: 999 } }), { status: 503 }));
    expect((await calculateRentalPrice(300000, 86400)).dataSources.energyConversion).toBe("chain-resources");
  });

  it("reports unavailable fallback dashboard metrics explicitly", async () => {
    fetchMock.mockRejectedValue(new Error("API unavailable"));
    expect((await getEnergyRentalDashboard()).unavailableFields).toContain("trxPrice");
  });

  it("does not return the previous successful quote after a new read fails", async () => {
    await calculateRentalPrice(300000, 86400);
    replies[rates[1]] = new Error("RPC timeout");
    await expect(calculateRentalPrice(300000, 86400)).rejects.toThrow("RPC timeout");
    await expect(calculateRenewalPrice(300000, 100, 20, 86400)).rejects.toThrow("RPC timeout");
  });

  it("rejects unknown renewal inputs and numeric overflow instead of serializing a null price", async () => {
    await expect(calculateRenewalPrice(300000, 100, 20, NaN)).rejects.toThrow("finite non-negative");
    await expect(calculateRentalPrice(300000, Infinity)).rejects.toThrow("finite positive");
    await expect(calculateRentalPrice(3_000_000_000, Number.MAX_VALUE)).rejects.toThrow("out-of-range");
    expect(safeSend).not.toHaveBeenCalled();
  });

  it("checks renewal availability against only the additional amount", async () => {
    replies["maxRentableOfType(uint256)"] = response(100_000_000);
    await expect(calculateRenewalPrice(300000, 1000, 20, 86400)).resolves.toMatchObject({ totalTrxAmount: 1100 });
    replies["maxRentableOfType(uint256)"] = response(99_000_000);
    await expect(calculateRenewalPrice(300000, 1000, 20, 86400)).rejects.toThrow("exceeds max rentable");
  });
});

describe("rental write preflight", () => {
  it("distinguishes a verified empty order from an unavailable order", async () => {
    expect((await getRentInfo(ADDRESS, ADDRESS)).hasActiveRental).toBe(false);
    replies["rentals(address,address,uint256)"] = { result: { result: true }, constant_result: [] };
    await expect(getRentInfo(ADDRESS, ADDRESS)).rejects.toThrow("cannot verify");
  });

  it("rejects truncated order tuples rather than treating their first zero word as an empty order", async () => {
    replies["rentals(address,address,uint256)"] = response(0);
    await expect(getRentInfo(ADDRESS, ADDRESS)).rejects.toThrow("cannot verify");
  });

  it("does not submit a return or renewal when required order/rate reads fail", async () => {
    replies["getRentInfo(address,address,uint256)"] = new Error("RPC timeout");
    await expect(returnEnergyRental(ADDRESS, "renter")).rejects.toThrow("RPC timeout");
    replies["getRentInfo(address,address,uint256)"] = response(40_000_000, 0, 0);
    replies["rentals(address,address,uint256)"] = response(100_000_000, 40_000_000, 0);
    replies[rates[1]] = new Error("RPC timeout");
    await expect(rentEnergy(ADDRESS, 50000, 86400)).rejects.toThrow("RPC timeout");
    expect(safeSend).not.toHaveBeenCalled();
  });

  it.each(["getRentInfo(address,address,uint256)", "rentals(address,address,uint256)",
    "feeRatio()", "rentPaused(uint256)", "usageChargeRatio()", ...rates,
  ])("never submits a rental when %s fails", async selector => {
    replies[selector] = new Error("RPC timeout");
    await expect(rentEnergy(ADDRESS, 300000, 86400)).rejects.toThrow("RPC timeout");
    expect(safeSend).not.toHaveBeenCalled();
    expect(balance).not.toHaveBeenCalled();
  });

  it("blocks a paused market and insufficient availability", async () => {
    replies["rentPaused(uint256)"] = response(1);
    await expect(rentEnergy(ADDRESS, 300000, 86400)).rejects.toThrow("paused");
    replies["rentPaused(uint256)"] = response(0);
    replies["maxRentableOfType(uint256)"] = response(0);
    await expect(rentEnergy(ADDRESS, 300000, 86400)).rejects.toThrow("exceeds max rentable");
    expect(safeSend).not.toHaveBeenCalled();
  });

  it("still submits a fully verified new rental through the mocked sender", async () => {
    const result = await rentEnergy(ADDRESS, 300000, 86400);
    expect(result.txId).toBe("mock-rental-tx");
    expect(safeSend).toHaveBeenCalledWith(expect.objectContaining({
      functionName: "rentResource", args: [ADDRESS, "100000000", 1], callValue: "55280000",
    }), "mainnet");
  });
});
