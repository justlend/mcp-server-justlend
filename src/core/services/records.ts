/**
 * JustLend — V1 user history records (paginated REST API).
 * Host: https://labc.ablesdxd.link (mainnet only — these endpoints do not exist on nile).
 *
 * All endpoints share the shape:
 *   { code: 0, data: { items, pageNum, pageSize, totalCount, [unReadCount] } }
 */
import { fetchWithTimeout } from "./http.js";
import { utils } from "./utils.js";

const LABC_HOST = "https://labc.ablesdxd.link";

/** Reject malformed addresses before building a records URL (defense-in-depth; tool layer also validates). */
function requireValidAddress(addr: string): void {
  if (!utils.isAddress(addr)) {
    throw new Error(`Invalid TRON address: ${addr}`);
  }
}

// ── Shared envelope ──────────────────────────────────────────────────────────

export interface RecordsPage<T> {
  items:       T[];
  pageNum:     number;
  pageSize:    number;
  totalCount:  number;
  unReadCount?: number;    // only present on /record/liquidate
}

async function fetchRecords<T>(
  path: string,
  addr: string,
  page: number,
  pageSize: number,
): Promise<RecordsPage<T>> {
  requireValidAddress(addr);
  const url = `${LABC_HOST}${path}?addr=${encodeURIComponent(addr)}&page=${page}&pageSize=${pageSize}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`Records API ${res.status} ${res.statusText} — ${path}`);
  }
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(`Records API returned code ${json.code}${json.message ? ": " + json.message : ""} — ${path}`);
  }
  const data = json.data ?? {};
  return {
    items:       data.items ?? [],
    pageNum:     data.pageNum ?? page,
    pageSize:    data.pageSize ?? pageSize,
    totalCount:  data.totalCount ?? 0,
    unReadCount: data.unReadCount,
  };
}

function requireMainnet(network: string): void {
  const n = network.toLowerCase();
  if (n !== "mainnet" && n !== "tron" && n !== "trx") {
    throw new Error(`V1 record endpoints are only available on mainnet (requested: ${network}).`);
  }
}

// ── V1 Lending: /justlend/record/depositBorrow ───────────────────────────────

/**
 * Action type codes from the /depositBorrow endpoint.
 * 1 supply, 2 withdraw, 3 borrow, 4 repay,
 * 5 liquidation_reward, 6 liquidator_repay,
 * 7 receive_jtoken, 8 send_jtoken,
 * 9 approve, 10 enable_collateral, 11 disable_collateral
 */
export const LENDING_ACTION_TYPES: Record<string, string> = {
  "1":  "supply",
  "2":  "withdraw",
  "3":  "borrow",
  "4":  "repay",
  "5":  "liquidation_reward",
  "6":  "liquidator_repay",
  "7":  "receive_jtoken",
  "8":  "send_jtoken",
  "9":  "approve",
  "10": "enable_collateral",
  "11": "disable_collateral",
};

export interface LendingRecord {
  id?:              string;
  blockTimestamp:   number;    // milliseconds
  actionType:       string;    // "1".."11"
  actionName?:      string;    // populated client-side via LENDING_ACTION_TYPES
  tokenAmount:      string;
  jtokenAmount?:    string;
  associateUsd?:    string;
  symbol:           string;
  status:           number;
  txId:             string;
}

export async function fetchLendingRecords(
  address: string,
  page = 1,
  pageSize = 20,
  network = "mainnet",
): Promise<RecordsPage<LendingRecord>> {
  requireMainnet(network);
  const raw = await fetchRecords<LendingRecord>("/justlend/record/depositBorrow", address, page, pageSize);
  // Enrich actionName for human readability
  raw.items = raw.items.map((r) => ({ ...r, actionName: LENDING_ACTION_TYPES[r.actionType] ?? `unknown(${r.actionType})` }));
  return raw;
}

// ── sTRX: /justlend/record/strx ──────────────────────────────────────────────

/** 1 stake, 2 unstake, 4 withdraw (after unbond), 5 send_strx, 6 receive_strx */
export const STRX_OP_TYPES: Record<string, string> = {
  "1": "stake",
  "2": "unstake",
  "4": "withdraw",
  "5": "send_strx",
  "6": "receive_strx",
};

export interface StrxRecord {
  blockTimestamp: number;
  opType:         string;
  opName?:        string;
  amount:         string;
  usd?:           string;
  status:         number;
  txId:           string;
}

export async function fetchStrxRecords(
  address: string,
  page = 1,
  pageSize = 20,
  network = "mainnet",
): Promise<RecordsPage<StrxRecord>> {
  requireMainnet(network);
  const raw = await fetchRecords<StrxRecord>("/justlend/record/strx", address, page, pageSize);
  raw.items = raw.items.map((r) => ({ ...r, opName: STRX_OP_TYPES[r.opType] ?? `unknown(${r.opType})` }));
  return raw;
}

// ── Vote: /justlend/record/vote ──────────────────────────────────────────────

/**
 * 1 get_vote (JST → WJST deposit), 2 vote_for, 3 vote_against,
 * 4 withdraw_votes (after proposal completed), 5/6 convert WJST back to JST.
 */
export const VOTE_OP_TYPES: Record<string, string> = {
  "1": "get_vote",
  "2": "vote_for",
  "3": "vote_against",
  "4": "withdraw_votes",
  "5": "convert_back_invalid",
  "6": "convert_back_other",
};

export interface VoteRecord {
  blockTimestamp: number;
  opType:         string;
  opName?:        string;
  amount:         string;
  proposalId?:    number;   // only present for opType 2/3/4
  status:         number;
  txId:           string;
}

export async function fetchVoteRecords(
  address: string,
  page = 1,
  pageSize = 20,
  network = "mainnet",
): Promise<RecordsPage<VoteRecord>> {
  requireMainnet(network);
  const raw = await fetchRecords<VoteRecord>("/justlend/record/vote", address, page, pageSize);
  raw.items = raw.items.map((r) => ({ ...r, opName: VOTE_OP_TYPES[r.opType] ?? `unknown(${r.opType})` }));
  return raw;
}

// ── Energy Rental: /justlend/record/rent ─────────────────────────────────────

/** 1 rent, 2 extend, 3 rent_more, 4 end, 5 recycle */
export const RENT_ACTION_TYPES: Record<string, string> = {
  "1": "rent",
  "2": "extend",
  "3": "rent_more",
  "4": "end",
  "5": "recycle",
};

export interface EnergyRentalRecord {
  blockTimestamp:  number;
  actionType:      string;
  actionName?:     string;
  renter?:         string;
  receiver?:       string;
  amount?:         string;
  status?:         number;
  txId?:           string;
  [extra: string]: any;
}

export async function fetchEnergyRentalRecords(
  address: string,
  page = 1,
  pageSize = 20,
  network = "mainnet",
): Promise<RecordsPage<EnergyRentalRecord>> {
  requireMainnet(network);
  const raw = await fetchRecords<EnergyRentalRecord>("/justlend/record/rent", address, page, pageSize);
  raw.items = raw.items.map((r) => ({ ...r, actionName: RENT_ACTION_TYPES[r.actionType] ?? `unknown(${r.actionType})` }));
  return raw;
}

// ── Liquidation: /justlend/record/liquidate (V1) ─────────────────────────────

export interface LiquidationRecord {
  blockTimestamp:  number;
  actionType?:     string;
  liquidator?:     string;
  borrower?:       string;
  repaySymbol?:    string;
  repayAmount?:    string;
  seizeSymbol?:    string;
  seizeAmount?:    string;
  usd?:            string;
  status?:         number;
  txId?:           string;
  [extra: string]: any;
}

export async function fetchLiquidationRecords(
  address: string,
  page = 1,
  pageSize = 20,
  network = "mainnet",
): Promise<RecordsPage<LiquidationRecord>> {
  requireMainnet(network);
  return fetchRecords<LiquidationRecord>("/justlend/record/liquidate", address, page, pageSize);
}

// ── Merkle airdrop rewards (read-only) ───────────────────────────────────────

/**
 * Per-distributor claimable airdrop entry. Shape is lenient because the live
 * endpoint's full schema (including whether merkle proofs ship with the
 * response) can only be verified against an address that actually has
 * rewards — we keep indexing by merkle index so callers can feed the raw
 * data into multiClaim() once the proof fields are confirmed.
 */
export interface ClaimableReward {
  amount?:         string | string[];
  tokenSymbol?:    string | string[];
  tokenAddress?:   string | string[];
  index?:          number;
  merkleIndex?:    number;
  merkleProof?:    string[];
  [extra: string]: any;
}

export interface ClaimableRewardsResponse {
  merkleRewards:       Record<string, ClaimableReward>;
  rawResponse:         any;   // unmodified body for callers that want everything
}

export async function fetchClaimableRewards(
  address: string,
  network = "mainnet",
): Promise<ClaimableRewardsResponse> {
  requireMainnet(network);
  requireValidAddress(address);
  const url = `${LABC_HOST}/sunProject/getAllUnClaimedAirDrop?addr=${encodeURIComponent(address)}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Rewards API ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(`Rewards API returned code ${json.code}${json.message ? ": " + json.message : ""}`);
  }
  const data = json.data ?? {};
  return { merkleRewards: data, rawResponse: data };
}
