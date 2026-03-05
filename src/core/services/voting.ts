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
import { getJustLendAddresses } from "../chains.js";
import { GOVERNOR_ALPHA_ABI, WJST_ABI, POLY_ABI, TRC20_ABI } from "../abis.js";

const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
const JST_DECIMALS = 18;
const TOKEN_PRECISION = 10n ** BigInt(JST_DECIMALS);
const BLOCK_TIME_MS = 3000; // TRON block time ~3 seconds

// JustLend API endpoints
const JUSTLEND_API_ENDPOINTS: Record<string, string> = {
  mainnet: "https://labc.ablesdxd.link",
  nile: "https://nileapi.justlend.org",
};

function getApiHost(network: string): string {
  const n = network.toLowerCase();
  if (n === "mainnet" || n === "tron" || n === "trx") return JUSTLEND_API_ENDPOINTS.mainnet;
  if (n === "nile" || n === "testnet") return JUSTLEND_API_ENDPOINTS.nile;
  return JUSTLEND_API_ENDPOINTS.mainnet;
}

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
    title: item.title || "",
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
  const url = `${host}/justlend/gov/voteStatus?account=${address}&block=${block}`;
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
    : (BigInt(Math.floor(parseFloat(amount) * 10 ** JST_DECIMALS))).toString();

  const token = tronWeb.contract(TRC20_ABI, addresses.jst);
  const txID = await token.methods.approve(addresses.wjst, approveAmount).send();
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

  const amountRaw = BigInt(Math.floor(parseFloat(amount) * 10 ** JST_DECIMALS));
  const contract = tronWeb.contract(WJST_ABI, addresses.wjst);
  const txID = await contract.methods.deposit(amountRaw.toString()).send();

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

  const amountRaw = BigInt(Math.floor(parseFloat(amount) * 10 ** JST_DECIMALS));
  const contract = tronWeb.contract(WJST_ABI, addresses.wjst);
  const txID = await contract.methods.withdraw(amountRaw.toString()).send();

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

  const votesRaw = BigInt(Math.floor(parseFloat(votes) * 10 ** JST_DECIMALS));
  const supportValue = support ? 1 : 0;

  const contract = tronWeb.contract(GOVERNOR_ALPHA_ABI, addresses.governorAlpha);
  const txID = await contract.methods.castVote(proposalId, votesRaw.toString(), supportValue).send();

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

  const contract = tronWeb.contract(GOVERNOR_ALPHA_ABI, addresses.governorAlpha);
  const txID = await contract.methods.withdrawVotes(proposalId).send();

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
