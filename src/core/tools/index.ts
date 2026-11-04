import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWalletTools } from "./wallet-tools.js";
import { registerMarketTools } from "./market-tools.js";
import { registerLendingTools } from "./lending-tools.js";
import { registerVotingTools } from "./voting-tools.js";
import { registerEnergyTools } from "./energy-tools.js";
import { registerStakingTools } from "./staking-tools.js";
import { registerWtrxTools } from "./wtrx-tools.js";
import { registerMoolahVaultTools } from "./moolah-vault-tools.js";
import { registerMoolahMarketTools } from "./moolah-market-tools.js";
import { registerMoolahLiquidationTools } from "./moolah-liquidation-tools.js";
import { registerMoolahDashboardTools } from "./moolah-dashboard-tools.js";
import { registerMoolahMiningTools } from "./moolah-mining-tools.js";
import { registerRecordsTools } from "./records-tools.js";
import { withStructuredToolOutputs } from "./structured-output.js";
import { registerRiskAlertTools } from "./risk-alert-tools.js";

/**
 * Register all JustLend MCP tools.
 *
 * SECURITY: Private keys are managed by @bankofai/agent-wallet, never stored in environment
 * variables or passed as tool arguments. Run `agent-wallet start` to set up the encrypted wallet.
 */
export function registerJustLendTools(server: McpServer) {
  const structuredServer = withStructuredToolOutputs(server);
  registerWalletTools(structuredServer);
  registerMarketTools(structuredServer);
  registerLendingTools(structuredServer);
  registerVotingTools(structuredServer);
  registerEnergyTools(structuredServer);
  registerStakingTools(structuredServer);
  registerWtrxTools(structuredServer);
  // JustLend V2 (Moolah)
  registerMoolahVaultTools(structuredServer);
  registerMoolahMarketTools(structuredServer);
  registerMoolahLiquidationTools(structuredServer);
  registerMoolahDashboardTools(structuredServer);
  registerMoolahMiningTools(structuredServer);
  // Historical records (V1 + cross-cutting)
  registerRecordsTools(structuredServer);
  registerRiskAlertTools(structuredServer);
}
