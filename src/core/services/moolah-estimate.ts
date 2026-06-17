/**
 * JustLend V2 (Moolah) — energy/bandwidth estimation.
 *
 * Returns typical historical values for each Moolah write operation. On-chain
 * simulation via triggerConstantContract is expensive here because Moolah
 * ops use tuple args (marketParams) that require manual hex encoding —
 * simulation support can be added later if the typical values drift.
 *
 * Typical numbers are taken from nile + mainnet broadcast observations on
 * this repo; bandwidth is approximated from signed-tx byte size.
 */
import { getResourcePrices } from "./resource-prices.js";
import { checkResourceSufficiency } from "./lending.js";

export type MoolahOperation =
  | "vault_deposit"
  | "vault_withdraw"
  | "vault_redeem"
  | "approve_vault"
  | "supply_collateral"
  | "withdraw_collateral"
  | "borrow"
  | "repay"
  | "approve_proxy"
  | "liquidate"
  | "approve_liquidator";

/**
 * Typical resource cost per Moolah operation. Amounts differ when the
 * underlying/loan token is native TRX (routed through TrxProviderProxy,
 * slightly cheaper) versus TRC20 (routed through MoolahProxy with an
 * ERC20 transfer inside).
 */
export const MOOLAH_TYPICAL_RESOURCES: Record<string, { energy: number; bandwidth: number }> = {
  // Vault
  vault_deposit_trx:       { energy: 110_000, bandwidth: 340 },
  vault_deposit_trc20:     { energy: 140_000, bandwidth: 400 },
  vault_withdraw:          { energy: 120_000, bandwidth: 340 },
  vault_redeem:            { energy: 120_000, bandwidth: 340 },
  approve_vault:           { energy:  23_000, bandwidth: 265 },
  // Market
  supply_collateral_trx:   { energy: 150_000, bandwidth: 400 },
  supply_collateral_trc20: { energy: 180_000, bandwidth: 450 },
  withdraw_collateral:     { energy: 140_000, bandwidth: 400 },
  borrow:                  { energy: 200_000, bandwidth: 430 },
  repay_trx:               { energy: 160_000, bandwidth: 400 },
  repay_trc20:             { energy: 180_000, bandwidth: 430 },
  approve_proxy:           { energy:  23_000, bandwidth: 265 },
  // Liquidation
  liquidate:               { energy: 250_000, bandwidth: 500 },
  approve_liquidator:      { energy:  23_000, bandwidth: 265 },
};

function keyFor(operation: MoolahOperation, isTRX: boolean): string {
  switch (operation) {
    case "vault_deposit":      return isTRX ? "vault_deposit_trx" : "vault_deposit_trc20";
    case "supply_collateral":  return isTRX ? "supply_collateral_trx" : "supply_collateral_trc20";
    case "repay":              return isTRX ? "repay_trx" : "repay_trc20";
    default:                   return operation;
  }
}

export interface MoolahResourceEstimate {
  operation:         MoolahOperation;
  isTRX:             boolean;
  energy:            number;
  bandwidth:         number;
  estimatedTRXCost:  string;   // human-readable TRX
  costBreakdown:     {
    energyCostTRX:    string;
    bandwidthCostTRX: string;
  };
  source:            "typical";
  note:              string;
  resourceWarning?:  Awaited<ReturnType<typeof checkResourceSufficiency>>;
}

/**
 * Returns energy/bandwidth cost for a Moolah operation plus the optional
 * resource-sufficiency warning for the given wallet.
 */
export async function estimateMoolahEnergy(params: {
  operation:     MoolahOperation;
  isTRX?:        boolean;
  ownerAddress?: string;
  network?:      string;
}): Promise<MoolahResourceEstimate> {
  const { operation, isTRX = false, ownerAddress, network = "mainnet" } = params;

  const key = keyFor(operation, isTRX);
  const typical = MOOLAH_TYPICAL_RESOURCES[key];
  if (!typical) {
    throw new Error(`Unknown Moolah operation: ${operation}`);
  }

  const prices = await getResourcePrices(network);
  const energyCostSun    = typical.energy * prices.energyPriceSun;
  const bandwidthCostSun = typical.bandwidth * prices.bandwidthPriceSun;
  const totalSun         = energyCostSun + bandwidthCostSun;

  const estimate: MoolahResourceEstimate = {
    operation,
    isTRX,
    energy:     typical.energy,
    bandwidth:  typical.bandwidth,
    estimatedTRXCost: (totalSun / prices.sunPerTRX).toFixed(3),
    costBreakdown: {
      energyCostTRX:    (energyCostSun    / prices.sunPerTRX).toFixed(3),
      bandwidthCostTRX: (bandwidthCostSun / prices.sunPerTRX).toFixed(3),
    },
    source: "typical",
    note: "Historical typical values — on-chain simulation for Moolah tuple-args ops is not yet wired.",
  };

  if (ownerAddress) {
    const warn = await checkResourceSufficiency(ownerAddress, typical.energy, typical.bandwidth, network);
    if (warn.warning) estimate.resourceWarning = warn;
  }

  return estimate;
}
