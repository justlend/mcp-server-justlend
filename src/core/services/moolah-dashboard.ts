/**
 * JustLend V2 (Moolah) — Dashboard aggregation helpers.
 * Combines backend API data for overview and history views.
 */
import {
  fetchMoolahVaultList,
  fetchMoolahMarketList,
  fetchMoolahUserPosition,
  fetchMoolahUserPositionHistory,
  fetchMoolahVaultApyHistory,
  fetchMoolahMarketApyHistory,
} from "./moolah-backend.js";
import type {
  MoolahUserPosition,
  MoolahVaultInfo,
  MoolahMarketInfo,
  MoolahPositionHistory,
  MoolahVaultApyHistory,
  MoolahMarketApyHistory,
} from "./moolah-backend.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MoolahDashboard {
  vaults: MoolahVaultInfo[];
  markets: MoolahMarketInfo[];
  totalVaults: number;
  totalMarkets: number;
}

export interface MoolahUserSummary {
  position: MoolahUserPosition;
  history: MoolahPositionHistory;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

/**
 * Returns top vaults and markets for a protocol overview.
 * Sorted by TVL (backend default) and capped at pageSize each.
 */
export async function getMoolahDashboard(params: {
  vaultPageSize?: number;
  marketPageSize?: number;
  depositToken?: string;
  collateralToken?: string;
  network?: string;
} = {}): Promise<MoolahDashboard> {
  const {
    vaultPageSize = 10,
    marketPageSize = 10,
    depositToken,
    collateralToken,
    network = "mainnet",
  } = params;

  const [vaultRes, marketRes] = await Promise.all([
    fetchMoolahVaultList({ pageSize: vaultPageSize, deposit: depositToken }, network),
    fetchMoolahMarketList({ pageSize: marketPageSize, deposit: depositToken, collateral: collateralToken }, network),
  ]);

  // The /index/market/list endpoint ignores pageSize; enforce the cap client-side
  // so consumers get a predictable bound.
  return {
    vaults: (vaultRes.list ?? []).slice(0, vaultPageSize),
    markets: (marketRes.list ?? []).slice(0, marketPageSize),
    totalVaults: vaultRes.total ?? 0,
    totalMarkets: marketRes.total ?? 0,
  };
}

// ── User Summary ──────────────────────────────────────────────────────────────

/**
 * Returns a user's aggregated Moolah V2 position + optional history.
 */
export async function getMoolahUserSummary(params: {
  userAddress: string;
  timeFilter?: "ONE_DAY" | "ONE_WEEK" | "ONE_MONTH";
  network?: string;
}): Promise<MoolahUserSummary> {
  const { userAddress, timeFilter = "ONE_WEEK", network = "mainnet" } = params;

  const [position, history] = await Promise.all([
    fetchMoolahUserPosition(userAddress, network),
    fetchMoolahUserPositionHistory(userAddress, timeFilter, network),
  ]);

  return { position, history };
}

// ── APY History ───────────────────────────────────────────────────────────────

/** Fetch vault APY history for a given vault address. */
export async function getMoolahVaultHistory(params: {
  vaultAddress: string;
  network?: string;
}): Promise<MoolahVaultApyHistory> {
  return fetchMoolahVaultApyHistory(params.vaultAddress, params.network ?? "mainnet");
}

/** Fetch market APY / utilization history for a given marketId. */
export async function getMoolahMarketHistory(params: {
  marketId: string;
  network?: string;
}): Promise<MoolahMarketApyHistory> {
  return fetchMoolahMarketApyHistory(params.marketId, params.network ?? "mainnet");
}
