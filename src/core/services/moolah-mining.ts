/**
 * JustLend V2 (Moolah) — Mining rewards.
 *
 * Mirrors the front-app's useMining.js surface for the MCP server:
 *   - Vault mining APY (USDD / TRX split) from /v2/tronbull
 *   - Per-user accruing & settling state from /v2/tronbullish
 *   - Pending merkle airdrop rounds from /v2/getAllUnClaimedAirDrop
 *   - Multi-token claim against the V2 merkle distributor
 *
 * Tokens arrive in their native minimum unit (USDD: 1e18, TRX: 1e6). We keep
 * `amountRaw` for contract calls and expose decimal-shifted `amount` for UI
 * math; the front-app learned this the hard way after assuming decimals=18
 * inflated TRX totals 12 orders of magnitude.
 */
import { getJustLendAddresses } from "../chains.js";
import { MERKLE_DISTRIBUTOR_V2_ABI } from "../abis.js";
import { readContract, safeSend } from "./contracts.js";
import { getSigningClient } from "./wallet.js";
import {
  fetchV2VaultMiningRates,
  fetchV2UserMiningState,
  fetchV2UnclaimedAirdrop,
  type MoolahMiningTokenState,
  type MoolahAirdropEntry,
} from "./moolah-backend.js";

// USDD ≈ $1; TRX price is fetched lazily and cached for downstream USD math.
// Last-resort fallback if the price endpoint is unreachable mirrors front-app.
const USDD_PRICE_DEFAULT = 1;
const TRX_PRICE_FALLBACK = 0.145;
const TOKEN_DECIMALS: Record<string, number> = {
  USDD: 18, USDDNEW: 18, USDDOLD: 18,
  TRX: 6,   TRXNEW: 6,
};

const decimalsFor = (symbol: string): number => TOKEN_DECIMALS[symbol] ?? 18;

const normalizeSymbol = (symbol: string): string => symbol.replace(/NEW$|OLD$/, "");

const toArray = <T>(v: T | T[] | undefined | null): T[] =>
  Array.isArray(v) ? v : v == null ? [] : [v];

/**
 * Convert a hex (`0x…`) or decimal string to a plain decimal string. Backend
 * encodes airdrop amounts as hex; on-chain `multiClaim` expects decimal-uint256.
 */
const hexToDecimal = (value: unknown): string => {
  if (value == null) return "0";
  const str = String(value);
  if (str.startsWith("0x") || str.startsWith("0X")) {
    return BigInt(str).toString();
  }
  return str;
};

const shiftDown = (raw: string, decimals: number): string => {
  if (raw === "0" || raw === "") return "0";
  const neg = raw.startsWith("-");
  const digits = neg ? raw.slice(1) : raw;
  if (decimals <= 0) return raw;
  const padded = digits.padStart(decimals + 1, "0");
  const cut = padded.length - decimals;
  const intPart = padded.slice(0, cut);
  const fracPart = padded.slice(cut).replace(/0+$/, "");
  const out = fracPart ? `${intPart}.${fracPart}` : intPart;
  return neg ? `-${out}` : out;
};

const toFloat = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// ── Vault mining APY ─────────────────────────────────────────────────────────

export interface MoolahVaultMiningApy {
  vaultAddress: string;
  /** APY as a fraction (0.123 = 12.3%), matching how /v2/tronbull encodes it. */
  miningApy: { usdd: number; trx: number; total: number };
  /** True when at least one mining token has a non-zero APY. */
  enabled: boolean;
}

/** Resolve mining APY for a single vault. Returns zeros if the vault is not enrolled. */
export async function getMoolahVaultMiningApy(
  vaultAddress: string,
  network = "mainnet",
): Promise<MoolahVaultMiningApy> {
  const map = await fetchV2VaultMiningRates(vaultAddress, undefined, network);
  const entry = map[vaultAddress] ?? {};
  const usdd = toFloat(entry.USDDNEW);
  const trx  = toFloat(entry.TRXNEW);
  const total = usdd + trx;
  return {
    vaultAddress,
    miningApy: { usdd, trx, total },
    enabled: total > 0,
  };
}

/**
 * Full vault → APY map. Used by the dashboard resolver to prefetch fire-icon
 * eligibility and per-vault APY in a single round-trip.
 */
export async function getMoolahMiningResolver(
  network = "mainnet",
): Promise<{ count: number; vaults: Record<string, MoolahVaultMiningApy["miningApy"]> }> {
  const map = await fetchV2VaultMiningRates(undefined, undefined, network);
  const vaults: Record<string, MoolahVaultMiningApy["miningApy"]> = {};
  for (const [vault, entry] of Object.entries(map)) {
    const usdd = toFloat(entry.USDDNEW);
    const trx  = toFloat(entry.TRXNEW);
    const total = usdd + trx;
    if (total <= 0) continue;
    vaults[vault] = { usdd, trx, total };
  }
  return { count: Object.keys(vaults).length, vaults };
}

// ── Accruing / Settling ──────────────────────────────────────────────────────

export interface MoolahAccruingMining {
  /** USD value of current-round earnings still accruing across all vaults. */
  accruingUsd: number;
  /**
   * USD value of last-round earnings in the brief settling window
   * (miningStatus == 2 AND currRewardStatus == 1). Excludes status 1 (history)
   * and 3 (already published to merkle), which would otherwise double-count.
   */
  settlingUsd: number;
  /** Per-token aggregated gainNew across vaults (raw symbol, not NEW-suffixed). */
  pendingByToken: Array<{ token: string; amount: string }>;
  /** Earliest non-default settlement boundary observed across pools. */
  settlementTime: string;
  /** True when any token reports currRewardStatus === '2' (global freeze). */
  globalSettlementStatus: boolean;
}

const matches = (a: unknown, expected: number | string): boolean =>
  String(a ?? "") === String(expected) || Number(a) === Number(expected);

const sumNumberStrings = (a: string, b: string): string => {
  const av = toFloat(a);
  const bv = toFloat(b);
  return String(av + bv);
};

export async function getMoolahAccruingMining(
  address: string,
  network = "mainnet",
): Promise<MoolahAccruingMining> {
  const data = await fetchV2UserMiningState(address, undefined, network);
  let accruingUsd = 0;
  let settlingUsd = 0;
  let settlementTime = "";
  let globalSettlementStatus = false;
  const pendingByToken = new Map<string, string>();

  for (const poolEntry of Object.values(data)) {
    if (!poolEntry) continue;
    for (const [tokenKey, tokenRaw] of Object.entries(poolEntry)) {
      if (!tokenRaw || tokenKey === "NFT" || tokenKey === "NFTNEW") continue;
      const t = tokenRaw as MoolahMiningTokenState;
      const symbol = normalizeSymbol(tokenKey);
      const price = toFloat(t.price);
      const gainNew = toFloat(t.gainNew);
      const gainLast = toFloat(t.gainLast);

      accruingUsd += gainNew * price;

      if (matches(t.miningStatus, 2) && matches(t.currRewardStatus, 1) && gainLast > 0) {
        settlingUsd += gainLast * price;
      }

      if (gainNew > 0) {
        const prev = pendingByToken.get(symbol) ?? "0";
        pendingByToken.set(symbol, sumNumberStrings(prev, String(t.gainNew ?? "0")));
        if (!settlementTime && t.currEndTime && t.currEndTime !== "1970-01-01 08:00") {
          settlementTime = t.currEndTime;
        }
      }

      if (matches(t.currRewardStatus, 2)) {
        globalSettlementStatus = true;
      }
    }
  }

  return {
    accruingUsd,
    settlingUsd,
    pendingByToken: Array.from(pendingByToken.entries()).map(([token, amount]) => ({ token, amount })),
    settlementTime,
    globalSettlementStatus,
  };
}

// ── Pending mining periods (claimable rounds) ────────────────────────────────

export interface PendingMiningToken {
  symbol: string;
  tokenAddress: string | null;
  amountRaw: string;     // for contract calls
  amount: string;        // human-readable
  decimals: number;
  priceUsd: number;
}

export interface PendingMiningPeriod {
  periodKey: string;
  merkleIndex: number;
  index: number;
  proof: string[];
  tokens: PendingMiningToken[];
  /** USD sum across the round's tokens, computed with USDD≈$1 and TRX fallback. */
  totalUsd: number;
  claimed?: boolean;
}

const resolveTokenSymbolFromEntry = (
  symbol: string | undefined,
  address: string | undefined,
): string => {
  if (symbol) return symbol;
  // Without a backend symbol or an address, fall back to USDD — front-app
  // matches addresses against config.usdd*; we just default conservatively.
  return address ? "USDD" : "TRX";
};

const priceForSymbol = (symbol: string): number => {
  const norm = normalizeSymbol(symbol);
  if (norm === "USDD") return USDD_PRICE_DEFAULT;
  if (norm === "TRX")  return TRX_PRICE_FALLBACK;
  return 0;
};

const periodFromAirdropRound = (roundKey: string, entry: MoolahAirdropEntry): PendingMiningPeriod => {
  const merkleIndex = Number(entry.merkleIndex ?? roundKey);
  const symbols = toArray<string>(entry.tokenSymbol);
  const addresses = toArray<string>(entry.tokenAddress);
  const amounts = toArray<string>(entry.amount);
  const tokens: PendingMiningToken[] = amounts.map((amt, i) => {
    const symbol = resolveTokenSymbolFromEntry(symbols[i], addresses[i]);
    const amountRaw = hexToDecimal(amt);
    const decimals = decimalsFor(symbol);
    return {
      symbol,
      tokenAddress: addresses[i] ?? null,
      amountRaw,
      amount: shiftDown(amountRaw, decimals),
      decimals,
      priceUsd: priceForSymbol(symbol),
    };
  });
  const totalUsd = tokens.reduce((acc, t) => acc + toFloat(t.amount) * t.priceUsd, 0);
  return {
    periodKey: String(roundKey),
    merkleIndex,
    index: Number(entry.index ?? 0),
    proof: Array.isArray(entry.proof) ? entry.proof : [],
    tokens,
    totalUsd,
    claimed: entry.claimed === true ? true : undefined,
  };
};

export async function getMoolahPendingMiningPeriods(
  address: string,
  options: { includeClaimed?: boolean; network?: string } = {},
): Promise<{ periods: PendingMiningPeriod[]; totalUsd: number }> {
  const { includeClaimed = false, network = "mainnet" } = options;
  const data = await fetchV2UnclaimedAirdrop(address, !includeClaimed, network);
  const periods: PendingMiningPeriod[] = [];
  let totalUsd = 0;
  for (const [roundKey, entry] of Object.entries(data)) {
    if (!entry) continue;
    if (!includeClaimed && entry.claimed === true) continue;
    const period = periodFromAirdropRound(roundKey, entry);
    periods.push(period);
    totalUsd += period.totalUsd;
  }
  return { periods, totalUsd };
}

// ── Claim ────────────────────────────────────────────────────────────────────

const ZERO_BYTES32 = "0".repeat(64);

const isMerkleRootReady = async (
  contractAddress: string,
  merkleIndex: number | string,
  network: string,
): Promise<boolean> => {
  try {
    const result = await readContract(
      {
        address: contractAddress,
        abi: MERKLE_DISTRIBUTOR_V2_ABI,
        functionName: "merkleRoots",
        args: [String(merkleIndex)],
      },
      network,
    );
    const hex = String(result ?? "").replace(/^0x/i, "").toLowerCase();
    return hex.length > 0 && hex !== ZERO_BYTES32;
  } catch {
    return false;
  }
};

const isAlreadyClaimedOnChain = async (
  contractAddress: string,
  merkleIndex: number | string,
  index: number | string,
  network: string,
): Promise<boolean> => {
  try {
    const result = await readContract(
      {
        address: contractAddress,
        abi: MERKLE_DISTRIBUTOR_V2_ABI,
        functionName: "isClaimed",
        args: [String(merkleIndex), String(index)],
      },
      network,
    );
    return Boolean(result);
  } catch {
    return false;
  }
};

export interface ClaimMoolahMiningPeriodResult {
  txID: string;
  periodKey: string;
  merkleIndex: number;
  index: number;
  message: string;
}

/**
 * Submit a multiClaim() call for a single airdrop round on the V2 merkle
 * distributor. Pre-checks isClaimed() and merkleRoots() so the wallet does
 * not pay gas for a guaranteed revert, mirroring useMining.js.
 *
 * Pass either a `periodKey` (resolved from getMoolahPendingMiningPeriods)
 * or the raw merkleIndex / index / amounts / proof tuple if the caller has
 * already obtained them.
 */
export async function claimMoolahMiningPeriod(params: {
  address?: string;            // owner; defaults to signing wallet
  periodKey?: string;          // round key from /v2/getAllUnClaimedAirDrop
  merkleIndex?: number | string;
  index?: number | string;
  amounts?: Array<string | number>;
  proof?: string[];
  network?: string;
}): Promise<ClaimMoolahMiningPeriodResult> {
  const network = params.network ?? "mainnet";
  const addresses = getJustLendAddresses(network);
  const distributor = addresses.merkleDistributorV2;
  if (!distributor) {
    throw new Error(
      `V2 mining distributor is not configured on ${network}. ` +
      `Mainnet contract is pending deployment; nile is supported.`,
    );
  }

  // Resolve claim payload. If the caller did not pass merkle fields directly,
  // refetch the airdrop list and locate the round by periodKey.
  let merkleIndex = params.merkleIndex;
  let index = params.index;
  let amounts = params.amounts;
  let proof = params.proof;
  let periodKey = params.periodKey ?? "";

  if (merkleIndex === undefined || index === undefined || !amounts || !proof) {
    if (!params.periodKey) {
      throw new Error("Either periodKey or full claim fields (merkleIndex, index, amounts, proof) must be provided");
    }
    const tronWeb = await getSigningClient(network);
    const owner = params.address ?? (tronWeb.defaultAddress.base58 as string);
    if (!owner) throw new Error("Wallet not configured — cannot resolve airdrop entries");
    const data = await fetchV2UnclaimedAirdrop(owner, false, network);
    const entry = data[params.periodKey];
    if (!entry) {
      throw new Error(`No airdrop round '${params.periodKey}' found for ${owner}`);
    }
    const period = periodFromAirdropRound(params.periodKey, entry);
    if (period.tokens.length === 0) throw new Error(`Round '${params.periodKey}' has no token amounts`);
    if (period.proof.length === 0) throw new Error(`Round '${params.periodKey}' has no merkle proof — backend may still be indexing`);
    merkleIndex = period.merkleIndex;
    index = period.index;
    amounts = period.tokens.map(t => t.amountRaw);
    proof = period.proof;
    periodKey = period.periodKey;
  }

  if (await isAlreadyClaimedOnChain(distributor, merkleIndex!, index!, network)) {
    throw new Error(
      `Round (merkleIndex=${merkleIndex}, index=${index}) is already claimed on-chain. ` +
      `The backend indexer may still be catching up.`,
    );
  }

  if (!(await isMerkleRootReady(distributor, merkleIndex!, network))) {
    throw new Error(
      `Merkle root for index ${merkleIndex} is not yet published on-chain. Try again after settlement.`,
    );
  }

  const claimTuple = [
    String(merkleIndex),
    String(index),
    (amounts as Array<string | number>).map(a => String(a)),
    proof as string[],
  ];

  const { txID } = await safeSend(
    {
      address: distributor,
      abi: MERKLE_DISTRIBUTOR_V2_ABI,
      functionName: "multiClaim",
      args: [[claimTuple]],
    },
    network,
  );

  return {
    txID,
    periodKey: periodKey || `${merkleIndex}:${index}`,
    merkleIndex: Number(merkleIndex),
    index: Number(index),
    message: `Claimed V2 mining round (merkleIndex=${merkleIndex}, index=${index}). TX: ${txID}`,
  };
}
