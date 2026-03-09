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

  const proposalList: Proposal[] = (data.data?.proposalList || []).map((item: any) => ({
    proposalId: item.proposalId ?? item.id,
    state: item.state,
    stateText: PROPOSAL_STATES[item.state] || `Unknown(${item.state})`,
    // 修改点：处理由于前端硬编码导致后端无 title 返回的情况
    title: item.title ? item.title : `[Proposal #${item.proposalId ?? item.id}] (Details maintained in frontend)`,
    proposer: item.proposer || "",
    forVotes: item.forVotes || "0",
    againstVotes: item.againstVotes || "0",
    abstainVotes: item.abstainVotes || "0",
    startBlock: item.startBlock,
    endBlock: item.endBlock,
    activeTime: item.activeTime,
    endTime: item.endTime,
  }));

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