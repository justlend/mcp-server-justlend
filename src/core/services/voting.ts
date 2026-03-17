/**
 * JustLend DAO JST Voting (Governance) Service
 */

import { getTronWeb, getWallet } from "./clients.js";
import { safeSend } from "./contracts.js";
import { getJustLendAddresses, getApiHost } from "../chains.js";
import { GOVERNOR_ALPHA_ABI, WJST_ABI, POLY_ABI, TRC20_ABI } from "../abis.js";
import { utils } from "./utils.js";

const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
const JST_DECIMALS = 18;
const TOKEN_PRECISION = 10n ** BigInt(JST_DECIMALS);
const BLOCK_TIME_MS = 3000;

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

const PROPOSAL_STATES: Record<number, string> = {
  0: "Pending", 1: "Active", 2: "Canceled", 3: "Defeated",
  4: "Succeeded", 5: "Queued", 6: "Expired", 7: "Executed",
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

const HARDCODED_PROPOSALS: Record<number, { title?: string; content?: string }> = {
  1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {},
  7: { title: "新增 USDC 作为支持抵押的资产 | Add USDC as a collateralizable asset" },
  8: { title: "新增 BTT 作为支持抵押的资产 | Add BTT as a collateralizable asset" },
  9: { title: "新增 USDD 作为支持抵押的资产 | Add USDD as a collateralizable asset" },
  10: { title: "USDD市场抵押因子调至 85% | Increase the Collateral Factor of USDD Market to 85%" },
  11: { title: "调整 USDD, TRX 市场的利率模型和 Token Borrow Cap 参数" },
  12: { title: "调整 USDC 市场的利率模型和 Token Borrow Cap 参数" },
  13: { title: "升级 JustLend DAO 治理到 Governor Bravo" },
  14: { title: "升级 JustLend DAO 治理投票功能" },
  15: { title: "新增 BUSD 市场 | Add BUSD Market" },
  16: { title: "逐步关停 BUSD 市场 | Offboard BUSD on JustLend DAO" },
  17: { title: "新增 sTRX 市场 | Add sTRX Market" },
  18: { title: "提议 JustLend DAO 与 RWA DAO 达成战略合作" },
  19: { title: "添加 ETH(新) 市场并逐步关停现有 ETHOLD 市场" },
  20: { title: "新增 wstUSDT 市场 | Add wstUSDT Market" },
  21: { title: "Proposal to Empower JST by Allocating stUSDT Protocol Revenue" },
  22: { title: "Lowering the Collateral Factor of SUNOLD Market to 0%" },
  23: { title: "Offboard WBTT on JustLend DAO" },
  24: { title: "Adjust the Interest Model of the USDC Market" },
  25: { title: "Lowering the Collateral Factor of ETHOLD Market to 40%" },
  26: { title: "Adjust the Interest Model of the USDT and wstUSDT Markets" },
  27: { title: "Proposal to Lower the Collateral Factor of WBTT Market to 0%" },
  28: { title: "Proposal to Lower the Collateral Factor of USDCOLD Market to 0%" },
  29: { title: "Proposal to Increase the Collateral Factor of ETH Market to 75%" },
  30: { title: "Proposal to Implement the Risk Admin Extension Phase 1" },
  31: { title: "Proposal to add the USDD V2.0 Market" },
  32: { title: "Proposal to Update the Oracle Mechanism" },
  33: { title: "Proposal to Disable Supply and Borrow in the USDJ Market" },
  34: { title: "Proposal to Lower the Collateral Factor of USDJ Market to 0%" },
  35: { title: "Proposal to Disable Supply and Borrow in the USDDOLD Market" },
  36: { title: "Proposal to add the USD1 Market" },
  37: { title: "Proposal on JST Buyback & Burn Program" },
  38: { title: "Proposal to add the WBTC Market" },
  39: { title: "Proposal to Lower the Collateral Factor of USDDOLD Market to 50%" }
};

export async function getProposalList(network = "mainnet"): Promise<{ proposals: Proposal[]; total: number; }> {
  const host = getApiHost(network);
  try {
    const block = await getCurrentBlock(network);
    const url = `${host}/justlend/gov/proposalList?block=${block}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.code !== 0 && data.message !== "SUCCESS") {
      throw new Error(`API returned error: ${data.message || "Unknown error"}`);
    }

    const proposalList: Proposal[] = (data.data?.proposalList || []).map((item: any) => {
      const pId = item.proposalId ?? item.id;
      const hardcoded = HARDCODED_PROPOSALS[pId];
      const title = hardcoded?.title || item.title || `[Proposal #${pId}]`;
      const content = hardcoded?.content || item.content || "Details maintained in frontend.";

      return {
        proposalId: pId,
        state: item.state,
        stateText: PROPOSAL_STATES[item.state] || `Unknown(${item.state})`,
        title,
        content,
        proposer: item.proposer || "",
        forVotes: item.forVotes || "0",
        againstVotes: item.againstVotes || "0",
        abstainVotes: item.abstainVotes || "0",
        startBlock: item.startBlock,
        endBlock: item.endBlock,
      };
    });

    proposalList.sort((a, b) => b.proposalId - a.proposalId);
    return { proposals: proposalList, total: proposalList.length };
  } catch (error) {
    console.error(`[API Fallback] Fetching latest proposal from contract due to API failure:`, error);
    const tronWeb = getTronWeb(network);
    const addresses = getJustLendAddresses(network);
    const contract = tronWeb.contract(GOVERNOR_ALPHA_ABI, addresses.governorAlpha);

    const countBigInt = await contract.methods.proposalCount().call();
    const latestProposalId = Number(countBigInt.toString());

    if (latestProposalId === 0) return { proposals: [], total: 0 };

    const stateBigInt = await contract.methods.state(latestProposalId).call();
    const stateNum = Number(stateBigInt.toString());
    const hardcoded = HARDCODED_PROPOSALS[latestProposalId];

    const latestProposal: Proposal = {
      proposalId: latestProposalId,
      state: stateNum,
      stateText: PROPOSAL_STATES[stateNum] || `Unknown(${stateNum})`,
      title: hardcoded?.title || `[Proposal #${latestProposalId}]`,
      content: hardcoded?.content || "Details fetched from on-chain fallback.",
      forVotes: "0",
      againstVotes: "0",
      abstainVotes: "0",
    };

    return { proposals: [latestProposal], total: latestProposalId };
  }
}

export interface UserVoteStatus {
  proposalId: number;
  forVotes: string;
  againstVotes: string;
  abstainVotes: string;
  canWithdraw: boolean;
  state: number;
  stateText: string;
}

export async function getUserVoteStatus(
  address: string,
  network = "mainnet",
): Promise<{ statusList: UserVoteStatus[]; votedProposals: number[]; withdrawableProposals: UserVoteStatus[]; }> {
  const host = getApiHost(network);
  try {
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
      if (hasVoted) votedProposals.push(item.proposalId);
      if (item.canWithdraw && item.state !== 2) withdrawableProposals.push(item);
    }
    return { statusList, votedProposals, withdrawableProposals };
  } catch (error) {
    console.error(`[API Fallback] Fetching user vote status from contract due to:`, error);
    const tronWeb = getTronWeb(network);
    const addresses = getJustLendAddresses(network);
    const contract = tronWeb.contract(GOVERNOR_ALPHA_ABI, addresses.governorAlpha);

    const proposalCount = await contract.methods.proposalCount().call();
    const count = Number(proposalCount.toString());
    const statusList: UserVoteStatus[] = [];

    for (let pId = count; pId >= Math.max(1, count - 10); pId--) {
      try {
        const receipt = await contract.methods.getReceipt(pId, address).call();
        const hasVoted = receipt.hasVoted || receipt[0];

        if (hasVoted) {
          const support = Number((receipt.support || receipt[1]).toString());
          const votesRaw = BigInt((receipt.votes || receipt[2]).toString());
          const votesFmt = formatTokenAmount(votesRaw);
          const pState = await contract.methods.state(pId).call();
          const stateNum = Number(pState.toString());

          statusList.push({
            proposalId: pId,
            forVotes: support === 1 ? votesFmt : "0",
            againstVotes: support === 0 ? votesFmt : "0",
            abstainVotes: support === 2 ? votesFmt : "0",
            canWithdraw: stateNum !== 1,
            state: stateNum,
            stateText: PROPOSAL_STATES[stateNum] || `Unknown(${stateNum})`,
          });
        }
      } catch (err) { }
    }

    const votedProposals = statusList.map(i => i.proposalId);
    const withdrawableProposals = statusList.filter(i => i.canWithdraw);
    return { statusList, votedProposals, withdrawableProposals };
  }
}

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

export async function getVoteInfo(address: string, network = "mainnet"): Promise<VoteInfo> {
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

export async function getLockedVotes(address: string, proposalId: number, network = "mainnet"): Promise<{ proposalId: number; lockedVotes: string; lockedVotesRaw: string }> {
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

export async function checkJSTAllowanceForVoting(address: string, network = "mainnet"): Promise<{ approved: boolean; allowance: string; allowanceRaw: string }> {
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

export async function approveJSTForVoting(privateKey: string, amount: string = "max", network = "mainnet"): Promise<{ txID: string; message: string }> {
  const tronWeb = getWallet(privateKey, network);
  const addresses = getJustLendAddresses(network);
  const approveAmount = amount.toLowerCase() === "max" ? MAX_UINT256 : utils.parseUnits(amount, JST_DECIMALS).toString();

  const { txID } = await safeSend(privateKey, {
    address: addresses.jst, abi: TRC20_ABI, functionName: "approve", args: [addresses.wjst, approveAmount]
  }, network);
  return { txID, message: `Approved ${amount === "max" ? "unlimited" : amount} JST for WJST voting contract` };
}

export async function depositJSTForVotes(privateKey: string, amount: string, network = "mainnet"): Promise<{ txID: string; amount: string; message: string }> {
  const tronWeb = getWallet(privateKey, network);
  const addresses = getJustLendAddresses(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;
  const amountRaw = utils.parseUnits(amount, JST_DECIMALS);

  const token = tronWeb.contract(TRC20_ABI, addresses.jst);
  const jstBalance = BigInt(await token.methods.balanceOf(walletAddress).call());
  if (jstBalance < amountRaw) throw new Error(`Insufficient JST balance.`);
  const allowance = BigInt(await token.methods.allowance(walletAddress, addresses.wjst).call());
  if (allowance < amountRaw) throw new Error(`Insufficient JST allowance.`);

  const { txID } = await safeSend(privateKey, {
    address: addresses.wjst, abi: WJST_ABI, functionName: "deposit", args: [amountRaw.toString()]
  }, network);
  return { txID, amount, message: `Deposited ${amount} JST to get voting power (WJST)` };
}

export async function withdrawVotesToJST(privateKey: string, amount: string, network = "mainnet"): Promise<{ txID: string; amount: string; message: string }> {
  const tronWeb = getWallet(privateKey, network);
  const addresses = getJustLendAddresses(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;
  const amountRaw = utils.parseUnits(amount, JST_DECIMALS);

  const voteInfo = await getVoteInfo(walletAddress, network);
  const surplusVotes = BigInt(voteInfo.surplusVotesRaw);
  if (surplusVotes < amountRaw) throw new Error(`Insufficient available votes.`);

  const { txID } = await safeSend(privateKey, {
    address: addresses.wjst, abi: WJST_ABI, functionName: "withdraw", args: [amountRaw.toString()]
  }, network);
  return { txID, amount, message: `Withdrew ${amount} WJST back to JST` };
}

export async function castVote(privateKey: string, proposalId: number, support: boolean, votes: string, network = "mainnet"): Promise<{ txID: string; proposalId: number; support: string; votes: string; message: string }> {
  const tronWeb = getWallet(privateKey, network);
  const addresses = getJustLendAddresses(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;
  const votesRaw = utils.parseUnits(votes, JST_DECIMALS);

  const voteInfo = await getVoteInfo(walletAddress, network);
  const surplusVotes = BigInt(voteInfo.surplusVotesRaw);
  if (surplusVotes < votesRaw) throw new Error(`Insufficient available votes.`);

  const supportValue = support ? 1 : 0;
  const { txID } = await safeSend(privateKey, {
    address: addresses.governorAlpha, abi: GOVERNOR_ALPHA_ABI, functionName: "castVote", args: [proposalId, votesRaw.toString(), supportValue]
  }, network);
  return { txID, proposalId, support: support ? "For" : "Against", votes, message: `Cast ${votes} votes ${support ? "for" : "against"} proposal #${proposalId}` };
}

export async function withdrawVotesFromProposal(privateKey: string, proposalId: number, network = "mainnet"): Promise<{ txID: string; proposalId: number; message: string }> {
  const tronWeb = getWallet(privateKey, network);
  const addresses = getJustLendAddresses(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;

  const locked = await getLockedVotes(walletAddress, proposalId, network);
  if (BigInt(locked.lockedVotesRaw) === 0n) throw new Error(`No locked votes found for proposal #${proposalId}.`);

  const { txID } = await safeSend(privateKey, {
    address: addresses.governorAlpha, abi: GOVERNOR_ALPHA_ABI, functionName: "withdrawVotes", args: [proposalId]
  }, network);
  return { txID, proposalId, message: `Withdrew votes from proposal #${proposalId}` };
}

function formatTokenAmount(raw: bigint): string {
  const whole = raw / TOKEN_PRECISION;
  const fraction = raw % TOKEN_PRECISION;
  if (fraction === 0n) return whole.toString();
  const fractionStr = fraction.toString().padStart(JST_DECIMALS, "0").replace(/0+$/, "");
  return `${whole}.${fractionStr}`;
}