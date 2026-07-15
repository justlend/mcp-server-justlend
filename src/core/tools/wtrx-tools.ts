import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as services from "../services/index.js";
import { amountString, toolError } from "./shared.js";

/**
 * WTRX (Wrapped TRX) wrap / unwrap tools.
 *
 * WTRX is the WETH-style TRC20 wrapper for native TRX (1:1). DeFi protocols that
 * cannot hold native TRX (e.g. JustLend V2 / Moolah markets quoting WTRX) use it.
 * Mirrors the app-justlend swap flow (`wtrxDeposit` / `wtrxWithdraw`).
 */
export function registerWtrxTools(server: McpServer) {
  server.registerTool(
    "wrap_trx",
    {
      description:
        "Wrap native TRX into WTRX (Wrapped TRX) at a 1:1 rate by sending TRX to the WTRX " +
        "contract's payable deposit(). WTRX is a TRC20 representation of TRX used by DeFi " +
        "protocols that can't hold native TRX (e.g. JustLend V2 / Moolah markets quoting WTRX). " +
        "Reversible: unwrap_trx converts WTRX back to TRX 1:1. " +
        "Pre-checks: sufficient TRX balance for the wrap amount + gas.",
      inputSchema: {
        amount: amountString("Amount of TRX to wrap into WTRX (human-readable decimal string, e.g. '1' or '10.5')"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Wrap TRX to WTRX", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ amount, network = services.getGlobalNetwork() }) => {
      try {
        const result = await services.wrapTrx(amount, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "unwrap_trx",
    {
      description:
        "Unwrap WTRX (Wrapped TRX) back into native TRX at a 1:1 rate via the WTRX contract's " +
        "withdraw(uint256). No approval is needed — you burn your own WTRX. Reverses wrap_trx (1:1). " +
        "Pre-checks: sufficient WTRX balance and native TRX for gas.",
      inputSchema: {
        amount: amountString("Amount of WTRX to unwrap into TRX (human-readable decimal string, e.g. '1' or '10.5')"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Unwrap WTRX to TRX", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ amount, network = services.getGlobalNetwork() }) => {
      try {
        const result = await services.unwrapTrx(amount, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return toolError(error);
      }
    },
  );
}
