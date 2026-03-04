/**
 * Tests for contracts.ts.
 *
 * Pure-logic tests (parseABI, getReadableFunctions, getFunctionFromABI)
 * run without network calls.
 *
 * readContract / fetchContractABI make real mainnet RPC calls.
 * Rate-limited without TRONGRID_API_KEY.
 */
import { describe, it, expect } from "vitest";
import {
  parseABI,
  getReadableFunctions,
  getFunctionFromABI,
  readContract,
  fetchContractABI,
} from "../../../src/core/services/contracts.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Minimal ERC20/TRC20 ABI for testing
const ERC20_ABI = [
  {
    type: "Function",
    name: "balanceOf",
    stateMutability: "View",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "Function",
    name: "symbol",
    stateMutability: "Pure",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "Event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
];

const USDT_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const TEST_ADDRESS = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";

// ============================================================================
// parseABI (pure)
// ============================================================================

describe("parseABI", () => {
  it("lowercases type and stateMutability", () => {
    const parsed = parseABI(ERC20_ABI);
    for (const item of parsed) {
      if (item.type) expect(item.type).toBe(item.type.toLowerCase());
      if (item.stateMutability)
        expect(item.stateMutability).toBe(item.stateMutability.toLowerCase());
    }
  });

  it("accepts a JSON string", () => {
    const parsed = parseABI(JSON.stringify(ERC20_ABI));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(ERC20_ABI.length);
  });

  it("accepts an array directly", () => {
    const parsed = parseABI(ERC20_ABI);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("does not mutate the original array", () => {
    const original = JSON.parse(JSON.stringify(ERC20_ABI));
    parseABI(ERC20_ABI);
    expect(ERC20_ABI[0].type).toBe("Function"); // original unchanged
    expect(original[0].type).toBe("Function");
  });
});

// ============================================================================
// getReadableFunctions (pure)
// ============================================================================

describe("getReadableFunctions", () => {
  it("returns only function entries", () => {
    const parsed = parseABI(ERC20_ABI);
    const funcs = getReadableFunctions(parsed);
    // Events should be filtered out
    expect(funcs.every((f) => !f.startsWith("Transfer"))).toBe(true);
  });

  it("includes balanceOf and symbol", () => {
    const parsed = parseABI(ERC20_ABI);
    const funcs = getReadableFunctions(parsed);
    expect(funcs.some((f) => f.startsWith("balanceOf"))).toBe(true);
    expect(funcs.some((f) => f.startsWith("symbol"))).toBe(true);
  });

  it("formats inputs and outputs", () => {
    const parsed = parseABI(ERC20_ABI);
    const funcs = getReadableFunctions(parsed);
    const balanceOf = funcs.find((f) => f.startsWith("balanceOf"))!;
    expect(balanceOf).toContain("address");
    expect(balanceOf).toContain("uint256");
  });
});

// ============================================================================
// getFunctionFromABI (pure)
// ============================================================================

describe("getFunctionFromABI", () => {
  it("finds a function by name", () => {
    const parsed = parseABI(ERC20_ABI);
    const func = getFunctionFromABI(parsed, "balanceOf");
    expect(func).toBeDefined();
    expect(func.name).toBe("balanceOf");
  });

  it("throws for an unknown function name", () => {
    const parsed = parseABI(ERC20_ABI);
    expect(() => getFunctionFromABI(parsed, "transfer")).toThrow(
      "Function transfer not found in ABI",
    );
  });
});

// ============================================================================
// readContract (Mainnet — network call)
// ============================================================================

describe("readContract (Mainnet)", () => {
  it("should read the USDT symbol from the contract", async () => {
    const result = await readContract(
      {
        address: USDT_ADDRESS,
        functionName: "symbol",
        abi: parseABI(ERC20_ABI),
      },
      "mainnet",
    );
    expect(String(result)).toBe("USDT");
    console.log(`USDT symbol: ${result}`);
  }, 25_000);

  it("should read USDT balanceOf for a known address", async () => {
    await delay(1500);
    const result = await readContract(
      {
        address: USDT_ADDRESS,
        functionName: "balanceOf",
        args: [TEST_ADDRESS],
        abi: parseABI(ERC20_ABI),
      },
      "mainnet",
    );
    expect(result).toBeDefined();
    console.log(`USDT balanceOf ${TEST_ADDRESS}: ${result}`);
  }, 25_000);

  it("should throw when function is not found in contract", async () => {
    await delay(1000);
    await expect(
      readContract(
        {
          address: USDT_ADDRESS,
          functionName: "nonExistentFunction",
          abi: parseABI(ERC20_ABI),
        },
        "mainnet",
      ),
    ).rejects.toThrow();
  }, 20_000);
});

// ============================================================================
// fetchContractABI (Mainnet — network call)
// ============================================================================

describe("fetchContractABI (Mainnet)", () => {
  it("should fetch the ABI for the USDT contract", async () => {
    await delay(1500);
    const abi = await fetchContractABI(USDT_ADDRESS, "mainnet");
    expect(Array.isArray(abi)).toBe(true);
    expect(abi.length).toBeGreaterThan(0);
    console.log(`USDT ABI has ${abi.length} entries`);
  }, 30_000);
});
