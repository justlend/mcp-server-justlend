import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getMoolahVaultMiningApy,
  getMoolahMiningResolver,
  getMoolahAccruingMining,
  getMoolahPendingMiningPeriods,
  claimMoolahMiningPeriod,
} from "../../../src/core/services/moolah-mining.js";
import * as backend from "../../../src/core/services/moolah-backend.js";
import * as contracts from "../../../src/core/services/contracts.js";
import * as wallet from "../../../src/core/services/wallet.js";

// Nile is the only network with a configured V2 distributor today —
// mainnet is "" pending deployment, so all on-chain claim tests target nile.
const NILE_DISTRIBUTOR = "TLSPGyZRYeoZsPX2V9tpGYKF85zFyUAb1u";

// Network-free unit tests focused on the parsing logic that determines claim
// correctness — hex-to-decimal conversion, decimals per token, slot-aligned
// amounts arrays, settling vs accruing classification, and distributor
// availability errors. The on-chain merkle pre-checks belong to integration
// coverage and are stubbed via the existing `claim_moolah_mining_period`
// flow; we don't exercise tronWeb here.

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getMoolahVaultMiningApy", () => {
  it("returns USDD/TRX split and total, with enabled=true when nonzero", async () => {
    vi.spyOn(backend, "fetchV2VaultMiningRates").mockResolvedValue({
      "TVAULT...": { USDDNEW: "0.05", TRXNEW: "0.02" },
    } as any);
    const res = await getMoolahVaultMiningApy("TVAULT...", "mainnet");
    expect(res.miningApy.usdd).toBeCloseTo(0.05);
    expect(res.miningApy.trx).toBeCloseTo(0.02);
    expect(res.miningApy.total).toBeCloseTo(0.07);
    expect(res.enabled).toBe(true);
  });

  it("returns zeros and enabled=false for an unknown vault", async () => {
    vi.spyOn(backend, "fetchV2VaultMiningRates").mockResolvedValue({} as any);
    const res = await getMoolahVaultMiningApy("TUNKNOWN", "mainnet");
    expect(res.miningApy.total).toBe(0);
    expect(res.enabled).toBe(false);
  });
});

describe("getMoolahMiningResolver", () => {
  it("filters out vaults with zero APY", async () => {
    vi.spyOn(backend, "fetchV2VaultMiningRates").mockResolvedValue({
      TA: { USDDNEW: "0.1", TRXNEW: "0" },
      TB: { USDDNEW: "0",   TRXNEW: "0"  },
      TC: { USDDNEW: "0.02", TRXNEW: "0.03" },
    } as any);
    const res = await getMoolahMiningResolver("mainnet");
    expect(res.count).toBe(2);
    expect(res.vaults.TA.total).toBeCloseTo(0.1);
    expect(res.vaults.TC.total).toBeCloseTo(0.05);
    expect(res.vaults.TB).toBeUndefined();
  });
});

describe("getMoolahAccruingMining", () => {
  it("aggregates gainNew across vaults and only counts gainLast in settling window", async () => {
    vi.spyOn(backend, "fetchV2UserMiningState").mockResolvedValue({
      vaultA: {
        USDDNEW: { gainNew: "10", gainLast: "5", price: 1, miningStatus: 1, currRewardStatus: "1", currEndTime: "2026-05-10 12:00" },
        TRXNEW:  { gainNew: "20", gainLast: "0", price: 0.1, miningStatus: 1, currRewardStatus: "1", currEndTime: "2026-05-10 12:00" },
      },
      vaultB: {
        // Settling window: status=2, currRewardStatus=1, gainLast counts
        USDDNEW: { gainNew: "0", gainLast: "7", price: 1, miningStatus: 2, currRewardStatus: "1" },
        // Outside settling window (status=3), gainLast must NOT count
        TRXNEW:  { gainNew: "0", gainLast: "100", price: 0.1, miningStatus: 3, currRewardStatus: "1" },
      },
      vaultC: {
        // currRewardStatus=2 should flip globalSettlementStatus
        USDDNEW: { gainNew: "0", gainLast: "0", price: 1, miningStatus: 1, currRewardStatus: "2" },
      },
    } as any);
    const res = await getMoolahAccruingMining("Tuser", "mainnet");
    // accruing: 10*1 + 20*0.1 = 12
    expect(res.accruingUsd).toBeCloseTo(12);
    // settling: 7*1 only (vaultB.TRXNEW excluded by status=3)
    expect(res.settlingUsd).toBeCloseTo(7);
    expect(res.globalSettlementStatus).toBe(true);
    expect(res.settlementTime).toBe("2026-05-10 12:00");
    const usdd = res.pendingByToken.find(p => p.token === "USDD");
    const trx  = res.pendingByToken.find(p => p.token === "TRX");
    expect(usdd?.amount).toBe("10");
    expect(trx?.amount).toBe("20");
  });

  it("ignores NFT tokens entirely", async () => {
    vi.spyOn(backend, "fetchV2UserMiningState").mockResolvedValue({
      vault: {
        NFTNEW: { gainNew: "999", gainLast: "999", price: 100, miningStatus: 1, currRewardStatus: "1" },
      },
    } as any);
    const res = await getMoolahAccruingMining("Tuser", "mainnet");
    expect(res.accruingUsd).toBe(0);
    expect(res.pendingByToken.length).toBe(0);
  });

  it("treats sentinel '1970-01-01 08:00' end time as missing", async () => {
    vi.spyOn(backend, "fetchV2UserMiningState").mockResolvedValue({
      v: {
        USDDNEW: { gainNew: "1", gainLast: "0", price: 1, miningStatus: 1, currRewardStatus: "1", currEndTime: "1970-01-01 08:00" },
      },
    } as any);
    const res = await getMoolahAccruingMining("Tuser", "mainnet");
    expect(res.settlementTime).toBe("");
  });
});

describe("getMoolahPendingMiningPeriods", () => {
  it("decodes hex amounts using per-token decimals (TRX=6, USDD=18)", async () => {
    // 1_000_000 raw with 6 decimals = 1.0 TRX; 2*10^18 raw with 18 decimals = 2.0 USDD
    vi.spyOn(backend, "fetchV2UnclaimedAirdrop").mockResolvedValue({
      "0": {
        merkleIndex: 0,
        index: 7,
        proof: ["0xabc"],
        tokenSymbol: ["USDD", "TRX"],
        tokenAddress: ["TUSDD...", "TTRX..."],
        amount: ["0x1bc16d674ec80000", "0xf4240"], // 2e18, 1e6
        claimed: false,
      },
      "1": {
        merkleIndex: 1, index: 0, proof: [], tokenSymbol: ["USDD"], tokenAddress: ["TUSDD..."],
        amount: ["1000000000000000000"], claimed: true,
      },
    } as any);
    const res = await getMoolahPendingMiningPeriods("Tuser", { network: "mainnet" });
    // claimed:true round excluded by default
    expect(res.periods.length).toBe(1);
    const p = res.periods[0];
    expect(p.merkleIndex).toBe(0);
    expect(p.index).toBe(7);
    expect(p.tokens[0].symbol).toBe("USDD");
    expect(p.tokens[0].decimals).toBe(18);
    expect(p.tokens[0].amount).toBe("2");
    expect(p.tokens[0].amountRaw).toBe("2000000000000000000");
    expect(p.tokens[1].symbol).toBe("TRX");
    expect(p.tokens[1].decimals).toBe(6);
    expect(p.tokens[1].amount).toBe("1");
    expect(p.tokens[1].amountRaw).toBe("1000000");
    // USD = 2 * 1 + 1 * 0.145 ≈ 2.145
    expect(p.totalUsd).toBeCloseTo(2.145, 5);
  });

  it("returns claimed rounds when includeClaimed=true", async () => {
    vi.spyOn(backend, "fetchV2UnclaimedAirdrop").mockResolvedValue({
      "0": { merkleIndex: 0, index: 0, proof: [], tokenSymbol: ["USDD"], tokenAddress: [""], amount: ["0"], claimed: true },
    } as any);
    const res = await getMoolahPendingMiningPeriods("Tuser", { includeClaimed: true, network: "mainnet" });
    expect(res.periods.length).toBe(1);
    expect(res.periods[0].claimed).toBe(true);
  });
});

describe("claimMoolahMiningPeriod (config errors)", () => {
  it("errors clearly when distributor is not configured for the network", async () => {
    // Mainnet has merkleDistributorV2 = "" until contracts ship. The error
    // surfaces before any wallet or network call, so no mocks are needed.
    await expect(
      claimMoolahMiningPeriod({ periodKey: "0", network: "mainnet" }),
    ).rejects.toThrow(/V2 mining distributor is not configured/);
  });

  it("requires either periodKey or full claim fields", async () => {
    // Nile has the address configured, so we expect the validation error,
    // not the missing-distributor error.
    await expect(
      claimMoolahMiningPeriod({ network: "nile" }),
    ).rejects.toThrow(/Either periodKey or full claim fields/);
  });
});

// ── On-chain pre-checks + happy path ───────────────────────────────────────
//
// claimMoolahMiningPeriod gates the tx on two view calls (merkleRoots,
// isClaimed) and only then calls safeSend. We stub readContract to drive
// each branch and capture the safeSend payload to assert that the right
// distributor / function / args land on the tx builder.

const mockMerkleRootReady = (hexBytes32 = "0x" + "01".repeat(32)) =>
  vi.spyOn(contracts, "readContract").mockImplementation(async (params: any) => {
    if (params.functionName === "merkleRoots") return hexBytes32;
    if (params.functionName === "isClaimed") return false;
    return null;
  });

describe("claimMoolahMiningPeriod (on-chain pre-checks)", () => {
  it("rejects when isClaimed() returns true on-chain", async () => {
    vi.spyOn(contracts, "readContract").mockImplementation(async (params: any) => {
      if (params.functionName === "isClaimed") return true;
      if (params.functionName === "merkleRoots") return "0x" + "01".repeat(32);
      return null;
    });
    const safeSendSpy = vi.spyOn(contracts, "safeSend");
    await expect(
      claimMoolahMiningPeriod({
        merkleIndex: 5, index: 12,
        amounts: ["1000000000000000000"], proof: ["0xabc"],
        network: "nile",
      }),
    ).rejects.toThrow(/already claimed on-chain/);
    expect(safeSendSpy).not.toHaveBeenCalled();
  });

  it("rejects when merkleRoots() is empty (root not yet published)", async () => {
    vi.spyOn(contracts, "readContract").mockImplementation(async (params: any) => {
      if (params.functionName === "isClaimed") return false;
      if (params.functionName === "merkleRoots") return "0x" + "00".repeat(32);
      return null;
    });
    const safeSendSpy = vi.spyOn(contracts, "safeSend");
    await expect(
      claimMoolahMiningPeriod({
        merkleIndex: 5, index: 12,
        amounts: ["1000000000000000000"], proof: ["0xabc"],
        network: "nile",
      }),
    ).rejects.toThrow(/Merkle root.*not yet published/);
    expect(safeSendSpy).not.toHaveBeenCalled();
  });

  it("treats a readContract failure on isClaimed as 'not claimed' and proceeds", async () => {
    // The pre-check helpers swallow read errors so the function still tries
    // to submit — the chain itself is the source of truth on revert. Without
    // this, a flaky RPC for the view call would block users from claiming.
    vi.spyOn(contracts, "readContract").mockImplementation(async (params: any) => {
      if (params.functionName === "isClaimed") throw new Error("rpc flake");
      if (params.functionName === "merkleRoots") return "0x" + "01".repeat(32);
      return null;
    });
    const safeSendSpy = vi.spyOn(contracts, "safeSend").mockResolvedValue({
      txID: "TXID_OK", message: "ok",
    } as any);
    const res = await claimMoolahMiningPeriod({
      merkleIndex: 1, index: 0,
      amounts: ["1"], proof: ["0xabc"],
      network: "nile",
    });
    expect(safeSendSpy).toHaveBeenCalledOnce();
    expect(res.txID).toBe("TXID_OK");
  });

  it("submits multiClaim against the V2 distributor with the wrapped tuple", async () => {
    mockMerkleRootReady();
    let captured: any = null;
    const safeSendSpy = vi.spyOn(contracts, "safeSend").mockImplementation(async (params: any) => {
      captured = params;
      return { txID: "TXID_HAPPY", message: "ok" } as any;
    });

    const res = await claimMoolahMiningPeriod({
      merkleIndex: 7, index: 3,
      amounts: ["2000000000000000000", "1500000"],
      proof: ["0xdeadbeef", "0xcafebabe"],
      network: "nile",
    });

    expect(safeSendSpy).toHaveBeenCalledOnce();
    expect(captured.address).toBe(NILE_DISTRIBUTOR);
    expect(captured.functionName).toBe("multiClaim");
    // args is [[claimTuple]] — outer wrap = function arg, inner = single-leaf array
    expect(Array.isArray(captured.args)).toBe(true);
    expect(captured.args.length).toBe(1);
    const leaves = captured.args[0];
    expect(Array.isArray(leaves)).toBe(true);
    expect(leaves.length).toBe(1);
    const [merkleIdx, leafIdx, amounts, proof] = leaves[0];
    expect(merkleIdx).toBe("7");
    expect(leafIdx).toBe("3");
    expect(amounts).toEqual(["2000000000000000000", "1500000"]);
    expect(proof).toEqual(["0xdeadbeef", "0xcafebabe"]);
    // ABI must declare amounts as uint256[] (V2 selector), not single uint256.
    const claimsInput = captured.abi.find((f: any) => f.name === "multiClaim").inputs[0];
    const amountComp = claimsInput.components.find((c: any) => c.name === "amounts");
    expect(amountComp.type).toBe("uint256[]");

    expect(res.txID).toBe("TXID_HAPPY");
    expect(res.merkleIndex).toBe(7);
    expect(res.index).toBe(3);
    expect(res.periodKey).toBe("7:3"); // synthesized from indices when no key passed
  });
});

// ── periodKey resolution path ──────────────────────────────────────────────

describe("claimMoolahMiningPeriod (periodKey resolution)", () => {
  it("refetches /v2/getAllUnClaimedAirDrop and reconstructs the tuple", async () => {
    // Pretend a wallet is connected so the function reaches the airdrop fetch.
    vi.spyOn(wallet, "getSigningClient").mockResolvedValue({
      defaultAddress: { base58: "TFakeOwnerAddress00000000000000000" },
    } as any);

    vi.spyOn(backend, "fetchV2UnclaimedAirdrop").mockResolvedValue({
      "round-42": {
        merkleIndex: 42, index: 9,
        tokenSymbol: ["USDD"], tokenAddress: ["TUSDD..."],
        // hex-encoded: 1e18 — exercises the hexToDecimal path used by the
        // periodKey resolver, which decimal overrides skip.
        amount: ["0xde0b6b3a7640000"],
        proof: ["0xproof1", "0xproof2"],
      },
    } as any);

    mockMerkleRootReady();
    let captured: any = null;
    vi.spyOn(contracts, "safeSend").mockImplementation(async (params: any) => {
      captured = params;
      return { txID: "TXID_KEYED", message: "ok" } as any;
    });

    const res = await claimMoolahMiningPeriod({ periodKey: "round-42", network: "nile" });

    expect(res.periodKey).toBe("round-42");
    expect(res.merkleIndex).toBe(42);
    expect(res.index).toBe(9);

    const [, , amounts, proof] = captured.args[0][0];
    // amount must be the decimal-converted raw value, NOT the hex string.
    expect(amounts).toEqual(["1000000000000000000"]);
    expect(proof).toEqual(["0xproof1", "0xproof2"]);
  });

  it("errors when the periodKey is unknown in the airdrop response", async () => {
    vi.spyOn(wallet, "getSigningClient").mockResolvedValue({
      defaultAddress: { base58: "TFakeOwnerAddress00000000000000000" },
    } as any);
    vi.spyOn(backend, "fetchV2UnclaimedAirdrop").mockResolvedValue({} as any);
    await expect(
      claimMoolahMiningPeriod({ periodKey: "ghost", network: "nile" }),
    ).rejects.toThrow(/No airdrop round 'ghost'/);
  });

  it("errors when the resolved entry has no merkle proof", async () => {
    vi.spyOn(wallet, "getSigningClient").mockResolvedValue({
      defaultAddress: { base58: "TFakeOwnerAddress00000000000000000" },
    } as any);
    vi.spyOn(backend, "fetchV2UnclaimedAirdrop").mockResolvedValue({
      "round-1": { merkleIndex: 1, index: 0, tokenSymbol: ["USDD"], tokenAddress: ["TUSDD..."], amount: ["1"], proof: [] },
    } as any);
    await expect(
      claimMoolahMiningPeriod({ periodKey: "round-1", network: "nile" }),
    ).rejects.toThrow(/no merkle proof/);
  });
});
