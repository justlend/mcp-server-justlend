import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as services from "../services/index.js";
import { toolError, tronAddress } from "./shared.js";

/**
 * JustLend V2 (Moolah) — Mining rewards.
 *
 * Mirrors the front-app useMining.js surface: vault APY, accruing/settling
 * state, claimable merkle rounds, and the multi-token claim write path.
 *
 * Note: the V2 merkle distributor is not yet deployed on mainnet. Read-only
 * APIs work on both networks; `claim_moolah_mining_period` errors clearly
 * when the distributor address is empty for the requested network.
 */
export function registerMoolahMiningTools(server: McpServer) {

  // ── Read ───────────────────────────────────────────────────────────────────

  server.registerTool(
    "get_moolah_vault_mining_apy",
    {
      description:
        "Get V2 mining APY for a single Moolah vault. Returns the USDD / TRX APY split " +
        "and total (encoded as a fraction, e.g. 0.123 = 12.3%). enabled=true means the " +
        "vault is active in mining and qualifies for the fire-icon UI hint.",
      inputSchema: {
        vaultAddress: tronAddress("Vault contract address (Base58 T...)"),
        network:      z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Moolah Vault Mining APY", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ vaultAddress, network = services.getGlobalNetwork() }) => {
      try {
        const res = await services.getMoolahVaultMiningApy(vaultAddress, network);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_moolah_mining_resolver",
    {
      description:
        "Map every Moolah vault with active mining to its USDD / TRX APY split. " +
        "Used by the dashboard to prefetch fire-icon eligibility in one round-trip. " +
        "Vaults with zero mining APY are excluded from the response.",
      inputSchema: {
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Moolah Mining Resolver", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ network = services.getGlobalNetwork() }) => {
      try {
        const res = await services.getMoolahMiningResolver(network);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_moolah_mining_accruing",
    {
      description:
        "Get a user's accruing & settling V2 mining rewards across vaults. " +
        "accruingUsd = current round still emitting; settlingUsd = previous round " +
        "in the brief settlement window (miningStatus=2, currRewardStatus=1) — " +
        "excluded otherwise so it doesn't double-count with already-published merkle airdrops. " +
        "globalSettlementStatus=true means the backend reports any token in flux; treat per-token amounts as provisional.",
      inputSchema: {
        address: tronAddress("TRON address. Default: configured wallet").optional(),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Moolah Mining Accruing", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, network = services.getGlobalNetwork() }) => {
      try {
        const userAddr = address || (await services.getWalletAddress());
        const res = await services.getMoolahAccruingMining(userAddr, network);
        return { content: [{ type: "text", text: JSON.stringify({ address: userAddr, ...res }, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_moolah_pending_mining_periods",
    {
      description:
        "Get a user's claimable V2 mining airdrop rounds (already settled and merkle-published). " +
        "Each period includes merkleIndex, index, per-token amounts (raw + decimal-shifted), " +
        "the merkle proof, and a USD total. Feed a periodKey directly into claim_moolah_mining_period " +
        "to submit the on-chain multiClaim. Set includeClaimed=true to also return rounds the indexer " +
        "marks as already claimed (default false matches the rewards card behaviour).",
      inputSchema: {
        address: tronAddress("TRON address. Default: configured wallet").optional(),
        includeClaimed: z.boolean().optional().describe("Include rounds the backend marks as claimed. Default: false"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Moolah Pending Mining Periods", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, includeClaimed, network = services.getGlobalNetwork() }) => {
      try {
        const userAddr = address || (await services.getWalletAddress());
        const res = await services.getMoolahPendingMiningPeriods(userAddr, { includeClaimed, network });
        return { content: [{ type: "text", text: JSON.stringify({ address: userAddr, count: res.periods.length, ...res }, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  // ── Write ──────────────────────────────────────────────────────────────────

  server.registerTool(
    "claim_moolah_mining_period",
    {
      description:
        "Claim a single V2 mining airdrop round via multiClaim() on the Moolah merkle distributor. " +
        "Pass periodKey from get_moolah_pending_mining_periods (preferred) or supply merkleIndex / index / " +
        "amounts / proof directly. Pre-checks isClaimed() and merkleRoots() on-chain so the wallet does not pay " +
        "gas for a guaranteed-revert tx. Mainnet currently errors with 'distributor not configured' until the V2 " +
        "contract ships — nile testnet works.",
      inputSchema: {
        periodKey:   z.string().optional().describe("Round key from get_moolah_pending_mining_periods (preferred)"),
        merkleIndex: z.union([z.string(), z.number()]).optional().describe("Override: merkle tree index"),
        index:       z.union([z.string(), z.number()]).optional().describe("Override: leaf index inside the tree"),
        amounts:     z.array(z.union([z.string(), z.number()])).optional().describe("Override: token amounts in raw units, slot-aligned with the tree's tokenAddress[]"),
        proof:       z.array(z.string()).optional().describe("Override: merkle proof (bytes32[])"),
        address:     tronAddress("Owner address used to refetch the airdrop entry when periodKey is supplied. Default: signing wallet").optional(),
        network:     z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Claim Moolah Mining Period", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ periodKey, merkleIndex, index, amounts, proof, address, network = services.getGlobalNetwork() }) => {
      try {
        const res = await services.claimMoolahMiningPeriod({
          periodKey,
          merkleIndex,
          index,
          amounts,
          proof,
          address,
          network,
        });
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );
}
