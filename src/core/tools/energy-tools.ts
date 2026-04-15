import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as services from "../services/index.js";
import { sanitizeError } from "./shared.js";

export function registerEnergyTools(server: McpServer) {

  // ============================================================================
  // ENERGY RENTAL (Read)
  // ============================================================================

  server.registerTool(
    "get_energy_rental_dashboard",
    {
      description:
        "Get JustLend energy rental market dashboard data including TRX price, exchange rate, " +
        "total APY, energy per TRX, total supply, and other market parameters.",
      inputSchema: {
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Energy Rental Dashboard", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ network = services.getGlobalNetwork() }) => {
      try {
        const dashboard = await services.getEnergyRentalDashboard(network);
        return { content: [{ type: "text", text: JSON.stringify(dashboard, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_energy_rental_params",
    {
      description:
        "Get on-chain energy rental parameters: liquidation threshold, fee ratio, min fee, " +
        "total delegated/frozen TRX, max rentable amount, rent paused status, usage charge ratio.",
      inputSchema: {
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Energy Rental Parameters", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ network = services.getGlobalNetwork() }) => {
      try {
        const params = await services.getEnergyRentalParams(network);
        return { content: [{ type: "text", text: JSON.stringify(params, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "calculate_energy_rental_price",
    {
      description:
        "Calculate the cost to rent a specific amount of energy for a given duration. " +
        "Returns TRX amount needed, rental rate, fee, total prepayment, security deposit, and daily cost. " +
        "For NEW rentals: provide energyAmount and durationHours. " +
        "For RENEWALS: provide energyAmount and receiverAddress. The tool auto-detects existing rentals " +
        "and calculates the incremental cost (subtracting existing security deposit). " +
        "durationHours is optional for renewals (defaults to 0 = no additional time).",
      inputSchema: {
        energyAmount: z.coerce.number().min(50000).describe("Amount of energy to rent (minimum 300,000 for new rental, minimum 50,000 for renewal)"),
        durationHours: z.coerce.number().min(0).optional().describe("Rental duration in hours. Required for new rentals (minimum 1). Optional for renewals (default 0 = no additional time)."),
        receiverAddress: z.string().optional().describe("Receiver address. If provided, checks for existing rental to calculate renewal cost."),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Calculate Energy Rental Price", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ energyAmount, durationHours, receiverAddress, network = services.getGlobalNetwork() }) => {
      try {
        // Check if this is a renewal by looking for existing rental
        if (receiverAddress) {
          const walletAddress = await services.getWalletAddress();
          const existingRental = await services.getRentInfo(walletAddress, receiverAddress, network);

          if (existingRental.hasActiveRental) {
            // Get remaining seconds from order
            const orders = await services.getUserRentalOrders(walletAddress, "renter", 0, 50, network);
            const matchingOrder = orders.orders.find(
              (o: any) => o.receiver === receiverAddress && o.renter === walletAddress,
            );
            const remainingSeconds = matchingOrder ? Number(matchingOrder.canRentSeconds || 0) : 0;
            const additionalSeconds = (durationHours || 0) * 3600;

            const estimate = await services.calculateRenewalPrice(
              energyAmount,
              existingRental.rentBalance,
              existingRental.securityDeposit,
              remainingSeconds,
              additionalSeconds,
              network,
            );
            return {
              content: [{
                type: "text", text: JSON.stringify({
                  ...estimate,
                  isRenewal: true,
                  durationHours: estimate.durationSeconds / 3600,
                  summary: `Renewal: adding ${energyAmount} energy costs ~${estimate.renewalPrepayment.toFixed(2)} TRX ` +
                    `(existing deposit: ${estimate.existingSecurityDeposit.toFixed(2)} TRX, ` +
                    `existing TRX: ${estimate.existingTrxAmount.toFixed(2)}, ` +
                    `total TRX after: ${estimate.totalTrxAmount})`,
                }, null, 2)
              }]
            };
          }
        }

        // New rental calculation
        if (!durationHours || durationHours < 1) {
          throw new Error("durationHours is required (minimum 1) for new rentals");
        }
        const durationSeconds = durationHours * 3600;
        const estimate = await services.calculateRentalPrice(energyAmount, durationSeconds, network);
        return {
          content: [{
            type: "text", text: JSON.stringify({
              ...estimate,
              isRenewal: false,
              durationHours,
              summary: `Renting ${energyAmount} energy for ${durationHours} hours costs ~${estimate.totalPrepayment.toFixed(2)} TRX ` +
                `(daily: ${estimate.dailyRentalCost.toFixed(2)} TRX, deposit: ${estimate.securityDeposit.toFixed(2)} TRX)`,
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_energy_rental_rate",
    {
      description:
        "Get the current energy rental rate for a given TRX amount. " +
        "Returns rental rate, stable rate, and effective rate (max of both).",
      inputSchema: {
        trxAmount: z.number().min(0).describe("TRX amount to check rate for (0 for base rate)"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Energy Rental Rate", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ trxAmount, network = services.getGlobalNetwork() }) => {
      try {
        const rate = await services.getRentalRate(trxAmount, network);
        return { content: [{ type: "text", text: JSON.stringify(rate, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_user_energy_rental_orders",
    {
      description:
        "Get a user's energy rental orders from JustLend. Can filter by role: " +
        "'renter' (orders where user is renting out), 'receiver' (orders where user receives energy), or 'all'.",
      inputSchema: {
        address: z.string().optional().describe("Address to query. Default: configured wallet"),
        type: z.enum(["renter", "receiver", "all"]).optional().describe("Filter by role. Default: all"),
        page: z.number().optional().describe("Page number (0-indexed). Default: 0"),
        pageSize: z.number().optional().describe("Results per page. Default: 10"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "User Energy Rental Orders", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ address, type = "all", page = 0, pageSize = 10, network = services.getGlobalNetwork() }) => {
      try {
        const addr = address || await services.getWalletAddress();
        const orders = await services.getUserRentalOrders(addr, type, page, pageSize, network);
        return { content: [{ type: "text", text: JSON.stringify(orders, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_energy_rent_info",
    {
      description:
        "Get on-chain energy rental info for a specific renter-receiver pair. " +
        "Returns security deposit, rent balance, and whether an active rental exists.",
      inputSchema: {
        renterAddress: z.string().optional().describe("Renter address. Default: configured wallet"),
        receiverAddress: z.string().describe("Receiver address"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Energy Rent Info", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ renterAddress, receiverAddress, network = services.getGlobalNetwork() }) => {
      try {
        const renter = renterAddress || await services.getWalletAddress();
        const info = await services.getRentInfo(renter, receiverAddress, network);
        return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_return_rental_info",
    {
      description:
        "Get estimated refund info for returning/canceling an energy rental. " +
        "Shows how much TRX would be refunded (estimatedRefundTrx), remaining rent, " +
        "security deposit, usage rental cost, unrecovered energy, and daily rent cost.",
      inputSchema: {
        renterAddress: z.string().optional().describe("Renter address. Default: configured wallet"),
        receiverAddress: z.string().describe("Receiver address"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Return Rental Info", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ renterAddress, receiverAddress, network = services.getGlobalNetwork() }) => {
      try {
        const renter = renterAddress || await services.getWalletAddress();
        const info = await services.getReturnRentalInfo(renter, receiverAddress, network);
        return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  // ============================================================================
  // ENERGY RENTAL (Write)
  // ============================================================================

  server.registerTool(
    "rent_energy",
    {
      description:
        "Rent energy from JustLend for a specified receiver address. " +
        "Automatically calculates TRX needed based on energy amount. " +
        "For NEW rentals: durationHours is required (minimum 1 hour), minimum energy is 300,000. " +
        "For RENEWALS (existing active rental to the same receiver): durationHours is NOT needed — " +
        "the remaining duration from the existing order is used automatically. Minimum energy for renewal is 50,000. " +
        "Pre-checks: rental not paused, amount within limits, sufficient TRX balance.",
      inputSchema: {
        receiverAddress: z.string().describe("Address that will receive the energy"),
        energyAmount: z.coerce.number().min(50000).describe("Amount of energy to rent (minimum 300,000 for new rental, minimum 50,000 for renewal)"),
        durationHours: z.coerce.number().min(1).optional().describe("Rental duration in hours (minimum 1 hour). Required for new rentals. Ignored for renewals (uses existing order's remaining duration)."),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Rent Energy", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ receiverAddress, energyAmount, durationHours, network = services.getGlobalNetwork() }) => {
      try {

        const durationSeconds = durationHours ? durationHours * 3600 : undefined;
        const result = await services.rentEnergy(receiverAddress, energyAmount, durationSeconds, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "return_energy_rental",
    {
      description:
        "Return (cancel) an active energy rental. As a renter, provide the receiver address. " +
        "As a receiver, provide the renter address. " +
        "Pre-checks: active rental must exist between the two addresses.",
      inputSchema: {
        counterpartyAddress: z.string().describe("The other party's address (receiver if you are renter, renter if you are receiver)"),
        endOrderType: z.enum(["renter", "receiver"]).optional().describe("Your role: 'renter' (default) or 'receiver'"),
        network: z.string().optional().describe("Network. Default: mainnet"),
      },
      annotations: { title: "Return Energy Rental", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ counterpartyAddress, endOrderType = "renter", network = services.getGlobalNetwork() }) => {
      try {

        const result = await services.returnEnergyRental(counterpartyAddress, endOrderType, network);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${sanitizeError(error)}` }], isError: true };
      }
    },
  );
}
