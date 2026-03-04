import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerJustLendResources } from "../core/resources.js";
import { registerJustLendTools } from "../core/tools.js";
import { registerJustLendPrompts } from "../core/prompts.js";
import { getSupportedNetworks } from "../core/chains.js";

async function startServer() {
  try {
    const server = new McpServer(
      {
        name: "mcp-server-TLD",
        version: "1.0.0",
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

    console.error("mcp-server-TLD v1.0.0 initialized");
    console.error(`Supported networks: ${getSupportedNetworks().join(", ")}`);
    console.error("Server is ready to handle requests");

    return server;
  } catch (error) {
    console.error("Failed to initialize server:", error);
    process.exit(1);
  }
}

export default startServer;
