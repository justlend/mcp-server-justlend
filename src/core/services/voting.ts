/**
 * JustLend DAO JST Voting (Governance) Service
 *
 * Provides functionality for:
 * - Querying proposal list from API
 * - Querying user voting status
 * - Getting vote info (JST balance, surplus votes, total votes)
 * - Depositing JST to get votes (WJST)
 * - Casting votes on proposals (for/against)
 * - Withdrawing votes from completed proposals
 * - Withdrawing WJST back to JST
 * - Approving JST for WJST contract
 *
 * Based on JustLend GovernorAlpha + WJST (Wrapped JST) contracts.
 */

import { getTronWeb, getWallet } from "./clients.js";
import { safeSend } from "./contracts.js";
import { getJustLendAddresses, getApiHost } from "../chains.js";
import { GOVERNOR_ALPHA_ABI, WJST_ABI, POLY_ABI, TRC20_ABI } from "../abis.js";
import { utils } from "./utils.js";

const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
const JST_DECIMALS = 18;
const TOKEN_PRECISION = 10n ** BigInt(JST_DECIMALS);
const BLOCK_TIME_MS = 3000; // TRON block time ~3 seconds

/**
 * Estimate the current block number by fetching the latest block
 * and extrapolating based on time difference (3s per block on TRON).
 */
async function getCurrentBlock(network: string): Promise<number> {
  const tronWeb = getTronWeb(network);
  const block = await tronWeb.trx.getCurrentBlock();
  const blockNumber = block.block_header.raw_data.number;
  const blockTimestamp = block.block_header.raw_data.timestamp;
  const now = Date.now();
  const timeDelta = now - blockTimestamp;
  if (timeDelta <= 0) return blockNumber;
  return blockNumber + Math.floor(timeDelta / BLOCK_TIME_MS);
}

// ============================================================================
// READ — Proposal List (API)
// ============================================================================

/**
 * Proposal state mapping:
 * 0: Pending, 1: Active, 2: Canceled, 3: Defeated,
 * 4: Succeeded, 5: Queued, 6: Expired, 7: Executed
 */
const PROPOSAL_STATES: Record<number, string> = {
  0: "Pending",
  1: "Active",
  2: "Canceled",
  3: "Defeated",
  4: "Succeeded",
  5: "Queued",
  6: "Expired",
  7: "Executed",
};

export interface Proposal {
  proposalId: number;
  state: number;
  stateText: string;
  title: string;
  forVotes: string;
  againstVotes: string;
  abstainVotes: string;
  startBlock?: number;
  endBlock?: number;
  [key: string]: any;
}

/**
 * Hardcoded proposal details extracted from frontend locales.
 * Used as a fallback when the backend API does not return title/content.
 */
const HARDCODED_PROPOSALS: Record<number, { title?: string; content?: string }> = {
  // 1-6 号提案 API 可以查到，保留空对象作为回退占位符
  1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {},

  7: {
    title: "新增 USDC 作为支持抵押的资产 | Add USDC as a collateralizable asset",
    content: "Enable supply/borrow of USDC (TRC20). Collateral factor: 75%. Reserve factor: 5%. Interest rate surges when utilization exceeds 80%."
  },
  8: {
    title: "新增 BTT 作为支持抵押的资产 | Add BTT as a collateralizable asset",
    content: "Enable supply/borrow of BTT (TRC20). Collateral factor: 60%. Reserve factor: 20%. Interest rate surges when utilization exceeds 80%. Modify max markets supporting collateralizing."
  },
  9: {
    title: "新增 USDD 作为支持抵押的资产 | Add USDD as a collateralizable asset",
    content: "Enable supply/borrow of USDD (TRC20). Collateral factor: 0%. Reserve factor: 5%. Interest rate surges when utilization exceeds 80%."
  },
  10: {
    title: "USDD市场抵押因子调至 85% | Increase the Collateral Factor of USDD Market to 85%",
    content: "Increase the Collateral Factor of the USDD Market from 0% to 85% to allow users to borrow more assets."
  },
  11: {
    title: "调整 USDD, TRX 市场的利率模型和 Token Borrow Cap 参数 | Adjust the Interest Model and the Token Borrow Cap of the USDD, TRX Markets",
    content: "Adjust interest model and borrow cap for USDD and TRX. Add market management function. TRX: 75% collateral, 10% reserve. USDD: 85% collateral, 5% reserve."
  },
  12: {
    title: "调整 USDC 市场的利率模型和 Token Borrow Cap 参数 | Adjust the Interest Model and the Token Borrow Cap of the USDC Markets",
    content: "Adjust interest model and Token Borrow Cap for USDC. Introduce market management function to cope with extreme market changes."
  },
  13: {
    title: "升级 JustLend DAO 治理到 Governor Bravo | Migrate JustLend DAO Governance to Governor Bravo",
    content: "Transfer governance to Governor Bravo contract. Features: Upgradable implementation, configurable parameters (proposal threshold, voting period/delay), abstain vote option, optional voting reason, proposer cancel, removal of guardian, proposal creator whitelist."
  },
  14: {
    title: "升级 JustLend DAO 治理投票功能 | Upgrade the JustLend DAO Governance Vote",
    content: "Upgrade voting mechanism. Voting on a specific proposal will no longer be an accumulation model from the contract perspective. New vote amount represents total votes and must be >= previous votes."
  },
  15: {
    title: "新增 BUSD 市场 | Add BUSD Market",
    content: "Add BUSD price oracle and jBUSD. Collateral factor: 75%. Reserve factor: 5%. Interest rate surges when utilization exceeds 90%."
  },
  16: {
    title: "逐步关停 BUSD 市场 | Offboard BUSD on JustLend DAO",
    content: "Disable Supply and Borrow in the BUSD market. Increase Reserve Factor to 100% (Supply APY drops to 0). Repayments and withdrawals are still allowed."
  },
  17: {
    title: "新增 sTRX 市场 | Add sTRX Market",
    content: "Enable supply/borrow of sTRX (TRC20). Add sTRX price oracle and jsTRX. Collateral factor: 75%. Reserve factor: 10%. Interest rate jumps when utilization exceeds 80%."
  },
  18: {
    title: "提议 JustLend DAO 与 RWA DAO 达成战略合作 | Proposal to Establish Strategic Partnership between JustLend DAO and RWA DAO",
    content: "Establish strategic partnership between JustLend DAO and RWA DAO. RWA DAO governance will be delegated to the JustLend DAO platform, which will support basic stUSDT-related operations."
  },
  19: {
    title: "添加 ETH(新) 市场并逐步关停现有 ETHOLD 市场 | Add ETH (New) Market and Offboard ETHOLD Market",
    content: "Add ETH(New) market via BTTC cross-chain bridge (Collateral factor: 75%, Reserve factor: 10%). Disable Supply/Borrow for the existing ETHOLD market and increase its Reserve Factor to 100% to gradually offboard it."
  },
  20: {
    title: "新增 wstUSDT 市场 | Add wstUSDT Market",
    content: "Enable supply/borrow of wstUSDT (TRC20), a wrapped, non-rebasing version of stUSDT. Collateral factor: 75%. Reserve factor: 5%."
  },
  21: {
    title: "Proposal to Empower JST by Allocating stUSDT Protocol Revenue for JST/TRX Liquidity Pooling in SunSwap V2",
    content: "Allocate stUSDT protocol revenue every financial quarter for the buy-back and pooling of JST and TRX tokens in SunSwap V2's LP. The resulting LP tokens will be stored in a vault contract and eventually destroyed to a blackhole address."
  },
  22: {
    title: "Lowering the Collateral Factor of SUNOLD Market to 0%",
    content: "Lower the collateral factor of the SUNOLD market from 25% to 0% to accelerate its offboarding process. This increases liquidation risks for accounts using SUNOLD as collateral."
  },
  23: {
    title: "Offboard WBTT on JustLend DAO",
    content: "Gradually offboard the WBTT market by increasing its Reserve Factor to 100% (causing Supply APY to drop to zero), because the new BTT token has fully replaced WBTT in the ecosystem."
  },
  24: {
    title: "Adjust the Interest Model of the USDC Market and Lowering the Collateral Factor of USDC Market to 60%",
    content: "Adjust USDC interest model (rates rocket when utilization exceeds 80%). Lower USDC collateral factor from 75% to 60%. Increase Reserve Factor from 5% to 10% to mitigate risks posed by volatile policies."
  },
  25: {
    title: "Lowering the Collateral Factor of ETHOLD Market to 40%",
    content: "Lower the collateral factor of the ETHOLD market from 75% to 40% as stage one of accelerating the offboarding process of the ETHOLD market."
  },
  26: {
    title: "Adjust the Interest Model of the USDT and wstUSDT Markets",
    content: "Adjust the interest models for USDT and wstUSDT (jumping interest model, surges after 80% utilization). Both markets: Collateral factor remains 75%, but increase the Reserve Factor from 5% to 10%."
  },
  27: {
    title: "Proposal to Lower the Collateral Factor of WBTT Market to 0%",
    content: "Lower the collateral factor of the WBTT market from 60% to 0% to eventually delist it, as the new BTT token has fully replaced WBTT in the BitTorrent ecosystem."
  },
  28: {
    title: "Proposal to Lower the Collateral Factor of USDCOLD Market to 0% and Increase the ReserveFactor to 100%",
    content: "Lower the collateral factor of the USDCOLD market from 60% to 0% and increase the ReserveFactor from 10% to 100% to phase it out, following Circle's discontinuation of USDC support on TRON."
  },
  29: {
    title: "Proposal to Increase the Collateral Factor of ETH Market to 75% and Lower the ReserveFactor to 20%",
    content: "Reopen borrow and supply functions for the ETH market. Increase the collateral factor from 40% to 75% and lower the reserve factor from 100% to 20% to enhance market efficiency."
  },
  30: {
    title: "Proposal to Implement the Risk Admin Extension Phase 1",
    content: "Implement Phase One of the risk admin extension to enhance JustLend DAO's ability to manage risks effectively by upgrading the risk management scope of certain markets with elevated potential risks."
  },
  31: {
    title: "Proposal to add the USDD V2.0 Market",
    content: "Add the USDD V2.0 (TRC20) market. Collateral factor: 85%. Reserve factor: 5%. Interest rate rockets when utilization exceeds 50%. USDD V2.0 returns minting permissions to the community and optimizes collateral types."
  },
  32: {
    title: "Proposal to Update the Oracle Mechanism",
    content: "Update the oracle system to enhance its ability to provide near real-time, accurate price feed data to adapt to market volatility and improve risk assessments."
  },
  33: {
    title: "Proposal to Disable Supply and Borrow in the USDJ Market",
    content: "Disable Supply and Borrow functions in the USDJ market due to declining utility. Existing users can still repay loans and withdraw supplied assets."
  },
  34: {
    title: "Proposal to Lower the Collateral Factor of USDJ Market to 0% and Increase the Reserve Factor to 100%",
    content: "Further phase out the USDJ market by lowering its collateral factor from 75% to 0% and increasing its reserve factor from 5% to 100%."
  },
  35: {
    title: "Proposal to Disable Supply and Borrow in the USDDOLD Market and Increase its Reserve Factor to 100%",
    content: "Disable Supply and Borrow functions in the USDDOLD market and increase its reserve factor from 5% to 100% due to declining utility following the launch of USDD V2.0."
  },
  36: {
    title: "Proposal to add the USD1 Market",
    content: "Add the World Liberty Financial USD (USD1) market. Collateral factor: 0%. Reserve factor: 10%. Interest rate rockets when utilization exceeds 80%. USD1 is a fully fiat-backed stablecoin."
  },
  37: {
    title: "Proposal on JST Buyback & Burn Program",
    content: "Implement a JST buyback and burn mechanism using JustLend DAO's net revenue and USDD ecosystem revenue above $10 million. 30% of existing revenue burned initially, 70% phased over four quarters. Future net revenue burned quarterly."
  },
  38: {
    title: "Proposal to add the WBTC Market",
    content: "Add Wrapped BTC (WBTC) market via TRC20. Collateral factor: 75%. Reserve factor: 5%. Interest rate rockets when utilization exceeds 80%."
  },
  39: {
    title: "Proposal to Lower the Collateral Factor of USDDOLD Market to 50%",
    content: "Lower the collateral factor of the USDDOLD market from 85% to 50% to further the offboarding and delisting process of the legacy USDD market."
  }
};

/**
 * Get the list of governance proposals from JustLend API.
 */
export async function getProposalList(network = "mainnet"): Promise<{
  proposals: Proposal[];
  total: number;
}> {
  const host = getApiHost(network);
  const block = await getCurrentBlock(network);
  const url = `${host}/justlend/gov/proposalList?block=${block}`;
  const response = await fetch(url);
  const data = await response.json();

  if (data.code !== 0 && data.message !== "SUCCESS") {
    throw new Error(`Failed to fetch proposal list: ${data.message || "Unknown error"}`);
  }

  const proposalList: Proposal[] = (data.data?.proposalList || []).map((item: any) => {
    const pId = item.proposalId ?? item.id;
    const hardcoded = HARDCODED_PROPOSALS[pId];

    // 【核心逻辑】：优先使用本地硬编码的字典，如果字典里没有（比如 1-6号 或未来的新提案），则自动回退使用 API 返回的 title 和 content。
    const title = hardcoded?.title || item.title || `[Proposal #${pId}]`;
    const content = hardcoded?.content || item.content || "Details maintained in frontend.";

    return {
      proposalId: pId,
      state: item.state,
      stateText: PROPOSAL_STATES[item.state] || `Unknown(${item.state})`,
      title,
      content, // 直接暴露给 AI
      proposer: item.proposer || "",
      forVotes: item.forVotes || "0",
      againstVotes: item.againstVotes || "0",
      abstainVotes: item.abstainVotes || "0",
      startBlock: item.startBlock,
      endBlock: item.endBlock,
      activeTime: item.activeTime,
      endTime: item.endTime,
    };
  });

  // Sort by proposalId descending (newest first)
  proposalList.sort((a, b) => b.proposalId - a.proposalId);

  return {
    proposals: proposalList,
    total: proposalList.length,
  };
}

// ============================================================================
// READ — User Vote Status (API)
// ============================================================================

export interface UserVoteStatus {
  proposalId: number;
  forVotes: string;
  againstVotes: string;
  abstainVotes: string;
  canWithdraw: boolean;
  state: number;
  stateText: string;
}

/**
 * Get user's voting status across all proposals from JustLend API.
 */
export async function getUserVoteStatus(
  address: string,
  network = "mainnet",
): Promise<{
  statusList: UserVoteStatus[];
  votedProposals: number[];
  withdrawableProposals: UserVoteStatus[];
}> {
  const host = getApiHost(network);
  const block = await getCurrentBlock(network);
  const url = `${host}/justlend/gov/voteStatus?account=${encodeURIComponent(address)}&block=${block}`;
  const response = await fetch(url);
  const data = await response.json();

  const statusList: UserVoteStatus[] = (data.data?.statusList || []).map((item: any) => ({
    ...item,
    stateText: PROPOSAL_STATES[item.state] || `Unknown(${item.state})`,
  }));

  const votedProposals: number[] = [];
  const withdrawableProposals: UserVoteStatus[] = [];

  for (const item of statusList) {
    const hasVoted = BigInt(item.forVotes || "0") > 0n || BigInt(item.againstVotes || "0") > 0n;
    if (hasVoted) {
      votedProposals.push(item.proposalId);
    }
    if (item.canWithdraw && item.state !== 2) {
      withdrawableProposals.push(item);
    }
  }

  return { statusList, votedProposals, withdrawableProposals };
}

// ============================================================================
// READ — Vote Info (On-chain via Poly contract)
// ============================================================================

export interface VoteInfo {
  jstBalance: string;
  surplusVotes: string;
  totalVote: string;
  castVote: string;
  jstBalanceRaw: string;
  surplusVotesRaw: string;
  totalVoteRaw: string;
  castVoteRaw: string;
}

/**
 * Get vote info for a user: JST balance, surplus (available) votes, total votes, cast votes.
 * Uses the Poly helper contract on-chain.
 */
export async function getVoteInfo(
  address: string,
  network = "mainnet",
): Promise<VoteInfo> {
  const tronWeb = getTronWeb(network);
  const addresses = getJustLendAddresses(network);

  const contract = tronWeb.contract(POLY_ABI, addresses.poly);
  const result = await contract.methods.getVoteInfo(address, addresses.jst, addresses.wjst).call();

  const jstBalance = BigInt(result[0] || result.jstBalance || "0");
  const surplusVotes = BigInt(result[1] || result.surplusVotes || "0");
  const totalVote = BigInt(result[2] || result.totalVote || "0");
  const castVote = BigInt(result[3] || result.castVote || "0");

  return {
    jstBalance: formatTokenAmount(jstBalance),
    surplusVotes: formatTokenAmount(surplusVotes),
    totalVote: formatTokenAmount(totalVote),
    castVote: formatTokenAmount(castVote),
    jstBalanceRaw: jstBalance.toString(),
    surplusVotesRaw: surplusVotes.toString(),
    totalVoteRaw: totalVote.toString(),
    castVoteRaw: castVote.toString(),
  };
}

// ============================================================================
// READ — Locked votes for a specific proposal
// ============================================================================

/**
 * Get the number of votes locked by a user for a specific proposal.
 */
export async function getLockedVotes(
  address: string,
  proposalId: number,
  network = "mainnet",
): Promise<{ proposalId: number; lockedVotes: string; lockedVotesRaw: string }> {
  const tronWeb = getTronWeb(network);
  const addresses = getJustLendAddresses(network);

  const contract = tronWeb.contract(WJST_ABI, addresses.wjst);
  const result = await contract.methods.lockTo(address, proposalId).call();
  const locked = BigInt(result.toString());

  return {
    proposalId,
    lockedVotes: formatTokenAmount(locked),
    lockedVotesRaw: locked.toString(),
  };
}

// ============================================================================
// WRITE — Approve JST for WJST
// ============================================================================

/**
 * Approve JST token for the WJST contract (required before depositing JST to get votes).
 */
export async function approveJSTForVoting(
  privateKey: string,
  amount: string = "max",
  network = "mainnet",
): Promise<{ txID: string; message: string }> {
  const tronWeb = getWallet(privateKey, network);
  const addresses = getJustLendAddresses(network);

  const approveAmount = amount.toLowerCase() === "max"
    ? MAX_UINT256
    : utils.parseUnits(amount, JST_DECIMALS).toString();

  const { txID } = await safeSend(privateKey, {
    address: addresses.jst,
    abi: TRC20_ABI,
    functionName: "approve",
    args: [addresses.wjst, approveAmount]
  }, network);
  return { txID, message: `Approved ${amount === "max" ? "unlimited" : amount} JST for WJST voting contract` };
}

// ============================================================================
// WRITE — Deposit JST → WJST (Get Votes)
// ============================================================================

/**
 * Deposit JST into the WJST contract to get voting power.
 * Requires prior approval of JST for the WJST contract.
 *
 * @param amount - Amount of JST to deposit (human-readable, e.g. "1000")
 */
export async function depositJSTForVotes(
  privateKey: string,
  amount: string,
  network = "mainnet",
): Promise<{ txID: string; amount: string; message: string }> {
  const tronWeb = getWallet(privateKey, network);
  const addresses = getJustLendAddresses(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;
  const amountRaw = utils.parseUnits(amount, JST_DECIMALS);

  // Check JST balance
  const token = tronWeb.contract(TRC20_ABI, addresses.jst);
  const jstBalance = BigInt(await token.methods.balanceOf(walletAddress).call());
  if (jstBalance < amountRaw) {
    throw new Error(
      `Insufficient JST balance. Have ${formatTokenAmount(jstBalance)} JST, need ${amount} JST`,
    );
  }

  // Check JST allowance for WJST contract
  const allowance = BigInt(await token.methods.allowance(walletAddress, addresses.wjst).call());
  if (allowance < amountRaw) {
    throw new Error(
      `Insufficient JST allowance for WJST contract. Allowance: ${formatTokenAmount(allowance)} JST. Please approve first using approve_jst_for_voting.`,
    );
  }

  const { txID } = await safeSend(privateKey, {
    address: addresses.wjst,
    abi: WJST_ABI,
    functionName: "deposit",
    args: [amountRaw.toString()]
  }, network);

  return { txID, amount, message: `Deposited ${amount} JST to get voting power (WJST)` };
}

// ============================================================================
// WRITE — Withdraw WJST → JST (Redeem Votes)
// ============================================================================

/**
 * Withdraw WJST back to JST. Can only withdraw votes not currently locked in active proposals.
 *
 * @param amount - Amount of votes/WJST to withdraw back to JST (human-readable)
 */
export async function withdrawVotesToJST(
  privateKey: string,
  amount: string,
  network = "mainnet",
): Promise<{ txID: string; amount: string; message: string }> {
  const tronWeb = getWallet(privateKey, network);
  const addresses = getJustLendAddresses(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;
  const amountRaw = utils.parseUnits(amount, JST_DECIMALS);

  // Check surplus (available, unlocked) votes
  const voteInfo = await getVoteInfo(walletAddress, network);
  const surplusVotes = BigInt(voteInfo.surplusVotesRaw);
  if (surplusVotes < amountRaw) {
    throw new Error(
      `Insufficient available votes. Surplus votes: ${voteInfo.surplusVotes}, want to withdraw: ${amount}. Some votes may be locked in active proposals.`,
    );
  }

  const { txID } = await safeSend(privateKey, {
    address: addresses.wjst,
    abi: WJST_ABI,
    functionName: "withdraw",
    args: [amountRaw.toString()]
  }, network);

  return { txID, amount, message: `Withdrew ${amount} WJST back to JST` };
}

// ============================================================================
// WRITE — Cast Vote
// ============================================================================

/**
 * Cast a vote on a governance proposal.
 *
 * @param proposalId - The proposal ID to vote on
 * @param support - true for "For", false for "Against"
 * @param votes - Amount of votes to cast (human-readable, e.g. "1000")
 */
export async function castVote(
  privateKey: string,
  proposalId: number,
  support: boolean,
  votes: string,
  network = "mainnet",
): Promise<{ txID: string; proposalId: number; support: string; votes: string; message: string }> {
  const tronWeb = getWallet(privateKey, network);
  const addresses = getJustLendAddresses(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;
  const votesRaw = utils.parseUnits(votes, JST_DECIMALS);

  // Check surplus (available) votes
  const voteInfo = await getVoteInfo(walletAddress, network);
  const surplusVotes = BigInt(voteInfo.surplusVotesRaw);
  if (surplusVotes < votesRaw) {
    throw new Error(
      `Insufficient available votes. Surplus votes: ${voteInfo.surplusVotes}, want to cast: ${votes}. Deposit more JST to get voting power.`,
    );
  }

  const supportValue = support ? 1 : 0;

  const { txID } = await safeSend(privateKey, {
    address: addresses.governorAlpha,
    abi: GOVERNOR_ALPHA_ABI,
    functionName: "castVote",
    args: [proposalId, votesRaw.toString(), supportValue]
  }, network);

  return {
    txID,
    proposalId,
    support: support ? "For" : "Against",
    votes,
    message: `Cast ${votes} votes ${support ? "for" : "against"} proposal #${proposalId}`,
  };
}

// ============================================================================
// WRITE — Withdraw Votes from Proposal
// ============================================================================

/**
 * Withdraw (reclaim) votes from a completed/canceled proposal.
 * Only works for proposals that are no longer active.
 *
 * @param proposalId - The proposal ID to withdraw votes from
 */
export async function withdrawVotesFromProposal(
  privateKey: string,
  proposalId: number,
  network = "mainnet",
): Promise<{ txID: string; proposalId: number; message: string }> {
  const tronWeb = getWallet(privateKey, network);
  const addresses = getJustLendAddresses(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;

  // Check if user has locked votes on this proposal
  const locked = await getLockedVotes(walletAddress, proposalId, network);
  if (BigInt(locked.lockedVotesRaw) === 0n) {
    throw new Error(`No locked votes found for proposal #${proposalId}. Nothing to withdraw.`);
  }

  const { txID } = await safeSend(privateKey, {
    address: addresses.governorAlpha,
    abi: GOVERNOR_ALPHA_ABI,
    functionName: "withdrawVotes",
    args: [proposalId]
  }, network);

  return { txID, proposalId, message: `Withdrew votes from proposal #${proposalId}` };
}

// ============================================================================
// READ — Check JST allowance for WJST
// ============================================================================

/**
 * Check if JST has been approved for the WJST voting contract.
 */
export async function checkJSTAllowanceForVoting(
  address: string,
  network = "mainnet",
): Promise<{ approved: boolean; allowance: string; allowanceRaw: string }> {
  const tronWeb = getTronWeb(network);
  const addresses = getJustLendAddresses(network);

  const token = tronWeb.contract(TRC20_ABI, addresses.jst);
  const allowance = await token.methods.allowance(address, addresses.wjst).call();
  const allowanceBigInt = BigInt(allowance.toString());

  return {
    approved: allowanceBigInt > 0n,
    allowance: formatTokenAmount(allowanceBigInt),
    allowanceRaw: allowanceBigInt.toString(),
  };
}

// ============================================================================
// Helpers
// ============================================================================

function formatTokenAmount(raw: bigint): string {
  const whole = raw / TOKEN_PRECISION;
  const fraction = raw % TOKEN_PRECISION;
  if (fraction === 0n) return whole.toString();
  const fractionStr = fraction.toString().padStart(JST_DECIMALS, "0").replace(/0+$/, "");
  return `${whole}.${fractionStr}`;
}