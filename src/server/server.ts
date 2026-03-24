import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerJustLendResources } from "../core/resources.js";
import { registerJustLendTools } from "../core/tools.js";
import { registerJustLendPrompts } from "../core/prompts.js";
import { getSupportedNetworks } from "../core/chains.js";
import { autoInitWallet } from "../core/services/wallet.js";

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

    // Auto-initialize wallet on startup — generates a new encrypted wallet if none exists
    try {
      const { address, walletId, created } = await autoInitWallet();
      if (created) {
        console.error(`Wallet: auto-generated new wallet "${walletId}"`);
        console.error(`  Address: ${address}`);
        console.error("  Encrypted private key stored in ~/.agent-wallet/");
        console.error("  Fund this address with TRX before performing write operations.");
      } else {
        console.error(`Wallet: ${address} (id: ${walletId})`);
      }
    } catch (error: any) {
      console.error(`Wallet: initialization failed — ${error.message}`);
      console.error("  Write operations will fail. Use the import_wallet tool or set AGENT_WALLET_PASSWORD.");
    }

    console.error("Server is ready to handle requests");

    return server;
  } catch (error) {
    console.error("Failed to initialize server:", error);
    process.exit(1);
  }
}

export default startServer;
