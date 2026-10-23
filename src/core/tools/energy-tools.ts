import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as services from "../services/index.js";
import { sanitizeError, tronAddress, toolError } from "./shared.js";

function publicPaymentRisk(risk: any): Record<string, unknown> | undefined {
  if (!risk || typeof risk !== "object") return undefined;
  const recovered = risk.recoveredOrder && typeof risk.recoveredOrder === "object" ? risk.recoveredOrder : undefined;
  const recoveredBatch = recovered?.batch && typeof recovered.batch === "object" ? recovered.batch : undefined;
  return {
    payerAddress: risk.payerAddress,
    signedTxId: risk.signedTxId,
    createdAt: risk.createdAt,
    expiresAt: risk.expiresAt,
    paymentConfirmed: risk.paymentConfirmed === true,
    chainStatus: risk.chainStatus || "unknown",
    chainExecution: risk.chainExecution || "unknown",
    networkFingerprint: risk.networkFingerprint,
    replayAvailable: Boolean(risk.signedRequest),
    recoveredOrderId: recoveredBatch?.id ?? recovered?.id,
    recoveredState: recoveredBatch?.state ?? recovered?.state,
  };
}

function energyPurchaseToolError(error: any) {
  if (!error?.code) return toolError(error);
  const payload: Record<string, unknown> = {
    error: sanitizeError(error),
    errorCode: String(error.code).toLowerCase(),
    retryable: error.retryable === true,
  };
  if (error.details !== undefined) payload.details = error.details;
  if (error.paymentRisk) payload.paymentRisk = publicPaymentRisk(error.paymentRisk);
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }], isError: true };
}

export function registerEnergyTools(server: McpServer) {

  // ============================================================================
  // ENERGY DIRECT PURCHASE (Read)
  // ============================================================================

  server.registerTool(
    "get_energy_purchase_config",
    {
      description:
        "Get live energy direct-purchase limits, supported durations, current unit prices, and pool capacity. " +
        "Uses the official JustLend production API by default; JUSTLEND_ENERGY_API_URL overrides it.",
      inputSchema: {},
      annotations: { title: "Energy Purchase Config", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const data = await services.getEnergyPurchaseConfig();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (error: any) {
        return energyPurchaseToolError(error);
      }
    },
  );

  server.registerTool(
    "quote_energy_purchase",
    {
      description:
        "Get an authoritative, read-only quote for direct energy purchase. It does not create an order, sign, " +
        "broadcast, or reserve funds. Limits and resource-pool exclusions are validated against live config.",
      inputSchema: {
        receiverAddresses: z.array(tronAddress("Address that will receive energy")).min(1).describe("One or more energy receiver addresses"),
        energyPerReceiver: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).describe("Energy amount for each receiver"),
        duration: z.string().min(1).describe("Duration exactly as advertised by get_energy_purchase_config"),
      },
      annotations: { title: "Quote Energy Purchase", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ receiverAddresses, energyPerReceiver, duration }) => {
      try {
        const quote = await services.quoteEnergyPurchase(receiverAddresses, energyPerReceiver, duration);
        return { content: [{ type: "text", text: JSON.stringify(quote, null, 2) }] };
      } catch (error: any) {
        return energyPurchaseToolError(error);
      }
    },
  );

  server.registerTool(
    "get_energy_purchase_order",
    {
      description: "Get the current lifecycle state and delivery details for an energy purchase order.",
      inputSchema: {
        orderId: z.union([z.string().min(1), z.number().int().nonnegative()]).describe("Energy purchase order id"),
        orderToken: z.string().min(1).optional().describe("Optional X-Consumer-Order-Token returned when the order was accepted"),
      },
      annotations: { title: "Energy Purchase Order", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ orderId, orderToken }) => {
      try {
        const order = await services.getEnergyPurchaseOrder(orderId, orderToken);
        return { content: [{ type: "text", text: JSON.stringify(order, null, 2) }] };
      } catch (error: any) {
        return energyPurchaseToolError(error);
      }
    },
  );

  server.registerTool(
    "get_energy_purchase_history",
    {
      description:
        "Get public direct-purchase history for a payer address, including in-progress and settled orders. " +
        "Use it to recover an accepted order when an idempotent retry returns no access token.",
      inputSchema: {
        address: tronAddress("Payer address. Default: configured wallet").optional(),
        page: z.number().int().positive().optional().describe("History page (1-based; used with size)"),
        size: z.number().int().positive().optional().describe("Rows per page; omit for the backend default/all-history view"),
      },
      annotations: { title: "Energy Purchase History", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ address, page, size }) => {
      try {
        const payer = address || await services.getWalletAddress();
        const history = await services.getEnergyPurchaseHistory(payer, { page, size });
        return { content: [{ type: "text", text: JSON.stringify({ address: payer, ...history }, null, 2) }] };
      } catch (error: any) {
        return energyPurchaseToolError(error);
      }
    },
  );

  server.registerTool(
    "get_energy_payment_risk",
    {
      description:
        "Return unresolved direct-purchase payment risks for the configured wallet without replaying a signed payment. " +
        "If any result remains, do not sign a new payment.",
      inputSchema: {},
      annotations: { title: "Energy Payment Risk", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const payer = await services.getWalletAddress();
        const risks = await services.getEnergyPaymentRisks(payer);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              address: payer,
              blocked: risks.length > 0,
              risks: risks.map(publicPaymentRisk),
              instruction: risks.length
                ? "Do not create another signed payment until these transactions are reconciled."
                : "No unresolved payment risk.",
            }, null, 2),
          }],
        };
      } catch (error: any) {
        return energyPurchaseToolError(error);
      }
    },
  );

  // ============================================================================
  // ENERGY DIRECT PURCHASE (Write)
  // ============================================================================

  server.registerTool(
    "buy_energy_direct",
    {
      description:
        "VALUE-MOVING OPERATION. Buy energy by signing a native TRX payment. The MCP server never broadcasts " +
        "the payment locally; the configured energy service validates and may broadcast it. Call quote_energy_purchase " +
        "first, show the payer, receivers, duration, and exact TRX amount to the user, and set confirmPayment=true only " +
        "after the user explicitly confirms. Ambiguous submissions retry only the same signed transaction and block a new payment.",
      inputSchema: {
        receiverAddresses: z.array(tronAddress("Address that will receive energy")).min(1).describe("One or more energy receiver addresses"),
        energyPerReceiver: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).describe("Energy amount for each receiver"),
        duration: z.string().min(1).describe("Duration exactly as advertised by get_energy_purchase_config"),
        expectedAmountSun: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).describe("Exact total_sun from the quote explicitly confirmed by the user"),
        expectedPayAddress: tronAddress("Exact payment_address from the quote explicitly confirmed by the user"),
        confirmPayment: z.literal(true).describe("Must be true only after the user explicitly confirms this value-moving payment"),
        network: z.string().optional().describe("Signing network. Default: configured network"),
      },
      annotations: { title: "Buy Energy Direct", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ receiverAddresses, energyPerReceiver, duration, expectedAmountSun, expectedPayAddress, network = services.getGlobalNetwork() }) => {
      try {
        const result = await services.buyEnergyDirect({
          receivers: receiverAddresses,
          energyPerReceiver,
          duration,
          expectedAmountSun,
          expectedPayAddress,
          network,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return energyPurchaseToolError(error);
      }
    },
  );

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
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_energy_rental_params",
    {
      description:
        "Get on-chain energy rental parameters: liquidation threshold, fee ratio, min fee, " +
        "total delegated/frozen TRX, max rentable amount, rent paused status, usage charge ratio. " +
        "Fails if required contract reads are unavailable; never substitutes fixed defaults.",
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
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "calculate_energy_rental_price",
    {
      description:
        "Calculate the cost to rent a specific amount of energy for a given duration. " +
        "Returns TRX amount needed, rental rate, fee, total prepayment, security deposit, daily cost, and dataSources. " +
        "Fails closed on missing contract inputs or renewal duration; no fixed-default or rate-model substitute quotes. " +
        "For NEW rentals: provide energyAmount and durationHours. " +
        "For RENEWALS: provide energyAmount and receiverAddress. The tool auto-detects existing rentals " +
        "and calculates the incremental cost (subtracting existing security deposit). " +
        "durationHours is optional for renewals (defaults to 0 = no additional time).",
      inputSchema: {
        energyAmount: z.coerce.number().min(50000).describe("Amount of energy to rent (minimum 300,000 for new rental, minimum 50,000 for renewal)"),
        durationHours: z.coerce.number().min(0).optional().describe("Rental duration in hours. Required for new rentals (minimum 1). Optional for renewals (default 0 = no additional time)."),
        receiverAddress: tronAddress("Receiver address. If provided, checks for existing rental to calculate renewal cost.").optional(),
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
            const rawRemainingSeconds = matchingOrder?.canRentSeconds;
            const remainingSeconds = Number(rawRemainingSeconds);
            if ((typeof rawRemainingSeconds !== "number" && typeof rawRemainingSeconds !== "string") ||
                String(rawRemainingSeconds).trim() === "" || !Number.isFinite(remainingSeconds) || remainingSeconds < 0) {
              throw new Error("Energy rental data unavailable: cannot verify remaining rental duration; no renewal quote produced");
            }
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
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_energy_rental_rate",
    {
      description:
        "Get the current energy rental rate for a given TRX amount. " +
        "Returns rental rate, stable rate, and effective rate (max of both). " +
        "Both market-contract reads must succeed; unsupported deployments return an error, not a guessed rate.",
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
        return toolError(error);
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
        address: tronAddress("Address to query. Default: configured wallet").optional(),
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
        return toolError(error);
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
        renterAddress: tronAddress("Renter address. Default: configured wallet").optional(),
        receiverAddress: tronAddress("Receiver address"),
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
        return toolError(error);
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
        renterAddress: tronAddress("Renter address. Default: configured wallet").optional(),
        receiverAddress: tronAddress("Receiver address"),
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
        return toolError(error);
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
        receiverAddress: tronAddress("Address that will receive the energy"),
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
        return toolError(error);
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
        counterpartyAddress: tronAddress("The other party's address (receiver if you are renter, renter if you are receiver)"),
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
        return toolError(error);
      }
    },
  );
}
