/**
 * Integration tests for transactions.ts.
 * Makes real TRON mainnet RPC calls — requires network access.
 * Rate-limited without TRONGRID_API_KEY; run individually to avoid 429 errors.
 *
 * Run: npx vitest run tests/core/services/transactions.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  getTransaction,
  getTransactionInfo,
  getTransactionReceipt,
} from "../../../src/core/services/transactions.js";
import { getLatestBlock } from "../../../src/core/services/blocks.js";
import { skipOn429 } from "../../helpers.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("getTransactionReceipt alias", () => {
  it("should be the same function reference as getTransactionInfo", () => {
    expect(getTransactionReceipt).toBe(getTransactionInfo);
  });
});

describe("getTransaction (Mainnet)", () => {
  it("should fetch transaction details for a transaction in the latest block", skipOn429(async () => {
    // Fetch a real transaction hash from the latest block to avoid stale/invalid hashes
    const block = await getLatestBlock("mainnet");
    const transactions = block?.transactions as any[] | undefined;

    if (!transactions || transactions.length === 0) {
      console.error("Latest block has no transactions — skipping");
      return;
    }

    const txHash = transactions[0].txID ?? transactions[0];
    const tx = await getTransaction(String(txHash), "mainnet");

    expect(tx).toBeDefined();
    expect(typeof tx).toBe("object");
    console.error(`Fetched tx: ${txHash}, keys: ${Object.keys(tx ?? {}).join(", ")}`);
  }), 30_000);
});

describe("getTransactionInfo (Mainnet)", () => {
  it("should fetch info for a transaction in the latest block", skipOn429(async () => {
    await delay(2000);
    const block = await getLatestBlock("mainnet");
    const transactions = block?.transactions as any[] | undefined;

    if (!transactions || transactions.length === 0) {
      console.error("Latest block has no transactions — skipping");
      return;
    }

    const txHash = transactions[0].txID ?? transactions[0];
    const info = await getTransactionInfo(String(txHash), "mainnet");

    expect(info).toBeDefined();
    console.error(`Transaction info: ${JSON.stringify(info).slice(0, 100)}...`);
  }), 30_000);
});
