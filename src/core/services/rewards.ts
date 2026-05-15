/**
 * JustLend V1 Mining Rewards
 *
 * VERSION: JustLend V1
 * All mining reward calculations are for JustLend V1 protocol.
 *
 * Handles mining rewards for supply markets (USDD, WBTC, etc.)
 * Based on JustLend's merkle distributor system.
 *
 * Reward calculation logic matches justlend-app's helper.jsx getGainNewAndOldForMarkets function.
 * - Separates new period (gainNew) and last period (gainLast) rewards
 * - Supports dual-token mining (e.g., USDD + TRX)
 * - Handles mining status (1=ongoing, 2=paused, 3=ended)
 */

import { getJustLendAddresses, getApiHost } from "../chains.js";
import { getJTokenDetailsFromAPI } from "./markets.js";
import { fetchWithTimeout } from "./http.js";
import { safeSend } from "./contracts.js";
import { getSigningClient } from "./wallet.js";
import { fetchClaimableRewards, type ClaimableReward } from "./records.js";

// V1 merkle distributor ABIs.
//
// Two selectors exist for multiClaim — front-app's Reward.jsx routes between
// them based on whether the airdrop entry's `amount` is an array:
//   • single-token leaves (main + USDDNEW): (uint256,uint256,uint256,bytes32[])[]
//   • multi-token leaves  (multiMerkleDistributor): (uint256,uint256,uint256[],bytes32[])[]
// safeSend can't disambiguate two functions with the same name and arity, so
// we keep one ABI per selector.

const V1_SINGLE_CLAIM_TUPLE = [
  { name: "merkleIndex", type: "uint256" },
  { name: "index",       type: "uint256" },
  { name: "amount",      type: "uint256" },
  { name: "merkleProof", type: "bytes32[]" },
];

const V1_MULTI_CLAIM_TUPLE = [
  { name: "merkleIndex", type: "uint256"   },
  { name: "index",       type: "uint256"   },
  { name: "amounts",     type: "uint256[]" },
  { name: "merkleProof", type: "bytes32[]" },
];

const V1_SINGLE_DISTRIBUTOR_ABI = [
  {
    type: "function", name: "multiClaim", stateMutability: "nonpayable",
    inputs: [{ name: "claims", type: "tuple[]", components: V1_SINGLE_CLAIM_TUPLE }],
    outputs: [],
  },
  {
    type: "function", name: "isClaimed", stateMutability: "view",
    inputs: [
      { name: "merkleIndex", type: "uint256" },
      { name: "index",       type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
];

const V1_MULTI_DISTRIBUTOR_ABI = [
  {
    type: "function", name: "multiClaim", stateMutability: "nonpayable",
    inputs: [{ name: "claims", type: "tuple[]", components: V1_MULTI_CLAIM_TUPLE }],
    outputs: [],
  },
  {
    type: "function", name: "isClaimed", stateMutability: "view",
    inputs: [
      { name: "merkleIndex", type: "uint256" },
      { name: "index",       type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
];

/**
 * Mining reward types supported by JustLend
 */
export enum RewardType {
  USDD = "USDD",
  TRX = "TRX",
  WBTC = "WBTC",
  SUN = "SUN",
}

export interface RewardBreakdown {
  /** Reward token symbol (e.g., "USDD", "TRX") */
  symbol: string;
  /** New period reward amount */
  amountNew: string;
  /** Last period reward amount */
  amountLast: string;
  /** Total amount in this token */
  totalAmount: string;
  /** Token price in USD */
  price: string;
  /** Total value in USD */
  valueUSD: string;
}

export interface MarketMiningReward {
  /** jToken address */
  jTokenAddress: string;
  /** Market symbol (e.g., "USDD", "WBTC") */
  marketSymbol: string;
  /** New period rewards in USD */
  gainNewUSD: string;
  /** Last period rewards in USD */
  gainLastUSD: string;
  /** Total rewards in USD */
  totalUSD: string;
  /** Breakdown by reward token */
  breakdown: Record<string, RewardBreakdown>;
  /** Mining status: 1=ongoing, 2=paused, 3=ended */
  miningStatus: number;
  /** Current period end time */
  currEndTime: string;
  /** Last period end time */
  lastEndTime: string;
}

export interface AllMiningRewards {
  /** User address */
  address: string;
  /** Network */
  network: string;
  /** Total new period rewards in USD */
  totalGainNewUSD: string;
  /** Total last period rewards in USD */
  totalGainLastUSD: string;
  /** Total unclaimed rewards in USD */
  totalUnclaimedUSD: string;
  /** Rewards by market */
  markets: MarketMiningReward[];
  /** Raw API data for reference */
  rawData?: any;
}

/**
 * Calculate mining rewards from API data (V1 calculation logic).
 *
 * VERSION: V1 - Based on justlend-app's getGainNewAndOldForMarkets logic from helper.jsx
 * This function replicates the exact V1 mining reward calculation algorithm.
 */
function calculateMiningRewards(apiData: any, address: string, network: string): AllMiningRewards {
  const assetList = apiData.assetList || [];
  let totalGainNewUSD = 0;
  let totalGainLastUSD = 0;
  const markets: MarketMiningReward[] = [];

  // Process each market's mining data
  assetList.forEach((asset: any) => {
    if (!asset.miningInfo) return;

    const marketReward: MarketMiningReward = {
      jTokenAddress: asset.jtokenAddress || "",
      marketSymbol: asset.collateralSymbol || "",
      gainNewUSD: "0",
      gainLastUSD: "0",
      totalUSD: "0",
      breakdown: {},
      miningStatus: 1,
      currEndTime: "",
      lastEndTime: "",
    };

    let marketGainNew = 0;
    let marketGainLast = 0;

    // Process each reward token (USDD, TRX, etc.)
    Object.keys(asset.miningInfo).forEach((key) => {
      const rewardItem = asset.miningInfo[key];
      if (!rewardItem || typeof rewardItem !== 'object') return;

      const symbol = key.replace('NEW', '');
      if (symbol === 'NFT') return; // Skip NFT rewards as per app logic

      const price = parseFloat(rewardItem.price || 0);
      const gainNew = parseFloat(rewardItem.gainNew || 0);
      // miningStatus == 3 means ended, so gainLast should be 0
      const gainLast = rewardItem.miningStatus == 3 ? 0 : parseFloat(rewardItem.gainLast || 0);

      if (gainNew === 0 && gainLast === 0) return;

      const gainNewUSD = gainNew * price;
      const gainLastUSD = gainLast * price;

      marketGainNew += gainNewUSD;
      marketGainLast += gainLastUSD;

      marketReward.breakdown[symbol] = {
        symbol,
        amountNew: gainNew.toString(),
        amountLast: gainLast.toString(),
        totalAmount: (gainNew + gainLast).toString(),
        price: price.toString(),
        valueUSD: (gainNewUSD + gainLastUSD).toString(),
      };

      // Update mining status and times from main token (USDD) or first valid token
      if (key === 'USDDNEW' || !marketReward.currEndTime) {
        marketReward.miningStatus = rewardItem.miningStatus || 1;
        marketReward.currEndTime = rewardItem.currEndTime || "";
        marketReward.lastEndTime = rewardItem.lastEndTime || "";
      }
    });

    marketReward.gainNewUSD = marketGainNew.toString();
    marketReward.gainLastUSD = marketGainLast.toString();
    marketReward.totalUSD = (marketGainNew + marketGainLast).toString();

    totalGainNewUSD += marketGainNew;
    totalGainLastUSD += marketGainLast;

    if (marketGainNew > 0 || marketGainLast > 0) {
      markets.push(marketReward);
    }
  });

  return {
    address,
    network,
    totalGainNewUSD: totalGainNewUSD.toString(),
    totalGainLastUSD: totalGainLastUSD.toString(),
    totalUnclaimedUSD: (totalGainNewUSD + totalGainLastUSD).toString(),
    markets,
    rawData: apiData,
  };
}

/**
 * Get mining rewards from JustLend V1 API.
 *
 * VERSION: V1 - Queries JustLend V1 API and calculates V1 mining rewards
 * The API provides comprehensive mining reward data including USDD and WBTC rewards.
 * Calculates rewards using same logic as justlend-app's helper.jsx getGainNewAndOldForMarkets.
 */
export async function getMiningRewardsFromAPI(address: string, network = "mainnet"): Promise<AllMiningRewards> {
  const host = getApiHost(network);
  const url = `${host}/justlend/account?addr=${encodeURIComponent(address)}`;

  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();

    if (data.code !== 0) {
      throw new Error(`API returned error code: ${data.code}`);
    }

    // Calculate mining rewards from API data
    return calculateMiningRewards(data.data, address, network);
  } catch (error) {
    // Nile testnet has no live rewards backend, and merkle-distributor amounts
    // require off-chain proofs we can't reconstruct on-chain. Degrade gracefully
    // to a zero-amount snapshot with a clear note, mirroring get_strx_account's
    // contract-mode fallback when the API is down.
    if (network === "nile") {
      const apiError = error instanceof Error ? error.message : String(error);
      return {
        address,
        network,
        totalGainNewUSD: "0",
        totalGainLastUSD: "0",
        totalUnclaimedUSD: "0",
        markets: [],
        rawData: {
          source: "contract",
          note: "Mining rewards API is not available on Nile testnet, and merkle-distributor amounts require off-chain proofs. Returning zero-amount snapshot.",
          apiError,
        },
      };
    }
    throw new Error(`Failed to fetch mining rewards from API: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ── V1 merkle airdrop claim ─────────────────────────────────────────────────
//
// /sunProject/getAllUnClaimedAirDrop returns a map keyed per round; each entry
// carries either a single-token reward (amount: string, tokenAddress: string)
// or a multi-token reward (amount: string[], tokenAddress: string[]).
// Front-app's Reward.jsx routes claims like this:
//   • amount is array        → multiMerkleDistributor + array-amount selector
//   • amount single + USDD   → merkleDistributorNEWUSDD (USDDNEW distributor)
//   • amount single + other  → main merkleDistributor
// All paths submit multiClaim() with a single-leaf array. We mirror that.

export type V1DistributorType = "main" | "usdd-new" | "multi";

export interface V1ClaimRoute {
  distributor: string;
  type:        V1DistributorType;
  selector:    "single" | "multi";
}

const toArray = <T>(v: T | T[] | undefined | null): T[] =>
  Array.isArray(v) ? v : v == null ? [] : [v];

/**
 * Decide which distributor + selector to use for a V1 airdrop entry,
 * mirroring the routing logic in front-app's Reward.jsx.
 */
export function routeV1ClaimEntry(
  entry: ClaimableReward,
  network = "mainnet",
): V1ClaimRoute {
  const addresses = getJustLendAddresses(network);
  const isMultiToken = Array.isArray(entry.amount);
  if (isMultiToken) {
    const distributor = addresses.merkleDistributors.multi;
    if (!distributor) throw new Error(`V1 multi merkle distributor not configured on ${network}`);
    return { distributor, type: "multi", selector: "multi" };
  }

  // The redeployed USDDNEW distributor (chains.ts: merkleDistributors.usdd)
  // handles the live USDD token. Match by tokenAddress against the USDD
  // jToken's underlying when available, falling back to symbol when the
  // backend omits the address. The symbol-only path tolerates "USDD",
  // "USDDNEW", and "USDDOLD" — front-app's filterReward labels old/new
  // similarly when the symbol is absent.
  const tokenAddr = toArray<string>(entry.tokenAddress)[0] ?? null;
  const tokenSymbol = toArray<string>(entry.tokenSymbol)[0] ?? "";
  const usddUnderlying = addresses.jTokens["jUSDD"]?.underlying ?? null;
  const looksLikeUsdd =
    (tokenAddr && usddUnderlying && tokenAddr === usddUnderlying) ||
    tokenSymbol === "USDD" || tokenSymbol === "USDDNEW";

  if (looksLikeUsdd) {
    const distributor = addresses.merkleDistributors.usdd;
    if (!distributor) throw new Error(`V1 USDD merkle distributor not configured on ${network}`);
    return { distributor, type: "usdd-new", selector: "single" };
  }

  const distributor = addresses.merkleDistributors.main;
  if (!distributor) throw new Error(`V1 main merkle distributor not configured on ${network}`);
  return { distributor, type: "main", selector: "single" };
}

const normalizeAmount = (amount: ClaimableReward["amount"]): string | string[] => {
  if (Array.isArray(amount)) return amount.map(a => String(a));
  return String(amount ?? "0");
};

const normalizeProof = (entry: ClaimableReward): string[] => {
  if (Array.isArray(entry.merkleProof)) return entry.merkleProof;
  if (Array.isArray((entry as any).proof)) return (entry as any).proof;
  return [];
};

export interface ClaimV1MiningPeriodResult {
  txID:        string;
  key:         string;
  distributor: string;
  type:        V1DistributorType;
  message:     string;
}

/**
 * Submit multiClaim() for a single V1 airdrop round. Either pass `key`
 * (resolved from get_claimable_rewards) or supply the raw fields directly.
 *
 * Mirrors the front-app routing exactly: amount-shape decides whether to use
 * the single-token or multi-token selector and which distributor receives
 * the call.
 */
export async function claimV1MiningPeriod(params: {
  address?:    string;
  key?:        string;                  // round key from /sunProject/getAllUnClaimedAirDrop
  merkleIndex?: number | string;
  index?:       number | string;
  amount?:      string | number | Array<string | number>;
  tokenAddress?: string | string[];
  tokenSymbol?:  string | string[];
  proof?:       string[];
  distributor?: string;                 // explicit override
  selector?:    "single" | "multi";     // explicit override
  network?:     string;
}): Promise<ClaimV1MiningPeriodResult> {
  const network = params.network ?? "mainnet";

  let merkleIndex = params.merkleIndex;
  let index = params.index;
  let amount: string | string[] | undefined =
    params.amount === undefined ? undefined :
    Array.isArray(params.amount) ? params.amount.map(a => String(a)) : String(params.amount);
  let proof = params.proof;
  let tokenAddress = params.tokenAddress;
  let tokenSymbol = params.tokenSymbol;
  let key = params.key ?? "";

  if (merkleIndex === undefined || index === undefined || amount === undefined || !proof) {
    if (!params.key) {
      throw new Error("Either key or full claim fields (merkleIndex, index, amount, proof) must be provided");
    }
    const tronWeb = await getSigningClient(network);
    const owner = params.address ?? (tronWeb.defaultAddress.base58 as string);
    if (!owner) throw new Error("Wallet not configured — cannot resolve airdrop entries");
    const { merkleRewards } = await fetchClaimableRewards(owner, network);
    const entry = merkleRewards?.[params.key];
    if (!entry) {
      throw new Error(`No claimable airdrop entry '${params.key}' found for ${owner}`);
    }
    merkleIndex = entry.merkleIndex ?? merkleIndex;
    index = entry.index ?? index;
    amount = normalizeAmount(entry.amount);
    proof = normalizeProof(entry);
    tokenAddress = entry.tokenAddress;
    tokenSymbol = entry.tokenSymbol;
    key = params.key;
  }

  if (proof.length === 0) {
    throw new Error(`Airdrop entry has no merkle proof — backend may still be indexing`);
  }
  if (merkleIndex === undefined || index === undefined) {
    throw new Error("Airdrop entry is missing merkleIndex / index");
  }

  // Resolve distributor + selector. Explicit overrides win; otherwise route
  // from the entry shape using the same rules as front-app's Reward.jsx.
  let route: V1ClaimRoute;
  if (params.distributor && params.selector) {
    route = { distributor: params.distributor, type: "main", selector: params.selector };
  } else {
    route = routeV1ClaimEntry({ amount, tokenAddress, tokenSymbol, merkleProof: proof, index: Number(index), merkleIndex: Number(merkleIndex) }, network);
  }

  // Build the multiClaim payload. Single-amount selector wants a uint256;
  // multi-amount wants a uint256[]. The wrapping array carries one leaf —
  // batched claims belong to a separate code path callers can build later.
  const amountArg: string | string[] = route.selector === "multi"
    ? toArray<string>(amount).map(a => String(a))
    : (Array.isArray(amount) ? String(amount[0]) : String(amount));

  const claimTuple = [String(merkleIndex), String(index), amountArg, proof];

  const abi = route.selector === "multi" ? V1_MULTI_DISTRIBUTOR_ABI : V1_SINGLE_DISTRIBUTOR_ABI;
  const { txID } = await safeSend(
    {
      address: route.distributor,
      abi,
      functionName: "multiClaim",
      args: [[claimTuple]],
    },
    network,
  );

  return {
    txID,
    key: key || `${merkleIndex}:${index}`,
    distributor: route.distributor,
    type: route.type,
    message: `Claimed V1 mining round (${route.type}, merkleIndex=${merkleIndex}, index=${index}). TX: ${txID}`,
  };
}

/**
 * Get USDD V1 mining configuration.
 *
 * VERSION: V1 - JustLend V1 USDD mining program configuration
 * USDD has special mining periods with different reward tokens (single vs dual-token mining).
 */
export async function getUSDDMiningConfig(network = "mainnet") {
  const addresses = getJustLendAddresses(network);
  const jUsddAddress = addresses.jTokens["jUSDD"]?.address; // jUSDD specifically

  if (!jUsddAddress) {
    throw new Error("jUSDD market not found in configuration for network: " + network);
  }

  try {
    const detail = await getJTokenDetailsFromAPI(jUsddAddress, network);
    if (!detail) throw new Error("API returned no data");

    const usddReward = parseFloat(detail.farmRewardUsddAmount24h || "0");
    const trxReward = parseFloat(detail.farmRewardTrxAmount24h || "0");
    const totalUsdReward = parseFloat(detail.farmRewardUSD24h || "0");
    const apy = parseFloat(detail.farmApy || "0") * 100;

    const activeTokens = [];
    if (usddReward > 0) activeTokens.push("USDD");
    if (trxReward > 0) activeTokens.push("TRX");

    return {
      jToken: jUsddAddress,
      isDualMiningActive: usddReward > 0 && trxReward > 0,
      activeRewardTokens: activeTokens,
      dailyRewardUSDD: usddReward,
      dailyRewardTRX: trxReward,
      dailyTotalMiningRewardUSD: totalUsdReward,
      miningAPY: `${apy.toFixed(4)}%`,
      statusDescription: activeTokens.length > 1
        ? "Dual-token mining is currently ACTIVE."
        : activeTokens.length === 1
          ? `Single-token mining (${activeTokens[0]}) is currently ACTIVE. Dual-mining has ended.`
          : "USDD mining rewards have ended or are currently paused."
    };
  } catch (error) {
    // Fallback if API fails
    return {
      statusDescription: "Failed to fetch live mining config, assuming dual-mining has ended.",
      isDualMiningActive: false,
      activeRewardTokens: ["USDD"],
    };
  }
}

/**
 * Get WBTC V1 mining configuration.
 *
 * VERSION: V1 - JustLend V1 WBTC market supply mining activity
 */
export function getWBTCMiningConfig() {
  return {
    jToken: "TVyvpmaVmz25z2GaXBDDjzLZi5iR5dBzGd", // jWBTC
    rewardToken: "Multiple tokens based on campaign",
    active: true,
    description: "WBTC Market Supply Mining Activity",
    announcementLink: "https://support.justlend.org/hc/en-us/articles/54740066620569",
  };
}
