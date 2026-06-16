import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as services from "../services/index.js";
import { toolError, tronAddress } from "./shared.js";

/**
 * Historical transaction records (paginated REST).
 *
 * All endpoints here are **mainnet-only** — the `labc.ablesdxd.link` host
 * does not have nile counterparts. Passing network='nile' will throw early.
 *
 * The V2 Moolah records tool (`get_moolah_records`) lives in
 * `moolah-dashboard-tools.ts` to keep the `moolah_` namespace cohesive.
 */
export function registerRecordsTools(server: McpServer) {

  server.registerTool(
    "get_lending_records",
    {
      description:
        "Get a user's V1 JustLend transaction history: supply, withdraw, borrow, repay, and collateral enable/disable. " +
        "Paginated. Each record includes actionType (1-11), actionName (human-readable), token, amount, USD value, and txId. " +
        "Mainnet-only.",
      inputSchema: {
        address: tronAddress("TRON address (T...). Default: configured wallet"),
        page: z.number().optional().describe("Page number, 1-indexed. Default: 1"),
        pageSize: z.number().optional().describe("Records per page. Default: 20"),
        network: z.string().optional().describe("Must be 'mainnet'. Default: mainnet"),
      },
      annotations: { title: "Get V1 Lending Records", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, page = 1, pageSize = 20, network = services.getGlobalNetwork() }) => {
      try {
        const userAddr = address || await services.getWalletAddress();
        const res = await services.fetchLendingRecords(userAddr, page, pageSize, network);
        return { content: [{ type: "text", text: JSON.stringify({ address: userAddr, ...res }, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_strx_records",
    {
      description:
        "Get a user's sTRX staking history: stake, unstake, withdraw (after unbonding), and sTRX transfers. " +
        "Each record has opType (1-6) and a human-readable opName. Paginated. Mainnet-only.",
      inputSchema: {
        address: tronAddress("TRON address. Default: configured wallet"),
        page: z.number().optional().describe("Page number, 1-indexed. Default: 1"),
        pageSize: z.number().optional().describe("Records per page. Default: 20"),
        network: z.string().optional().describe("Must be 'mainnet'. Default: mainnet"),
      },
      annotations: { title: "Get sTRX Records", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, page = 1, pageSize = 20, network = services.getGlobalNetwork() }) => {
      try {
        const userAddr = address || await services.getWalletAddress();
        const res = await services.fetchStrxRecords(userAddr, page, pageSize, network);
        return { content: [{ type: "text", text: JSON.stringify({ address: userAddr, ...res }, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_vote_records",
    {
      description:
        "Get a user's governance voting history: get_vote (JST → WJST deposits), votes cast for/against proposals, " +
        "vote withdrawals, and JST conversions back. Each record has opType (1-6), opName, amount, and proposalId " +
        "(for votes and withdrawals). Use get_user_vote_status for real-time current voting power. Mainnet-only.",
      inputSchema: {
        address: tronAddress("TRON address. Default: configured wallet"),
        page: z.number().optional().describe("Page number, 1-indexed. Default: 1"),
        pageSize: z.number().optional().describe("Records per page. Default: 20"),
        network: z.string().optional().describe("Must be 'mainnet'. Default: mainnet"),
      },
      annotations: { title: "Get Vote Records", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, page = 1, pageSize = 20, network = services.getGlobalNetwork() }) => {
      try {
        const userAddr = address || await services.getWalletAddress();
        const res = await services.fetchVoteRecords(userAddr, page, pageSize, network);
        return { content: [{ type: "text", text: JSON.stringify({ address: userAddr, ...res }, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_energy_rental_records",
    {
      description:
        "Get a user's JustLend energy-rental history: rent, extend, rent_more, end, recycle actions. " +
        "Distinct from get_user_energy_rental_orders which returns current active on-chain orders — " +
        "this one returns the full historical action log. Paginated. Mainnet-only.",
      inputSchema: {
        address: tronAddress("TRON address. Default: configured wallet"),
        page: z.number().optional().describe("Page number, 1-indexed. Default: 1"),
        pageSize: z.number().optional().describe("Records per page. Default: 20"),
        network: z.string().optional().describe("Must be 'mainnet'. Default: mainnet"),
      },
      annotations: { title: "Get Energy Rental Records", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, page = 1, pageSize = 20, network = services.getGlobalNetwork() }) => {
      try {
        const userAddr = address || await services.getWalletAddress();
        const res = await services.fetchEnergyRentalRecords(userAddr, page, pageSize, network);
        return { content: [{ type: "text", text: JSON.stringify({ address: userAddr, ...res }, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_claimable_rewards",
    {
      description:
        "Scan all JustLend V1 merkle airdrop distributors for a user's unclaimed rewards. Returns a map keyed by " +
        "round; each entry includes the merkleIndex, index, amount(s), token symbol/address, and proof. " +
        "Feed any returned key into claim_v1_mining_period to submit the on-chain multiClaim. Mainnet-only.",
      inputSchema: {
        address: tronAddress("TRON address. Default: configured wallet"),
        network: z.string().optional().describe("Must be 'mainnet'. Default: mainnet"),
      },
      annotations: { title: "Get Claimable Rewards", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, network = services.getGlobalNetwork() }) => {
      try {
        const userAddr = address || await services.getWalletAddress();
        const res = await services.fetchClaimableRewards(userAddr, network);
        const count = Object.keys(res.merkleRewards ?? {}).length;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              address: userAddr,
              distributorCount: count,
              rewards: res.merkleRewards,
              note: count === 0
                ? "No claimable rewards found for this address."
                : "Pass any of the returned keys to claim_v1_mining_period to submit the multiClaim transaction.",
            }, null, 2),
          }],
        };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "claim_v1_mining_period",
    {
      description:
        "Claim a single V1 mining airdrop round via multiClaim() on the appropriate merkle distributor. " +
        "Pass `key` from get_claimable_rewards (preferred) or supply merkleIndex / index / amount / proof directly. " +
        "Routing matches the front-app: amount[] → multi-merkle distributor (multi-token leaf); single + USDD → " +
        "USDDNEW distributor; single + other → main distributor. Mainnet-only.",
      inputSchema: {
        key:          z.string().optional().describe("Round key from get_claimable_rewards (preferred)"),
        merkleIndex:  z.union([z.string(), z.number()]).optional().describe("Override: merkle tree index"),
        index:        z.union([z.string(), z.number()]).optional().describe("Override: leaf index inside the tree"),
        amount:       z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]).optional().describe("Override: token amount(s) in raw units; pass an array for multi-token leaves"),
        proof:        z.array(z.string()).optional().describe("Override: merkle proof (bytes32[])"),
        tokenAddress: z.union([z.string(), z.array(z.string())]).optional().describe("Override: token address(es) used for routing when the entry is single-token"),
        tokenSymbol:  z.union([z.string(), z.array(z.string())]).optional().describe("Override: token symbol(s); useful when tokenAddress is missing"),
        distributor:  tronAddress("Force a specific distributor address. Set with `selector` to bypass routing.").optional(),
        selector:     z.enum(["single", "multi"]).optional().describe("Force a selector. 'single' = (uint256,uint256,uint256,bytes32[])[]; 'multi' = (uint256,uint256,uint256[],bytes32[])[]"),
        address:      tronAddress("Owner address used to refetch the airdrop entry when key is supplied. Default: signing wallet").optional(),
        network:      z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Claim V1 Mining Period", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ key, merkleIndex, index, amount, proof, tokenAddress, tokenSymbol, distributor, selector, address, network = services.getGlobalNetwork() }) => {
      try {
        const res = await services.claimV1MiningPeriod({
          key,
          merkleIndex,
          index,
          amount,
          proof,
          tokenAddress,
          tokenSymbol,
          distributor,
          selector,
          address,
          network,
        });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_liquidation_records",
    {
      description:
        "Get a user's V1 JustLend liquidation history — both positions the user liquidated and positions where the user was liquidated. " +
        "Distinct from get_moolah_liquidation_records which covers V2 Moolah liquidations. Paginated. Mainnet-only.",
      inputSchema: {
        address: tronAddress("TRON address. Default: configured wallet"),
        page: z.number().optional().describe("Page number, 1-indexed. Default: 1"),
        pageSize: z.number().optional().describe("Records per page. Default: 20"),
        network: z.string().optional().describe("Must be 'mainnet'. Default: mainnet"),
      },
      annotations: { title: "Get V1 Liquidation Records", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, page = 1, pageSize = 20, network = services.getGlobalNetwork() }) => {
      try {
        const userAddr = address || await services.getWalletAddress();
        const res = await services.fetchLiquidationRecords(userAddr, page, pageSize, network);
        return { content: [{ type: "text", text: JSON.stringify({ address: userAddr, ...res }, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );
}
