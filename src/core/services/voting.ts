/**
 * JustLend DAO JST Voting (Governance) Service
 */

import { getTronWeb } from "./clients.js";
import { getSigningClient } from "./wallet.js";
import { safeSend } from "./contracts.js";
import { getJustLendAddresses, getApiHost } from "../chains.js";
import { GOVERNOR_ALPHA_ABI, WJST_ABI, POLY_ABI, TRC20_ABI } from "../abis.js";
import { utils } from "./utils.js";
import { fetchWithTimeout } from "./http.js";

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

// ============================================================================
// READ — Proposal List (Primary: On-chain, Fallback: API)
// ============================================================================
export async function getProposalList(network = "mainnet"): Promise<{ proposals: Proposal[]; total: number; }> {
  try {
    // --- 1. 优先尝试从链上获取最新 20 条提案 ---
    const tronWeb = getTronWeb(network);
    const addresses = getJustLendAddresses(network);
    const contract = tronWeb.contract(GOVERNOR_ALPHA_ABI, addresses.governorAlpha);

    const countBigInt = await contract.methods.proposalCount().call();
    const count = Number(countBigInt.toString());

    if (count === 0) return { proposals: [], total: 0 };

    const proposalList: Proposal[] = [];
    const startId = count;
    // 限制最多一次拉取 20 条，避免节点限流或超时
    const endId = Math.max(1, count - 19);

    // 并发请求提案状态，大幅提升链上查询速度
    const statePromises = [];
    for (let pId = startId; pId >= endId; pId--) {
      statePromises.push(
        contract.methods.state(pId).call()
          .then((stateBigInt: any) => ({ pId, stateNum: Number(stateBigInt.toString()) }))
          .catch(() => ({ pId, stateNum: -1 })) // 忽略错误项
      );
    }

    const states = await Promise.all(statePromises);

    for (const { pId, stateNum } of states) {
      if (stateNum === -1) continue;
      const hardcoded = HARDCODED_PROPOSALS[pId];

      proposalList.push({
        proposalId: pId,
        state: stateNum,
        stateText: PROPOSAL_STATES[stateNum] || `Unknown(${stateNum})`,
        title: hardcoded?.title || `[Proposal #${pId}]`,
        content: hardcoded?.content || "Details fetched directly from on-chain contract.",
        forVotes: "0",      // 若需精准票数需补充 proposals(id) 调用，目前占位处理
        againstVotes: "0",
        abstainVotes: "0",
      });
    }

    // 按 ID 倒序
    proposalList.sort((a, b) => b.proposalId - a.proposalId);
    return { proposals: proposalList, total: count };

  } catch (error: any) {
    console.warn(`[API Fallback] On-chain proposal query failed, falling back to API: ${error?.message ?? error}`);

    // --- 2. 链上失败时，兜底请求后端 API ---
    const host = getApiHost(network);
    const block = await getCurrentBlock(network);
    const url = `${host}/justlend/gov/proposalList?block=${block}`;
    const response = await fetchWithTimeout(url);
    const data = await response.json();

    if (data.code !== 0 && data.message !== "SUCCESS") {
      throw new Error(`Both On-chain & API returned errors: ${data.message || "Unknown error"}`);
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

// ============================================================================
// READ — User Vote Status (Primary: On-chain, Fallback: API)
// ============================================================================
export async function getUserVoteStatus(
  address: string,
  network = "mainnet",
): Promise<{ statusList: UserVoteStatus[]; votedProposals: number[]; withdrawableProposals: UserVoteStatus[]; failedProposals?: number[]; }> {
  try {
    // --- 1. 优先尝试从链上获取用户最近 20 条提案的投票状态 ---
    const tronWeb = getTronWeb(network);
    const addresses = getJustLendAddresses(network);
    const contract = tronWeb.contract(GOVERNOR_ALPHA_ABI, addresses.governorAlpha);

    const proposalCount = await contract.methods.proposalCount().call();
    const count = Number(proposalCount.toString());
    const statusList: UserVoteStatus[] = [];
    const failedProposals: number[] = [];

    const startId = count;
    const endId = Math.max(1, count - 19);

    for (let pId = startId; pId >= endId; pId--) {
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
            canWithdraw: stateNum !== 1, // 非活跃状态即可提取
            state: stateNum,
            stateText: PROPOSAL_STATES[stateNum] || `Unknown(${stateNum})`,
          });
        }
      } catch (err: any) {
        // Per-proposal failure — don't abort the whole scan, but record the
        // proposal id so the caller can tell the difference between
        // "user has not voted" and "we could not read the receipt".
        failedProposals.push(pId);
        console.warn(`[getUserVoteStatus] Failed receipt fetch for proposal ${pId}: ${err?.message ?? err}`);
      }
    }

    const votedProposals = statusList.map(i => i.proposalId);
    const withdrawableProposals = statusList.filter(i => i.canWithdraw);
    return {
      statusList,
      votedProposals,
      withdrawableProposals,
      ...(failedProposals.length > 0 ? { failedProposals } : {}),
    };

  } catch (error: any) {
    console.error(`[API Fallback] On-chain user vote query failed, falling back to API: ${error?.message ?? error}`);

    // --- 2. 链上失败时，兜底请求后端 API ---
    const host = getApiHost(network);
    const block = await getCurrentBlock(network);
    const url = `${host}/justlend/gov/voteStatus?account=${encodeURIComponent(address)}&block=${block}`;
    const response = await fetchWithTimeout(url);
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

export async function approveJSTForVoting(amount: string, network = "mainnet"): Promise<{ txID: string; message: string; warning?: string }> {
  if (amount === undefined || amount === null || amount === "") {
    throw new Error(
      `approve_jst_for_voting requires an explicit amount. Pass the exact value you intend to deposit ` +
      `(e.g. amount='1000'), or pass amount='max' to grant unlimited allowance (NOT recommended — see warning).`,
    );
  }
  await getSigningClient(network);
  const addresses = getJustLendAddresses(network);
  const isMax = amount.toLowerCase() === "max";
  const approveAmount = isMax ? MAX_UINT256 : utils.parseUnits(amount, JST_DECIMALS).toString();

  const { txID } = await safeSend({
    address: addresses.jst, abi: TRC20_ABI, functionName: "approve", args: [addresses.wjst, approveAmount]
  }, network);
  const result: { txID: string; message: string; warning?: string } = {
    txID,
    message: `Approved ${isMax ? "unlimited" : amount} JST for WJST voting contract`,
  };
  if (isMax) {
    result.warning =
      `⚠️ UNLIMITED APPROVAL granted. The WJST contract can now spend your entire JST balance — ` +
      `present and future — without further confirmation. ` +
      `If you no longer need this, revoke with: approve_jst_for_voting amount='0'.`;
  }
  return result;
}

export async function depositJSTForVotes(amount: string, network = "mainnet"): Promise<{ txID: string; amount: string; message: string }> {
  const tronWeb = await getSigningClient(network);
  const addresses = getJustLendAddresses(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;
  const amountRaw = utils.parseUnits(amount, JST_DECIMALS);

  const token = tronWeb.contract(TRC20_ABI, addresses.jst);
  const jstBalance = BigInt(await token.methods.balanceOf(walletAddress).call());
  if (jstBalance < amountRaw) throw new Error(`Insufficient JST balance.`);
  const allowance = BigInt(await token.methods.allowance(walletAddress, addresses.wjst).call());
  if (allowance < amountRaw) throw new Error(`Insufficient JST allowance.`);

  const { txID } = await safeSend({
    address: addresses.wjst, abi: WJST_ABI, functionName: "deposit", args: [amountRaw.toString()]
  }, network);
  return { txID, amount, message: `Deposited ${amount} JST to get voting power (WJST)` };
}

export async function withdrawVotesToJST(amount: string, network = "mainnet"): Promise<{ txID: string; amount: string; message: string }> {
  const tronWeb = await getSigningClient(network);
  const addresses = getJustLendAddresses(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;
  const amountRaw = utils.parseUnits(amount, JST_DECIMALS);

  const voteInfo = await getVoteInfo(walletAddress, network);
  const surplusVotes = BigInt(voteInfo.surplusVotesRaw);
  if (surplusVotes < amountRaw) throw new Error(`Insufficient available votes.`);

  const { txID } = await safeSend({
    address: addresses.wjst, abi: WJST_ABI, functionName: "withdraw", args: [amountRaw.toString()]
  }, network);
  return { txID, amount, message: `Withdrew ${amount} WJST back to JST` };
}

export async function castVote(proposalId: number, support: boolean, votes: string, network = "mainnet"): Promise<{ txID: string; proposalId: number; support: string; votes: string; message: string }> {
  const tronWeb = await getSigningClient(network);
  const addresses = getJustLendAddresses(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;
  const votesRaw = utils.parseUnits(votes, JST_DECIMALS);

  const voteInfo = await getVoteInfo(walletAddress, network);
  const surplusVotes = BigInt(voteInfo.surplusVotesRaw);
  if (surplusVotes < votesRaw) throw new Error(`Insufficient available votes.`);

  const supportValue = support ? 1 : 0;
  const { txID } = await safeSend({
    address: addresses.governorAlpha, abi: GOVERNOR_ALPHA_ABI, functionName: "castVote", args: [proposalId, votesRaw.toString(), supportValue]
  }, network);
  return { txID, proposalId, support: support ? "For" : "Against", votes, message: `Cast ${votes} votes ${support ? "for" : "against"} proposal #${proposalId}` };
}

export async function withdrawVotesFromProposal(proposalId: number, network = "mainnet"): Promise<{ txID: string; proposalId: number; message: string }> {
  const tronWeb = await getSigningClient(network);
  const addresses = getJustLendAddresses(network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;

  const locked = await getLockedVotes(walletAddress, proposalId, network);
  if (BigInt(locked.lockedVotesRaw) === 0n) throw new Error(`No locked votes found for proposal #${proposalId}.`);

  const { txID } = await safeSend({
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
