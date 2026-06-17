/**
 * JustLend V2 (Moolah) — REST backend API client.
 * Wraps https://zenvora.ablesdxd.link endpoints used by the frontend (V2backend.js).
 * All functions are read-only; no wallet or signing required.
 *
 * Response envelope: { code, data: <payload>, message?, timestamp? }
 * apiGet() unwraps to the payload. For list endpoints, payload shape is nested
 * (e.g. { allVaults: { list, totalCount }, userVaults: {...}, ... }) — individual
 * fetch functions flatten to { list, total, ... } for consumer ergonomics.
 */
import { fetchWithTimeout } from "./http.js";
import { getMoolahApiHost } from "../chains.js";

// ── Token reference ──────────────────────────────────────────────────────────

export interface MoolahTokenRef {
  address: string;
  symbol: string;
  decimal?: number;
  icon?: string;
  name?: string;
}

// ── User: aggregated overview ────────────────────────────────────────────────

export interface MoolahUserPosition {
  totalBorrowUsd?:    string;
  totalCollateralUsd?: string;
  totalSupplyUsd?:    string;
  netEarnApy?:        string;
  netBorrowRate?:     string;
  dailyRevenue?:      string;
  collateralCount?:   number;
  vaults?:            MoolahUserVaultPosition[];
  markets?:           MoolahUserMarketPositionSummary[];
  borrowNew?:         any;
  vaultNew?:          any;
}

export interface MoolahUserVaultPosition {
  vaultAddress:   string;
  vaultName?:     string;
  assetAddress:   string;
  assetSymbol:    string;
  depositAmount?: string;
  depositUsd?:    string;
  shareAmount?:   string;
  apy?:           string;
}

export interface MoolahUserMarketPositionSummary {
  marketId:          string;
  loanSymbol?:       string;
  collateralSymbol?: string;
  borrowAmount?:     string;
  borrowUsd?:        string;
  collateralAmount?: string;
  collateralUsd?:    string;
  risk?:             string;
}

export interface MoolahPositionHistory {
  supplyList?:     MoolahHistoryPoint[];
  borrowList?:     MoolahHistoryPoint[];
  collateralList?: MoolahHistoryPoint[];
}

export interface MoolahHistoryPoint {
  timestamp: number;
  amount?:   string;
  usd?:      string;
}

// ── Vault types ──────────────────────────────────────────────────────────────

export interface MoolahVaultListParams {
  sort?:       string;
  order?:      "asc" | "desc";
  deposit?:    string;
  collateral?: string;
  keyword?:    string;
  page?:       number;
  pageSize?:   number;
  address?:    string;
}

/**
 * Vault entry as returned by the list and info endpoints.
 * NOTE: The two endpoints use different field names for the same vault data —
 * /index/vault/list uses `vaultAddress`/`vaultName`/`assetDecimals` (plural), while
 * /vault/info uses `address`/`name`/`assetDecimal` (singular) and adds `asset` etc.
 * All fields are optional so consumers must tolerate either shape.
 */
export interface MoolahVaultInfo {
  // /index/vault/list fields
  vaultAddress?:    string;
  vaultName?:       string;
  vaultSymbol?:     string;
  assetAddress?:    string;
  assetSymbol?:     string;
  assetName?:       string;
  assetDecimals?:   number;
  totalSupplyAmount?: string;
  performanceFee?:  string;
  collateralTokens?: MoolahTokenRef[];
  markets?:         any[];
  allocations?:     any[];
  // /vault/info fields
  address?:         string;
  name?:            string;
  desc?:            string;
  descEn?:          string;
  descZh?:          string;
  asset?:           string;
  assetDecimal?:    number;
  tvlInUsd?:        string;
  liquidity?:       string;
  liquidityInUsd?:  string;
  shareValue?:      string;
  curator?:         string;
  curatorAddress?:  string;
  fee?:             string;
  feeRecipient?:    string;
  interest?:        string;
  interestInUsd?:   string;
  timelock?:        any;
  createAt?:        any;
  supplyHeadCount?: number;
  icon?:            string;
  tags?:            any[];
  // Fields common to both
  apy?:             string;
  tvl?:             string;
  totalSupply?:     string;
}

export interface MoolahVaultApyHistory {
  timestamps?:    number[];
  apyHistory?:    string[];
  tvlHistory?:    string[];
  supplyHistory?: string[];
  [key: string]:  any;
}

export interface MoolahVaultAllocationItem {
  marketId:         string;
  borrowToken?:     MoolahTokenRef;
  collateralToken?: MoolahTokenRef;
  allocatedAmount?: string;
  allocatedUsd?:    string;
  percent?:         string;
  borrowApy?:       string;
  risk?:            string;
  cap?:             string;
}

export interface MoolahUserVaultBalance {
  depositAmount?: string;
  depositUsd?:    string;
  shareAmount?:   string;
  apy?:           string;
  dailyEarnings?: string;
}

export interface MoolahVaultListResponse {
  list:             MoolahVaultInfo[];
  total:            number;
  userList?:        MoolahVaultInfo[];
  userTotal?:       number;
  depositTokens?:   MoolahTokenRef[];
  collateralTokens?: MoolahTokenRef[];
}

export interface MoolahVaultAllocationResponse {
  list:              MoolahVaultAllocationItem[];
  total:             number;
  remainSupplyCap?:  string;
}

// ── Market types ─────────────────────────────────────────────────────────────

export interface MoolahMarketListParams {
  sort?:          string;
  order?:         "asc" | "desc";
  deposit?:       string;
  collateral?:    string;
  keyword?:       string;
  page?:          number;
  pageSize?:      number;
  userPage?:      number;
  userPageSize?:  number;
  allPage?:       number;
  allPageSize?:   number;
}

/**
 * Market entry. /index/market/list uses `id` as the market ID; /market/marketInfo
 * may expose it as `marketId`. Decimals differ too (`collateralDecimals` plural
 * in list, `collateralDecimal` singular in detail).
 */
export interface MoolahMarketInfo {
  id?:                  string;
  marketId?:            string;
  marketName?:          string;
  loanAddress?:         string;
  loanSymbol?:          string;
  loanDecimal?:         number;
  loanDecimals?:        number;
  loanIcon?:            string;
  borrowAddress?:       string;
  borrowSymbol?:        string;
  borrowDecimal?:       number;
  borrowDecimals?:      number;
  collateralAddress?:   string;
  collateralSymbol?:    string;
  collateralDecimal?:   number;
  collateralDecimals?:  number;
  collateralIcon?:      string;
  borrowPrice?:         string;
  collateralPrice?:     string;
  ltv?:                 string | null;
  lltv?:                string;
  borrowApy?:           string;
  supplyApy?:           string;
  borrowRate?:          string;
  liquidity?:           string;
  liquidityUsd?:        string;
  tvl?:                 string;
  minLoanValue?:        string;
  oracleAddress?:       string;
  interestModeAddress?: string;
  totalBorrowShares?:   string;
  totalBorrowAssets?:   string;
  loanAmount?:          string | null;
  loanUsd?:             string | null;
  collateralAmount?:    string | null;
  collateralUsd?:       string | null;
  risk?:                string | null;
  tags?:                any[];
}

export interface MoolahMarketApyHistory {
  timestamps?:         number[];
  borrowApyHistory?:   string[];
  supplyApyHistory?:   string[];
  liquidityHistory?:   string[];
  tvlHistory?:         string[];
  [key: string]:       any;
}

export interface MoolahUserMarketPositionDetail {
  borrowAmount?:      string;
  borrowUsd?:         string;
  borrowShares?:      string;
  collateralAmount?:  string;
  collateralUsd?:     string;
  borrowAddress?:     string;
  borrowSymbol?:      string;
  collateralAddress?: string;
  collateralSymbol?:  string;
  lltv?:              string;
  risk?:              string;
}

/** Vault supplying liquidity to a market (/market/vault-list entry). */
export interface MoolahMarketSupplyingVault {
  vaultAddress:        string;
  vaultName?:          string;
  assetTokenAddress?:  string;
  assetTokenSymbol?:   string;
  allocationAmount?:   string;
  allocationUsd?:      string;
  allocationPercent?:  string;
  apy?:                string;
}

export interface MoolahMarketListResponse {
  list:       MoolahMarketInfo[];
  total:      number;
  userList?:  MoolahMarketInfo[];
  userTotal?: number;
}

// ── Liquidation types ────────────────────────────────────────────────────────

export interface MoolahLiquidationListParams {
  sort?:         string;
  order?:        "asc" | "desc";
  page?:         number;
  pageSize?:     number;
  minRiskLevel?: number;
  maxRiskLevel?: number;
  debt?:         string;
  collateral?:   string;
}

export interface MoolahPendingLiquidation {
  userAddress:       string;
  marketId:          string;
  debtToken?:        string;
  debtAmount?:       string;
  collateralToken?:  string;
  collateralAmount?: string;
  borrowUsd?:        string;
  collateralUsd?:    string;
  lltv?:             string;
  riskLevel?:        string;
  risk?:             string;
}

export interface MoolahLiquidationRecord {
  txHash:             string;
  timestamp:          number;
  userAddress:        string;
  liquidatorAddress?: string;
  marketId:           string;
  debtToken?:         string;
  debtAmount?:        string;
  collateralToken?:   string;
  collateralAmount?:  string;
  profit?:            string;
  type:               string;   // "public" | "bot"
}

export interface MoolahPendingLiquidationResponse {
  list:        MoolahPendingLiquidation[];
  total:       number;
  updateTime?: number;
}

export interface MoolahLiquidationRecordResponse {
  list:  MoolahLiquidationRecord[];
  total: number;
}

export interface MoolahLiquidationTokenList {
  loanSymbols:       string[];
  collateralSymbols: string[];
}

// ── Transaction records ──────────────────────────────────────────────────────

export interface MoolahTransactionRecord {
  txHash:        string;
  timestamp:     number;
  vaultAddress?: string;
  vaultName?:    string;
  assetAddress?: string;
  assetSymbol?:  string;
  amount?:       string;
  usd?:          string;
  type?:         string;   // "deposit" | "withdraw" | ...
}

export interface MoolahRecordResponse {
  list:  MoolahTransactionRecord[];
  total: number;
}

// ── API helpers ──────────────────────────────────────────────────────────────

async function apiGet<T>(
  path: string,
  params: Record<string, any> = {},
  network = "mainnet",
): Promise<T> {
  const base = getMoolahApiHost(network);
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = qs ? `${base}${path}?${qs}` : `${base}${path}`;

  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`Moolah API ${res.status} ${res.statusText} — ${path}`);
  }

  const json = await res.json();

  // Common envelope: { code, data, message?, timestamp? }
  if (json !== null && typeof json === "object") {
    if (json.data !== undefined)   return json.data as T;
    if (json.result !== undefined) return json.result as T;
  }
  return json as T;
}

// ── User: overview ───────────────────────────────────────────────────────────

/** Aggregated V2 position for a user (vaults + markets combined). */
export async function fetchMoolahUserPosition(
  userAddress: string,
  network = "mainnet",
): Promise<MoolahUserPosition> {
  return apiGet<MoolahUserPosition>("/index/position", { address: userAddress }, network);
}

/** Historical net-worth / supply / borrow curve for a user. */
export async function fetchMoolahUserPositionHistory(
  userAddress: string,
  timeFilter: "ONE_DAY" | "ONE_WEEK" | "ONE_MONTH" = "ONE_DAY",
  network = "mainnet",
): Promise<MoolahPositionHistory> {
  return apiGet<MoolahPositionHistory>(
    "/index/history-records",
    { userAddress, timeFilter },
    network,
  );
}

// ── Vault endpoints ──────────────────────────────────────────────────────────

/**
 * Paginated list of all Moolah vaults plus user-specific vaults if address is provided.
 * Flattens the nested { allVaults: { list, totalCount }, userVaults: {...} } payload
 * into a consumer-friendly { list, total, userList, userTotal, ... } shape.
 */
export async function fetchMoolahVaultList(
  params: MoolahVaultListParams = {},
  network = "mainnet",
): Promise<MoolahVaultListResponse> {
  const raw = await apiGet<any>(
    "/index/vault/list",
    { pageSize: 20, page: 0, ...params },
    network,
  );
  return {
    list:             raw?.allVaults?.list ?? [],
    total:            raw?.allVaults?.totalCount ?? 0,
    userList:         raw?.userVaults?.list ?? [],
    userTotal:        raw?.userVaults?.totalCount ?? 0,
    depositTokens:    raw?.depositTokens ?? [],
    collateralTokens: raw?.collateralTokens ?? [],
  };
}

/** Detailed metadata for a single vault. */
export async function fetchMoolahVaultInfo(
  vaultAddress: string,
  network = "mainnet",
): Promise<MoolahVaultInfo> {
  return apiGet<MoolahVaultInfo>("/vault/info", { address: vaultAddress }, network);
}

/** Historical APY / TVL time series for a vault. */
export async function fetchMoolahVaultApyHistory(
  vaultAddress: string,
  network = "mainnet",
): Promise<MoolahVaultApyHistory> {
  return apiGet<MoolahVaultApyHistory>("/vault/history-data", { vaultAddress }, network);
}

/** Markets the vault allocates funds to, with caps and amounts. */
export async function fetchMoolahVaultAllocation(
  vaultAddress: string,
  params: { sort?: string; order?: "asc" | "desc"; page?: number; pageSize?: number } = {},
  network = "mainnet",
): Promise<MoolahVaultAllocationResponse> {
  const raw = await apiGet<any>(
    "/vault/allocation",
    { address: vaultAddress, pageSize: 20, page: 0, ...params },
    network,
  );
  return {
    list:             raw?.list ?? [],
    total:            raw?.totalCount ?? 0,
    remainSupplyCap:  raw?.remainSupplyCap,
  };
}

/** A specific user's share balance and current asset value in a vault. */
export async function fetchMoolahUserVaultPosition(
  vaultAddress: string,
  userAddress: string,
  network = "mainnet",
): Promise<MoolahUserVaultBalance> {
  return apiGet<MoolahUserVaultBalance>(
    "/vault/position",
    { vaultAddress, address: userAddress },
    network,
  );
}

// ── Market endpoints ─────────────────────────────────────────────────────────

/**
 * Paginated list of all Moolah markets plus user-specific markets if applicable.
 * Flattens { allMarkets, userMarkets, allMarketsCount, userMarketsCount } into
 * a consumer-friendly { list, total, userList, userTotal } shape.
 */
export async function fetchMoolahMarketList(
  params: MoolahMarketListParams = {},
  network = "mainnet",
): Promise<MoolahMarketListResponse> {
  const raw = await apiGet<any>(
    "/index/market/list",
    { pageSize: 20, page: 0, ...params },
    network,
  );
  return {
    list:      raw?.allMarkets ?? [],
    total:     raw?.allMarketsCount ?? 0,
    userList:  raw?.userMarkets ?? [],
    userTotal: raw?.userMarketsCount ?? 0,
  };
}

/** Full metadata for a single market by marketId (bytes32 hex). */
export async function fetchMoolahMarketInfo(
  marketId: string,
  network = "mainnet",
): Promise<MoolahMarketInfo> {
  return apiGet<MoolahMarketInfo>("/market/marketInfo", { marketId }, network);
}

/** Historical borrow/supply APY and liquidity curve for a market. */
export async function fetchMoolahMarketApyHistory(
  marketId: string,
  network = "mainnet",
): Promise<MoolahMarketApyHistory> {
  return apiGet<MoolahMarketApyHistory>("/market/history-data", { marketId }, network);
}

/** Vaults that supply liquidity to a given market. Returns an array directly. */
export async function fetchMoolahMarketVaultList(
  marketId: string,
  network = "mainnet",
): Promise<MoolahMarketSupplyingVault[]> {
  const raw = await apiGet<MoolahMarketSupplyingVault[] | any>(
    "/market/vault-list",
    { marketId },
    network,
  );
  return Array.isArray(raw) ? raw : (raw?.list ?? []);
}

/** A specific user's position in a market (includes risk metrics). */
export async function fetchMoolahUserMarketPosition(
  marketId: string,
  userAddress: string,
  network = "mainnet",
): Promise<MoolahUserMarketPositionDetail> {
  return apiGet<MoolahUserMarketPositionDetail>(
    "/market/position",
    { market: marketId, address: userAddress },
    network,
  );
}

// ── Liquidation endpoints ────────────────────────────────────────────────────

/** Paginated list of positions eligible for liquidation. */
export async function fetchMoolahPendingLiquidations(
  params: MoolahLiquidationListParams = {},
  network = "mainnet",
): Promise<MoolahPendingLiquidationResponse> {
  const raw = await apiGet<any>(
    "/liquidate/pendingLiquidations",
    { pageSize: 20, page: 0, ...params },
    network,
  );
  return {
    list:       raw?.list ?? [],
    total:      raw?.totalCount ?? 0,
    updateTime: raw?.updateTime,
  };
}

/** Historical liquidation events (bot and public liquidators). */
export async function fetchMoolahLiquidationRecords(
  params: {
    type?: "bot" | "public";
    debt?: string;
    collateral?: string;
    page?: number;
    pageSize?: number;
  } = {},
  network = "mainnet",
): Promise<MoolahLiquidationRecordResponse> {
  const raw = await apiGet<any>(
    "/liquidate/records",
    { pageSize: 20, page: 0, ...params },
    network,
  );
  return {
    list:  raw?.list ?? [],
    total: raw?.totalCount ?? 0,
  };
}

/** List of loan / collateral token symbols available across pending liquidations. */
export async function fetchMoolahLiquidationTokenList(
  network = "mainnet",
): Promise<MoolahLiquidationTokenList> {
  const raw = await apiGet<MoolahLiquidationTokenList>("/liquidate/tokenList", {}, network);
  return {
    loanSymbols:       raw?.loanSymbols ?? [],
    collateralSymbols: raw?.collateralSymbols ?? [],
  };
}

// ── Transaction record endpoint ──────────────────────────────────────────────

/** A user's V2 transaction history (deposit, withdraw, borrow, repay, etc.). */
export async function fetchMoolahUserRecords(
  userAddress: string,
  params: { pageNo?: number; pageSize?: number } = {},
  network = "mainnet",
): Promise<MoolahRecordResponse> {
  const raw = await apiGet<any>(
    "/record/lend",
    { address: userAddress, pageNo: 1, pageSize: 20, ...params },
    network,
  );
  return {
    list:  raw?.list ?? [],
    total: raw?.totalCount ?? 0,
  };
}

// ── V2 mining endpoints ──────────────────────────────────────────────────────
// Mirror the /v2/tronbull, /v2/tronbullish, and /v2/getAllUnClaimedAirDrop
// endpoints used by useMining.js in the front-app.

/** Per-token APY entry for a vault in /v2/tronbull. */
export interface MoolahMiningRateEntry {
  USDDNEW?: string;
  TRXNEW?:  string;
  [extra: string]: any;
}

/** Per-token accruing/settling state for a vault in /v2/tronbullish. */
export interface MoolahMiningTokenState {
  gainNew?:           string;
  gainLast?:          string;
  price?:             number | string;
  miningStatus?:      number;        // 1=ongoing, 2=settling, 3=ended
  currRewardStatus?:  number | string;
  currEndTime?:       string;
  [extra: string]: any;
}
export type MoolahMiningPoolState = Record<string, MoolahMiningTokenState>;

/** Round-keyed unclaimed merkle airdrop entry from /v2/getAllUnClaimedAirDrop. */
export interface MoolahAirdropEntry {
  merkleIndex?:   number;
  index?:         number;
  amount?:        string | string[];
  tokenSymbol?:   string | string[];
  tokenAddress?:  string | string[];
  proof?:         string[];
  claimed?:       boolean;
  [extra: string]: any;
}

const joinList = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v.join(",") : v;

/**
 * Fetch vault mining APY rates. Pass a pool address (or list) to scope the
 * response; omit both args to receive the full vault → entry map (used by the
 * dashboard resolver path).
 */
export async function fetchV2VaultMiningRates(
  pools?: string | string[],
  tvls?:  string | string[],
  network = "mainnet",
): Promise<Record<string, MoolahMiningRateEntry>> {
  const params: Record<string, any> = {};
  if (pools !== undefined) params.pool = joinList(pools);
  if (tvls  !== undefined) params.tvl  = joinList(tvls);
  const raw = await apiGet<any>("/v2/tronbull", params, network);
  return raw ?? {};
}

/**
 * Fetch a user's accruing / settling mining rewards across vaults. Omit
 * pools to fetch every vault the user has activity in.
 */
export async function fetchV2UserMiningState(
  address: string,
  pools?: string | string[],
  network = "mainnet",
): Promise<Record<string, MoolahMiningPoolState>> {
  const params: Record<string, any> = { addr: address };
  if (pools !== undefined) params.pool = joinList(pools);
  const raw = await apiGet<any>("/v2/tronbullish", params, network);
  return raw ?? {};
}

/**
 * Fetch the user's V2 merkle airdrop rounds. Default `getUnclaimedOnly = true`
 * matches the front-app behaviour for the rewards card.
 */
export async function fetchV2UnclaimedAirdrop(
  address: string,
  getUnclaimedOnly: boolean = true,
  network = "mainnet",
): Promise<Record<string, MoolahAirdropEntry>> {
  const raw = await apiGet<any>(
    "/v2/getAllUnClaimedAirDrop",
    { addr: address, getUnclaimedOnly },
    network,
  );
  return raw ?? {};
}
