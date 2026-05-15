import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as services from "../services/index.js";
import { sanitizeError } from "./shared.js";

export function registerVotingTools(server: McpServer) {

  // ============================================================================
  // JST VOTING / GOVERNANCE
  // ============================================================================

  server.registerTool(
    "get_proposal_list",
    {
      description: "Get the list of JustLend DAO governance proposals. Returns proposals with their status (Active, Passed, Defeated, etc.), vote counts, and details. Sorted by newest first.",
      inputSchema: {
        network: z.string().optional().describe("Network. Default: mainnet"),
        limit: z.number().optional().describe("Max number of proposals to return. Default: 10. Use 0 for all."),
      },
      annotations: { title: "Get Proposal List", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ network = services.getGlobalNetwork(), limit = 10 }) => {
      try {
        const data = await services.getProposalList(network);
        const proposals = limit > 0 ? data.proposals.slice(0, limit) : data.proposals;
        return { content: [{ type: "text", text: JSON.stringify({ proposals, total: data.total, returned: proposals.length }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_user_vote_status",
    {
      description: "Get a user's voting status across all governance proposals. Shows which proposals the user has voted on, their vote amounts (for/against/abstain), and which proposals have withdrawable votes.",
      inputSchema: {
        address: z.string().optional().describe("TRON address. Default: configured wallet"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get User Vote Status", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, network = services.getGlobalNetwork() }) => {
      try {
        const userAddress = address || await services.getWalletAddress();
        const data = await services.getUserVoteStatus(userAddress, network);
        return { content: [{ type: "text", text: JSON.stringify({ address: userAddress, ...data }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_vote_info",
    {
      description:
        "Get voting power info for a user: JST wallet balance, available (surplus) votes, total deposited votes, and votes currently cast in proposals. " +
        "This is the key tool to check before voting — it shows how many votes are available to use.",
      inputSchema: {
        address: z.string().optional().describe("TRON address. Default: configured wallet"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Vote Info", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, network = services.getGlobalNetwork() }) => {
      try {
        const userAddress = address || await services.getWalletAddress();
        const data = await services.getVoteInfo(userAddress, network);
        return {
          content: [{
            type: "text", text: JSON.stringify({
              address: userAddress,
              ...data,
              explanation: {
                jstBalance: "JST tokens in wallet (not yet deposited for voting)",
                surplusVotes: "Available votes that can be cast on proposals",
                totalVote: "Total votes deposited (WJST balance)",
                castVote: "Votes currently locked in active proposals",
              },
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_locked_votes",
    {
      description: "Get the number of votes a user has locked in a specific proposal.",
      inputSchema: {
        proposalId: z.number().describe("The proposal ID to check"),
        address: z.string().optional().describe("TRON address. Default: configured wallet"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Locked Votes", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ proposalId, address, network = services.getGlobalNetwork() }) => {
      try {
        const userAddress = address || await services.getWalletAddress();
        const data = await services.getLockedVotes(userAddress, proposalId, network);
        return { content: [{ type: "text", text: JSON.stringify({ address: userAddress, ...data }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "check_jst_allowance_for_voting",
    {
      description: "Check if JST has been approved for the WJST voting contract. Must be approved before depositing JST to get votes.",
      inputSchema: {
        address: z.string().optional().describe("TRON address. Default: configured wallet"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Check JST Voting Allowance", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, network = services.getGlobalNetwork() }) => {
      try {
        const userAddress = address || await services.getWalletAddress();
        const data = await services.checkJSTAllowanceForVoting(userAddress, network);
        return { content: [{ type: "text", text: JSON.stringify({ address: userAddress, ...data }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "approve_jst_for_voting",
    {
      description:
        "Approve JST token for the WJST voting contract. Required before depositing JST to get voting power. " +
        "Pass the EXACT amount you intend to deposit (recommended). " +
        "Pass amount='max' for unlimited approval ONLY when the user explicitly opts in — it lets the WJST contract spend the user's entire JST balance, present and future, until revoked.",
      inputSchema: {
        amount: z.string().describe("Exact amount to approve (e.g. '1000'), or 'max' for unlimited (NOT recommended; user must opt in)."),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Approve JST for Voting", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ amount, network = services.getGlobalNetwork() }) => {
      try {

        const result = await services.approveJSTForVoting(amount, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "deposit_jst_for_votes",
    {
      description:
        "Deposit JST into the WJST contract to get voting power. " +
        "Requires prior approval of JST for the WJST contract (use approve_jst_for_voting first). " +
        "1 JST = 1 Vote. Deposited JST can be withdrawn back after voting.",
      inputSchema: {
        amount: z.string().describe("Amount of JST to deposit (e.g. '1000')"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Deposit JST for Votes", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ amount, network = services.getGlobalNetwork() }) => {
      try {

        const result = await services.depositJSTForVotes(amount, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "withdraw_votes_to_jst",
    {
      description:
        "Withdraw WJST back to JST. Can only withdraw votes that are not currently locked in active proposals. " +
        "Use get_vote_info to check your surplus (available) votes before withdrawing.",
      inputSchema: {
        amount: z.string().describe("Amount of votes/WJST to withdraw back to JST (e.g. '1000')"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Withdraw Votes to JST", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ amount, network = services.getGlobalNetwork() }) => {
      try {

        const result = await services.withdrawVotesToJST(amount, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "cast_vote",
    {
      description:
        "Cast a vote on a governance proposal. You must have available votes (deposit JST first if needed). " +
        "Support: true = vote FOR, false = vote AGAINST. " +
        "You can add more votes to a proposal you already voted on.",
      inputSchema: {
        proposalId: z.number().describe("The proposal ID to vote on"),
        support: z.boolean().describe("true = vote FOR the proposal, false = vote AGAINST"),
        votes: z.string().describe("Amount of votes to cast (e.g. '1000')"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Cast Vote", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ proposalId, support, votes, network = services.getGlobalNetwork() }) => {
      try {

        const result = await services.castVote(proposalId, support, votes, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "withdraw_votes_from_proposal",
    {
      description:
        "Withdraw (reclaim) votes from a completed or canceled proposal. " +
        "Only works for proposals that are no longer active. " +
        "After withdrawing, the votes become available again for other proposals or can be converted back to JST.",
      inputSchema: {
        proposalId: z.number().describe("The proposal ID to withdraw votes from"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Withdraw Votes from Proposal", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ proposalId, network = services.getGlobalNetwork() }) => {
      try {

        const result = await services.withdrawVotesFromProposal(proposalId, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );
}
