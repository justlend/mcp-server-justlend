import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerJustLendResources } from "../core/resources.js";
import { registerJustLendTools } from "../core/tools.js";
import { registerJustLendPrompts } from "../core/prompts.js";
import { getSupportedNetworks } from "../core/chains.js";
import { checkWalletStatus } from "../core/services/wallet.js";

async function startServer() {
  try {
    const server = new McpServer(
      {
        name: "mcp-server-justlend",
        version: "1.0.2",
      },
      {
        capabilities: {
          tools: { listChanged: true },
          resources: { subscribe: false, listChanged: true },
          prompts: { listChanged: true },
          logging: {},
        },
      },
    );

    registerJustLendResources(server);
    registerJustLendTools(server);
    registerJustLendPrompts(server);

    console.error("@justlend/mcp-server-justlend v1.0.2 initialized");
    console.error(`Supported networks: ${getSupportedNetworks().join(", ")}`);

    // Do not auto-create an agent wallet on startup.
    // Let the user explicitly choose between browser wallet and agent-wallet.
    try {
      const status = await checkWalletStatus();
      if (status.hasWallets && status.activeAddress) {
        console.error(`Agent wallet available: ${status.activeAddress} (id: ${status.activeWalletId})`);
      } else {
        console.error("Wallet mode: no selection yet");
        console.error("  Recommended: connect_browser_wallet to use TronLink");
        console.error("  Alternative: set_wallet_mode with mode='agent' to create/use agent-wallet");
      }
    } catch (error: any) {
      console.error(`Wallet status check failed — ${error.message}`);
      console.error("  Users can still choose connect_browser_wallet or set_wallet_mode later.");
    }

    console.error("Server is ready to handle requests");

    return server;
  } catch (error) {
    console.error("Failed to initialize server:", error);
    process.exit(1);
  }
}

export default startServer;
