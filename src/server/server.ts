import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerJustLendResources } from "../core/resources.js";
import { registerJustLendTools } from "../core/tools/index.js";
import { registerJustLendPrompts } from "../core/prompts.js";
import { getSupportedNetworks } from "../core/chains.js";
import { checkWalletStatus } from "../core/services/wallet.js";
import { SERVER_VERSION } from "./version.js";

async function startServer() {
  try {
    const server = new McpServer(
      {
        name: "mcp-server-justlend",
        version: SERVER_VERSION,
      },
      {
        // Bound cumulative array elements and object members before schema
        // validation. The HTTP parser's byte limit alone cannot bound its cost.
        maxToolInputElements: 10_000,
        instructions:
          "JustLend MCP Server — TRON lending protocol + general chain utilities.\n\n" +
          "IMPORTANT: On the FIRST user interaction, call `get_wallet_address` to check wallet status. " +
          "If walletMode is \"unset\", you MUST present the wallet choice BEFORE doing anything else:\n" +
          "  • Recommended: Agent wallet — call `set_wallet_mode` with mode=\"agent\" and configure AGENT_WALLET_PASSWORD.\n" +
          "  • Browser wallet is temporarily disabled until the local bridge has request-level authentication.\n" +
          "Read-only queries (market data, account lookups) work without a wallet, but always present the choice first so users understand their options.\n\n" +
          "After wallet is set up, show a brief feature overview and ask what the user wants to do.",
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

    console.error(`@justlend/mcp-server-justlend v${SERVER_VERSION} initialized`);
    console.error(`Supported networks: ${getSupportedNetworks().join(", ")}`);

    // Do not auto-create an agent wallet on startup.
    // Do not expose the legacy unauthenticated browser bridge.
    try {
      const status = await checkWalletStatus();
      if (status.hasWallets && status.activeAddress) {
        console.error(`Agent wallet available: ${status.activeAddress} (id: ${status.activeWalletId})`);
      } else {
        console.error("Wallet mode: no selection yet");
        console.error("  Recommended: set_wallet_mode with mode='agent' and AGENT_WALLET_PASSWORD");
      }
    } catch (error: any) {
      console.error(`Wallet status check failed — ${error.message}`);
      console.error("  Users can select agent mode with set_wallet_mode later.");
    }

    console.error("Server is ready to handle requests");

    return server;
  } catch (error) {
    console.error("Failed to initialize server:", error);
    process.exit(1);
  }
}

export default startServer;
