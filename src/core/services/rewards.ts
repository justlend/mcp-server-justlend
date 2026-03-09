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

import { getTronWeb } from "./clients.js";
import { getJustLendAddresses, getApiHost } from "../chains.js";
import { getJTokenDetailsFromAPI } from "./markets.js";

// Merkle Distributor ABI (simplified)
const MERKLE_DISTRIBUTOR_ABI = [
  {
    "name": "claim",
    "inputs": [
      { "name": "index", "type": "uint256" },
      { "name": "account", "type": "address" },
      { "name": "amount", "type": "uint256" },
      { "name": "merkleProof", "type": "bytes32[]" }
    ],
    "outputs": [],
    "stateMutability": "Nonpayable",
    "type": "Function"
  },
  {
    "name": "isClaimed",
    "inputs": [{ "name": "index", "type": "uint256" }],
    "outputs": [{ "name": "", "type": "bool" }],
    "stateMutability": "View",
    "type": "Function"
  }
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
    const response = await fetch(url);
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
    throw new Error(`Failed to fetch mining rewards from API: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Check if user has claimable rewards for a specific distributor
 */
export async function checkClaimableRewards(
  userAddress: string,
  distributorType: "main" | "usdd" | "strx" | "multi",
  network = "mainnet"
): Promise<{ hasRewards: boolean; isClaimed: boolean }> {
  const tronWeb = getTronWeb(network);
  const addresses = getJustLendAddresses(network);

  const distributorAddress = addresses.merkleDistributors[distributorType];
  const distributor = tronWeb.contract(MERKLE_DISTRIBUTOR_ABI, distributorAddress);

  // Note: This is a simplified check. Real implementation would need:
  // 1. Fetch merkle proof data from API or backend
  // 2. Check if index is claimed
  // For now, we recommend using the API method getMiningRewardsFromAPI

  return {
    hasRewards: false,
    isClaimed: false,
  };
}

/**
 * Claim mining rewards using V1 merkle distributor (requires merkle proof from API/backend).
 *
 * VERSION: V1 - Uses JustLend V1 Merkle Distributor contracts
 *
 * NOTE: This function requires merkle proof data which is typically
 * provided by the JustLend backend API. Users should:
 * 1. Check rewards via getMiningRewardsFromAPI()
 * 2. Get merkle proof from JustLend API
 * 3. Call this function with the proof data
 */
export async function claimMiningRewards(
  index: number,
  amount: string,
  merkleProof: string[],
  distributorType: "main" | "usdd" | "strx" | "multi" = "main",
  network = "mainnet"
): Promise<{ txid: string; success: boolean }> {
  const tronWeb = getTronWeb(network);
  const addresses = getJustLendAddresses(network);
  const userAddress = tronWeb.defaultAddress.base58;

  if (!userAddress) {
    throw new Error("No wallet address configured. Set TRON_PRIVATE_KEY or TRON_MNEMONIC.");
  }

  const distributorAddress = addresses.merkleDistributors[distributorType];
  const distributor = tronWeb.contract(MERKLE_DISTRIBUTOR_ABI, distributorAddress);

  try {
    const tx = await distributor.methods.claim(
      index,
      userAddress,
      amount,
      merkleProof
    ).send({
      feeLimit: 100_000_000, // 100 TRX
      callValue: 0,
      shouldPollResponse: true,
    });

    return {
      txid: tx,
      success: true,
    };
  } catch (error) {
    throw new Error(`Failed to claim rewards: ${error instanceof Error ? error.message : String(error)}`);
  }
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
