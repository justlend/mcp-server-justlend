import { getTronWeb } from "./clients.js";

export interface ResourcePrices {
  energyPriceSun: number;
  bandwidthPriceSun: number;
  freeBandwidthPerDay: number;
  sunPerTRX: number;
  source: "chain" | "fallback";
}

const DEFAULT_RESOURCE_PRICES: Omit<ResourcePrices, "source"> = {
  energyPriceSun: 420,
  bandwidthPriceSun: 1000,
  freeBandwidthPerDay: 600,
  sunPerTRX: 1_000_000,
};

const CACHE_TTL_MS = 5 * 60 * 1000;

const resourcePriceCache = new Map<string, { expiresAt: number; prices: ResourcePrices }>();

function parseChainParameterValue(parameters: unknown, acceptedKeys: string[]): number | undefined {
  if (!Array.isArray(parameters)) return undefined;

  const normalizedKeys = acceptedKeys.map((key) => key.toLowerCase());
  for (const entry of parameters) {
    if (!entry || typeof entry !== "object") continue;

    const record = entry as Record<string, unknown>;
    const key = typeof record.key === "string"
      ? record.key
      : typeof record.name === "string"
        ? record.name
        : undefined;

    if (!key || !normalizedKeys.includes(key.toLowerCase())) continue;

    const rawValue = record.value;
    const numericValue = typeof rawValue === "number"
      ? rawValue
      : typeof rawValue === "string"
        ? Number(rawValue)
        : NaN;

    if (Number.isFinite(numericValue) && numericValue >= 0) {
      return Math.trunc(numericValue);
    }
  }

  return undefined;
}

export function clearResourcePriceCache(): void {
  resourcePriceCache.clear();
}

export async function getResourcePrices(network = "mainnet"): Promise<ResourcePrices> {
  const cacheKey = network.toLowerCase();
  const cached = resourcePriceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.prices;
  }

  try {
    const tronWeb = getTronWeb(network);
    const chainParameters = await tronWeb.trx.getChainParameters();
    const energyPriceSun = parseChainParameterValue(chainParameters, ["getEnergyFee", "energyFee"]);
    const bandwidthPriceSun = parseChainParameterValue(chainParameters, ["getTransactionFee", "transactionFee"]);
    const freeBandwidthPerDay = parseChainParameterValue(chainParameters, ["getFreeNetLimit", "freeNetLimit"]);

    const prices: ResourcePrices = {
      energyPriceSun: energyPriceSun ?? DEFAULT_RESOURCE_PRICES.energyPriceSun,
      bandwidthPriceSun: bandwidthPriceSun ?? DEFAULT_RESOURCE_PRICES.bandwidthPriceSun,
      freeBandwidthPerDay: freeBandwidthPerDay ?? DEFAULT_RESOURCE_PRICES.freeBandwidthPerDay,
      sunPerTRX: DEFAULT_RESOURCE_PRICES.sunPerTRX,
      source: energyPriceSun !== undefined || bandwidthPriceSun !== undefined || freeBandwidthPerDay !== undefined
        ? "chain"
        : "fallback",
    };

    resourcePriceCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      prices,
    });
    return prices;
  } catch {
    const prices: ResourcePrices = {
      ...DEFAULT_RESOURCE_PRICES,
      source: "fallback",
    };
    resourcePriceCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      prices,
    });
    return prices;
  }
}
