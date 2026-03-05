/**
 * Integration tests for blocks.ts.
 * Makes real TRON mainnet RPC calls — requires network access.
 * Rate-limited without TRONGRID_API_KEY.
 */
import { describe, it, expect } from "vitest";
import {
  getLatestBlock,
  getBlockNumber,
  getBlockByNumber,
  getChainId,
} from "../../../src/core/services/blocks.js";
import { skipOn429 } from "../../helpers.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("getChainId", () => {
  it("returns the TRON mainnet chain ID", async () => {
    const id = await getChainId("mainnet");
    expect(id).toBe(728126428);
  });

  it("returns the Nile testnet chain ID", async () => {
    const id = await getChainId("nile");
    expect(id).toBe(20191029);
  });

  it("returns 0 for unknown networks", async () => {
    const id = await getChainId("unknown");
    expect(id).toBe(0);
  });
});

describe("getLatestBlock (Mainnet)", () => {
  it("should return a block with a valid header", async () => {
    const block = await getLatestBlock("mainnet");
    expect(block).toBeDefined();
    expect(block.block_header).toBeDefined();
    expect(block.block_header.raw_data).toBeDefined();
    expect(typeof block.block_header.raw_data.number).toBe("number");
    console.log(`Latest block: #${block.block_header.raw_data.number}`);
  }, 20_000);
});

describe("getBlockNumber (Mainnet)", () => {
  it("should return a positive block number", skipOn429(async () => {
    await delay(1000);
    const num = await getBlockNumber("mainnet");
    expect(typeof num).toBe("number");
    expect(num).toBeGreaterThan(0);
    console.log(`Current block number: ${num}`);
  }), 20_000);
});

describe("getBlockByNumber (Mainnet)", () => {
  it("should fetch a specific historical block", skipOn429(async () => {
    await delay(1000);
    // Use a well-known early block number
    const block = await getBlockByNumber(1, "mainnet");
    expect(block).toBeDefined();
    expect(block.block_header).toBeDefined();
  }), 20_000);

  it("should fetch a recent block using current block number", skipOn429(async () => {
    await delay(1000);
    const num = await getBlockNumber("mainnet");
    await delay(500);
    const block = await getBlockByNumber(num - 5, "mainnet");
    expect(block).toBeDefined();
    expect(block.block_header.raw_data.number).toBe(num - 5);
  }), 30_000);
});
