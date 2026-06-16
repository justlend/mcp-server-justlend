import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as services from "../services/index.js";
import { getMoolahVaultInfo } from "../chains.js";
import { TRC20_ABI } from "../abis.js";
import { toolError, tronAddress, amountOrMaxString } from "./shared.js";

/** Returns true when the vault's TRC20 allowance is already sufficient. */
async function hasVaultAllowance(
  vaultSymbol: string,
  amount: string,
  walletAddress: string,
  network: string,
): Promise<boolean> {
  const vault = getMoolahVaultInfo(vaultSymbol, network);
  if (!vault.underlying) return true; // native TRX — no approval needed
  const raw = await services.readContract(
    { address: vault.underlying, functionName: "allowance", args: [walletAddress, vault.address], abi: TRC20_ABI },
    network,
  );
  const required = services.utils.parseUnits(amount, vault.underlyingDecimals);
  return BigInt(raw.toString()) >= required;
}

export function registerMoolahVaultTools(server: McpServer) {

  // ── Read ────────────────────────────────────────────────────────────────────

  server.registerTool(
    "get_moolah_vaults",
    {
      description:
        "List all JustLend V2 (Moolah) vaults with APY, TVL, and underlying token. " +
        "Vaults are ERC4626 — deposit tokens to earn auto-compounding yield allocated across Moolah markets.",
      inputSchema: {
        depositToken: z.string().optional().describe("Filter by deposit token symbol (e.g. 'USDT', 'TRX')"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Moolah Vaults", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ depositToken, network = services.getGlobalNetwork() }) => {
      try {
        const res = await services.fetchMoolahVaultList({ deposit: depositToken, pageSize: 20 }, network);
        return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_moolah_vault",
    {
      description:
        "Get detailed info for a single Moolah vault: APY, TVL, allocation, and the user's share balance if address is provided. " +
        "vaultSymbol is 'TRX', 'USDT', or 'USDD'.",
      inputSchema: {
        vaultSymbol: z.string().describe("Vault symbol: 'TRX', 'USDT', or 'USDD'"),
        address: tronAddress("User address to include share balance. Default: configured wallet").optional(),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Get Moolah Vault", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ vaultSymbol, address, network = services.getGlobalNetwork() }) => {
      try {
        const vault = getMoolahVaultInfo(vaultSymbol, network);
        const userAddr = address || (await services.getWalletAddress().catch(() => ""));

        const [vaultInfo, allocation] = await Promise.all([
          services.fetchMoolahVaultInfo(vault.address, network),
          services.fetchMoolahVaultAllocation(vault.address, {}, network),
        ]);

        let userPosition = null;
        if (userAddr) {
          userPosition = await services.fetchMoolahUserVaultPosition(vault.address, userAddr, network).catch(() => null);
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({ vault: vaultInfo, allocation: allocation.list, userPosition }, null, 2),
          }],
        };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  // ── Write ───────────────────────────────────────────────────────────────────

  server.registerTool(
    "approve_moolah_vault",
    {
      description:
        "Approve TRC20 token spending for a Moolah vault before depositing. " +
        "Not needed for TRX vaults. Pass the EXACT amount you intend to deposit (recommended). " +
        "Pass amount='max' for unlimited approval ONLY when the user explicitly opts in — it lets the vault " +
        "contract spend the user's entire balance, present and future, until revoked (amount='0').",
      inputSchema: {
        vaultSymbol: z.string().describe("Vault symbol: 'USDT' or 'USDD'"),
        amount: amountOrMaxString("Exact amount to approve (e.g. '100'), or 'max' for unlimited (NOT recommended; user must opt in)."),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Approve Moolah Vault", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ vaultSymbol, amount, network = services.getGlobalNetwork() }) => {
      try {
        const result = await services.approveMoolahVault({ vaultSymbol, amount, network });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "moolah_vault_deposit",
    {
      description:
        "Deposit assets into a Moolah ERC4626 vault to earn yield. " +
        "For TRC20 vaults (USDT, USDD), call approve_moolah_vault first. " +
        "Returns vault shares representing your deposit.",
      inputSchema: {
        vaultSymbol: z.string().describe("Vault symbol: 'TRX', 'USDT', or 'USDD'"),
        amount: z.string().describe("Amount of underlying to deposit (e.g. '1000' for 1000 USDT)"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Moolah Vault Deposit", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ vaultSymbol, amount, network = services.getGlobalNetwork() }) => {
      try {
        const walletAddr = await services.getWalletAddress();
        const sufficient = await hasVaultAllowance(vaultSymbol, amount, walletAddr, network);
        if (!sufficient) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                status: "approval_required",
                message: `Insufficient allowance for ${vaultSymbol} vault. Call approve_moolah_vault first.`,
                suggestedTool: "approve_moolah_vault",
                args: { vaultSymbol, amount: "max" },
              }, null, 2),
            }],
          };
        }
        const result = await services.moolahVaultDeposit({ vaultSymbol, amount, network });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "moolah_vault_withdraw",
    {
      description:
        "Withdraw underlying assets from a Moolah vault by specifying the asset amount. " +
        "Use amount='max' to withdraw everything. No approval needed.",
      inputSchema: {
        vaultSymbol: z.string().describe("Vault symbol: 'TRX', 'USDT', or 'USDD'"),
        amount: z.string().describe("Amount of underlying to withdraw, or 'max' for full withdrawal"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Moolah Vault Withdraw", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ vaultSymbol, amount, network = services.getGlobalNetwork() }) => {
      try {
        const result = await services.moolahVaultWithdraw({ vaultSymbol, amount, network });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "moolah_vault_redeem",
    {
      description:
        "Redeem vault shares to receive underlying assets. " +
        "Use shares='max' to redeem all shares. No approval needed.",
      inputSchema: {
        vaultSymbol: z.string().describe("Vault symbol: 'TRX', 'USDT', or 'USDD'"),
        shares: z.string().describe("Number of shares to redeem, or 'max' for all shares"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Moolah Vault Redeem", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ vaultSymbol, shares, network = services.getGlobalNetwork() }) => {
      try {
        const result = await services.moolahVaultRedeem({ vaultSymbol, shares, network });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );
}
