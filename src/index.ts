import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import startServer from "./server/server.js";
import { createSessionState, runWithSessionState } from "./core/services/global.js";

async function main() {
  try {
    const server = await startServer();
    const transport = new StdioServerTransport();
    const state = createSessionState("stdio");
    await runWithSessionState(state, async () => {
      await server.connect(transport);
      console.error("@justlend/mcp-server-justlend running on stdio");
    });
  } catch (error) {
    console.error("Error starting MCP server:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
