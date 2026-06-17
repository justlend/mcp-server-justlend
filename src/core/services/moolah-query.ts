/**
 * JustLend V2 (Moolah) — on-chain view queries.
 * All functions are read-only; no wallet or signing required.
 */
import { readContract } from "./contracts.js";
import { getMoolahAddresses } from "../chains.js";
import { toBase58Address } from "./address.js";
import {
  MOOLAH_CORE_ABI,
  MOOLAH_VAULT_ABI,
  PUBLIC_LIQUIDATOR_ABI,
} from "../abis.js";

// ── Shared types ──────────────────────────────────────────────────────────────

/** MarketParams struct as returned by the chain (addresses in Base58, lltv × 1e18). */
export interface MarketParams {
  loanToken: string;       // TRON Base58 address
  collateralToken: string; // TRON Base58 address
  oracle: string;          // TRON Base58 address
  irm: string;             // TRON Base58 address
  lltv: bigint;            // Liquidation LTV × 1e18  (e.g. 75% → 750000000000000000n)
}

export interface MarketState {
  totalSupplyAssets: bigint;
  totalSupplyShares: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  lastUpdate: bigint;
  fee: bigint;
}

export interface UserMarketPosition {
  supplyShares: bigint;
  borrowShares: bigint;
  collateral:   bigint;
}

// ── Market: state and position ────────────────────────────────────────────────

/**
 * Snapshot of a Moolah market's aggregate supply/borrow state.
 * marketId is the bytes32 hex identifier (e.g. from the backend API).
 */
export async function getMoolahMarketState(
  marketId: string,
  network = "mainnet",
): Promise<MarketState> {
  const { moolahProxy } = getMoolahAddresses(network);
  const r = await readContract(
    { address: moolahProxy, functionName: "market", args: [marketId], abi: MOOLAH_CORE_ABI },
    network,
  );
  return {
    totalSupplyAssets: asBigInt(r.totalSupplyAssets ?? r[0]),
    totalSupplyShares: asBigInt(r.totalSupplyShares ?? r[1]),
    totalBorrowAssets: asBigInt(r.totalBorrowAssets ?? r[2]),
    totalBorrowShares: asBigInt(r.totalBorrowShares ?? r[3]),
    lastUpdate:        asBigInt(r.lastUpdate        ?? r[4]),
    fee:               asBigInt(r.fee               ?? r[5]),
  };
}

/** User's supply-side shares, borrow-side shares, and collateral in a given market. */
export async function getMoolahUserPosition(
  marketId: string,
  userAddress: string,
  network = "mainnet",
): Promise<UserMarketPosition> {
  const { moolahProxy } = getMoolahAddresses(network);
  const r = await readContract(
    { address: moolahProxy, functionName: "position", args: [marketId, userAddress], abi: MOOLAH_CORE_ABI },
    network,
  );
  return {
    supplyShares: asBigInt(r.supplyShares ?? r[0]),
    borrowShares: asBigInt(r.borrowShares ?? r[1]),
    collateral:   asBigInt(r.collateral   ?? r[2]),
  };
}

/**
 * Resolve a marketId back to its MarketParams struct.
 * Addresses are returned as TRON Base58.
 */
export async function getMoolahMarketParams(
  marketId: string,
  network = "mainnet",
): Promise<MarketParams> {
  const { moolahProxy } = getMoolahAddresses(network);
  const r = await readContract(
    { address: moolahProxy, functionName: "idToMarketParams", args: [marketId], abi: MOOLAH_CORE_ABI },
    network,
  );
  // TronWeb may wrap the tuple in an extra layer; unwrap if needed.
  const p = (r && typeof r === "object" && (r.marketParams ?? r[0]) && !r.loanToken)
    ? (r.marketParams ?? r[0])
    : r;
  return {
    loanToken:       asBase58(p.loanToken       ?? p[0]),
    collateralToken: asBase58(p.collateralToken ?? p[1]),
    oracle:          asBase58(p.oracle          ?? p[2]),
    irm:             asBase58(p.irm             ?? p[3]),
    lltv:            asBigInt(p.lltv            ?? p[4]),
  };
}

/**
 * Returns true when the user's position in this market is above the liquidation threshold.
 * Calls `isHealthy(marketParams, user)` which is cheaper than computing it off-chain.
 * marketParams must match the market (obtain via getMoolahMarketParams).
 */
export async function isMoolahPositionHealthy(
  marketParams: MarketParams,
  userAddress: string,
  network = "mainnet",
): Promise<boolean> {
  const { moolahProxy } = getMoolahAddresses(network);
  // Tuple arg: TronWeb contract.methods() accepts an array for tuple inputs.
  const paramsTuple = [
    marketParams.loanToken,
    marketParams.collateralToken,
    marketParams.oracle,
    marketParams.irm,
    marketParams.lltv.toString(),
  ];
  const result = await readContract(
    { address: moolahProxy, functionName: "isHealthy", args: [paramsTuple, userAddress], abi: MOOLAH_CORE_ABI },
    network,
  );
  return Boolean(result);
}

// ── Vault: ERC4626 queries ────────────────────────────────────────────────────

/** Total underlying assets held by the vault (pre-fee, includes allocated markets). */
export async function getMoolahVaultTotalAssets(
  vaultAddress: string,
  network = "mainnet",
): Promise<bigint> {
  const r = await readContract(
    { address: vaultAddress, functionName: "totalAssets", args: [], abi: MOOLAH_VAULT_ABI },
    network,
  );
  return asBigInt(r);
}

/** Number of vault shares owned by a user (ERC20 balanceOf). */
export async function getMoolahUserVaultShares(
  vaultAddress: string,
  userAddress: string,
  network = "mainnet",
): Promise<bigint> {
  const r = await readContract(
    { address: vaultAddress, functionName: "balanceOf", args: [userAddress], abi: MOOLAH_VAULT_ABI },
    network,
  );
  return asBigInt(r);
}

/** Maximum amount of underlying assets the user can withdraw right now. */
export async function getMoolahVaultMaxWithdraw(
  vaultAddress: string,
  userAddress: string,
  network = "mainnet",
): Promise<bigint> {
  const r = await readContract(
    { address: vaultAddress, functionName: "maxWithdraw", args: [userAddress], abi: MOOLAH_VAULT_ABI },
    network,
  );
  return asBigInt(r);
}

/** Convert shares to underlying assets at the current exchange rate. */
export async function moolahVaultConvertToAssets(
  vaultAddress: string,
  shares: bigint,
  network = "mainnet",
): Promise<bigint> {
  const r = await readContract(
    { address: vaultAddress, functionName: "convertToAssets", args: [shares.toString()], abi: MOOLAH_VAULT_ABI },
    network,
  );
  return asBigInt(r);
}

/** Convert underlying assets to shares at the current exchange rate. */
export async function moolahVaultConvertToShares(
  vaultAddress: string,
  assets: bigint,
  network = "mainnet",
): Promise<bigint> {
  const r = await readContract(
    { address: vaultAddress, functionName: "convertToShares", args: [assets.toString()], abi: MOOLAH_VAULT_ABI },
    network,
  );
  return asBigInt(r);
}

// ── Liquidation: pre-flight quote ─────────────────────────────────────────────

/**
 * Returns the exact loan token amount needed to execute a liquidation.
 * Provide either seizedAssets (collateral to take) or repaidShares (borrow debt to repay);
 * set the other to 0n.
 */
export async function getMoolahLoanTokenAmountNeed(
  marketId: string,
  seizedAssets: bigint,
  repaidShares: bigint,
  network = "mainnet",
): Promise<bigint> {
  const { publicLiquidatorProxy } = getMoolahAddresses(network);
  const r = await readContract(
    {
      address: publicLiquidatorProxy,
      functionName: "loanTokenAmountNeed",
      args: [marketId, seizedAssets.toString(), repaidShares.toString()],
      abi: PUBLIC_LIQUIDATOR_ABI,
    },
    network,
  );
  return asBigInt(r);
}

// ── Private helpers ───────────────────────────────────────────────────────────

function asBigInt(value: any): bigint {
  if (value === undefined || value === null) return 0n;
  if (typeof value === "bigint") return value;
  return BigInt(value.toString());
}

function asBase58(value: any): string {
  if (!value) return "";
  const str = value.toString();
  if (str.startsWith("T")) return str;
  // Hex address returned by TronWeb (41...) → Base58
  return toBase58Address(str);
}
