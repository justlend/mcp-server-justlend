import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWalletTools } from "./wallet-tools.js";
import { registerMarketTools } from "./market-tools.js";
import { registerLendingTools } from "./lending-tools.js";
import { registerVotingTools } from "./voting-tools.js";
import { registerEnergyTools } from "./energy-tools.js";
import { registerStakingTools } from "./staking-tools.js";

/**
 * Register all JustLend MCP tools.
 *
 * SECURITY: Private keys are managed by @bankofai/agent-wallet, never stored in environment
 * variables or passed as tool arguments. Run `agent-wallet start` to set up the encrypted wallet.
 */
export function registerJustLendTools(server: McpServer) {
  registerWalletTools(server);
  registerMarketTools(server);
  registerLendingTools(server);
  registerVotingTools(server);
  registerEnergyTools(server);
  registerStakingTools(server);
}
