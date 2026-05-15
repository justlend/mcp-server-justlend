/**
 * Regression test for the REVERT-bypass fix in safeSend.
 *
 * Before the fix, when constant-call simulation surfaced "REVERT opcode executed",
 * safeSend would still build, sign, and broadcast the transaction with a typical
 * energy estimate. That broke the documented "prevents failed transactions from
 * burning gas" contract on mainnet.
 *
 * After the fix:
 *  - On mainnet, a simulated REVERT must throw and must NOT broadcast.
 *  - On nile (testnet), the legacy degrade-and-broadcast path is preserved
 *    because testnet node simulation has historically been unreliable.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendRawTransaction = vi.fn();
const triggerSmartContract = vi.fn();
const triggerConstantContract = vi.fn();

const mockTronWeb = {
  defaultAddress: { base58: "TWALLETAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
  trx: {
    getAccountResources: vi.fn().mockResolvedValue({
      EnergyLimit: 50_000_000,
      EnergyUsed: 0,
      freeNetLimit: 6000,
      freeNetUsed: 0,
      NetLimit: 0,
      NetUsed: 0,
    }),
    getAccount: vi.fn().mockResolvedValue({ balance: 50_000_000_000 }),
    sendRawTransaction,
  },
  transactionBuilder: {
    triggerSmartContract,
    triggerConstantContract,
  },
};

vi.mock("../../../src/core/services/clients.js", () => ({
  getTronWeb: vi.fn(() => mockTronWeb),
}));

vi.mock("../../../src/core/services/wallet.js", () => ({
  getSigningClient: vi.fn(async () => mockTronWeb),
  signTransactionWithWallet: vi.fn(async (tx: any) => ({ ...tx, signature: ["0xsig"] })),
}));

vi.mock("../../../src/core/services/resource-prices.js", () => ({
  getResourcePrices: vi.fn().mockResolvedValue({
    energyPriceSun: "100",
    bandwidthPriceSun: "1000",
  }),
}));

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
];

describe("safeSend — REVERT pre-flight fix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendRawTransaction.mockResolvedValue({ result: true, txid: "broadcasted" });
    triggerSmartContract.mockResolvedValue({ transaction: { txID: "unsigned" } });
  });

  it("on mainnet: throws and does NOT broadcast when simulation reverts", async () => {
    // Simulation surfaces a REVERT — typical TronWeb shape: triggerConstantContract
    // either returns { result: { result: false, message: hex } } or throws with
    // "REVERT opcode executed" embedded. We exercise the throw path because that's
    // the one whose substring match drives the bypass branch in safeSend.
    triggerConstantContract.mockRejectedValue(
      new Error("REVERT opcode executed"),
    );

    const { safeSend } = await import("../../../src/core/services/contracts.js");

    await expect(
      safeSend(
        {
          address: "TTokenContract000000000000000000000",
          abi: ERC20_TRANSFER_ABI,
          functionName: "transfer",
          args: ["TRecipient00000000000000000000000000", "1"],
        },
        "mainnet",
      ),
    ).rejects.toThrow(/Refusing to broadcast/i);

    expect(triggerSmartContract).not.toHaveBeenCalled();
    expect(sendRawTransaction).not.toHaveBeenCalled();
  });

  it("on nile: preserves the legacy degrade-and-broadcast path", async () => {
    triggerConstantContract.mockRejectedValue(
      new Error("REVERT opcode executed"),
    );

    const { safeSend } = await import("../../../src/core/services/contracts.js");

    const result = await safeSend(
      {
        address: "TTokenContract000000000000000000000",
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: ["TRecipient00000000000000000000000000", "1"],
      },
      "nile",
    );

    expect(result.txID).toBe("broadcasted");
    expect(triggerSmartContract).toHaveBeenCalledTimes(1);
    expect(sendRawTransaction).toHaveBeenCalledTimes(1);
  });
});
