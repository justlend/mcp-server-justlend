import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getJustLendAddresses, getAllJTokens, getSupportedNetworks } from "./chains.js";

/**
 * Register static resources that MCP clients can read.
 */
export function registerJustLendResources(server: McpServer) {
  server.registerResource(
    "justlend://protocol-info",
    "justlend://protocol-info",
    {
      description: "JustLend DAO protocol information and contract addresses",
      mimeType: "application/json",
    },
    async () => {
      const networks = getSupportedNetworks();
      const info: Record<string, any> = {};

      for (const network of networks) {
        try {
          const addresses = getJustLendAddresses(network);
          const tokens = getAllJTokens(network);
          info[network] = {
            comptroller: addresses.comptroller,
            priceOracle: addresses.priceOracle,
            lens: addresses.lens,
            markets: tokens.map((t) => ({
              symbol: t.symbol,
              underlyingSymbol: t.underlyingSymbol,
              address: t.address,
              underlying: t.underlying || "native TRX",
            })),
          };
        } catch {
          info[network] = { error: "Not configured" };
        }
      }

      return {
        contents: [{
          uri: "justlend://protocol-info",
          mimeType: "application/json",
          text: JSON.stringify({
            protocol: "JustLend DAO",
            description: "Decentralized lending protocol on TRON (Compound V2 fork)",
            website: "https://justlend.org",
            docs: "https://docs.justlend.org",
            networks: info,
          }, null, 2),
        }],
      };
    },
  );
}
