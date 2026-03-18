/**
 * JustLend V1 Lending Operations
 *
 * VERSION: JustLend V1
 * All lending methods (supply, withdraw, borrow, repay, collateral management) are for JustLend V1.
 * Based on Compound V2 protocol architecture with jToken (cToken) mechanism.
 */

import { getTronWeb, getWallet } from "./clients.js";
import { safeSend } from "./contracts.js";
import { getJustLendAddresses, getJTokenInfo, getAllJTokens, type JTokenInfo } from "../chains.js";
import { JTOKEN_ABI, JTRX_MINT_ABI, JTRX_REPAY_ABI, COMPTROLLER_ABI, TRC20_ABI, PRICE_ORACLE_ABI } from "../abis.js";
import { utils } from "./utils.js";

const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";

async function waitForTx(txID: string, network: string, maxRetries = 20, intervalMs = 3000): Promise<any> {
  const { getTronWeb } = await import("./clients.js");
  const tronWeb = getTronWeb(network);

  for (let i = 0; i < maxRetries; i++) {
    try {
      const info = await tronWeb.trx.getTransactionInfo(txID);
      if (info && info.id) return info;
    } catch { /* not found yet */ }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Transaction ${txID} not confirmed after ${maxRetries * intervalMs / 1000}s`);
}

async function parseTxEvents(txID: string, network: string): Promise<any[]> {
  const info = await waitForTx(txID, network);
  if (!info.log || info.log.length === 0) return [];

  const events: any[] = [];
  const FAILURE_TOPIC = "45b96fe442630264581b197e84bbada861235052c5a1aadfff9ea4e40a969aa0";

  for (const log of info.log) {
    const topics = log.topics || [];
    if (topics.length > 0 && topics[0] === FAILURE_TOPIC) {
      const error = parseInt(log.data?.slice(0, 64) || "0", 16);
      const infoVal = parseInt(log.data?.slice(64, 128) || "0", 16);
      const detail = parseInt(log.data?.slice(128, 192) || "0", 16);
      events.push({
        name: "Failure",
        params: { error, info: infoVal, detail },
        message: `Contract returned Failure: error=${error}, info=${infoVal}, detail=${detail}`,
      });
    } else {
      events.push({
        name: "Unknown",
        topics,
        data: log.data,
        address: log.address,
      });
    }
  }
  return events;
}

function resolveJToken(symbolOrAddress: string, network: string): JTokenInfo {
  const info = getJTokenInfo(symbolOrAddress, network);
  if (!info) throw new Error(`Unknown jToken market: ${symbolOrAddress}. Use get_supported_markets to list available markets.`);
  return info;
}

// ============================================================================
// PRICE ORACLE FALLBACK HELPERS (Injected to fix Nile testnet $0 collateral bug)
// ============================================================================

async function fetchPriceFromAPI(underlyingSymbol: string, underlyingDecimals: number, network: string): Promise<number> {
  const tryFetch = async (targetNetwork: string) => {
    const host = targetNetwork === "nile" ? "https://nileapi.justlend.org" : "https://labc.ablesdxd.link";
    const resp = await fetch(`${host}/justlend/markets`);
    const data = await resp.json();
    if (data.code !== 0 || !data.data || !data.data.jtokenList) return 0;

    const market = data.data.jtokenList.find((m: any) =>
      m.collateralSymbol.toUpperCase() === underlyingSymbol.toUpperCase()
    );
    if (!market) return 0;

    const depositedUSD = Number(market.depositedUSD || 0);
    const totalSupplyRaw = Number(market.totalSupply || 0);
    const exchangeRate = Number(market.exchangeRate || 0);

    if (depositedUSD === 0 || totalSupplyRaw === 0 || exchangeRate === 0) return 0;
    const underlyingRaw = (totalSupplyRaw * exchangeRate) / 1e18;
    const underlyingAmount = underlyingRaw / (10 ** underlyingDecimals);
    return depositedUSD / underlyingAmount;
  };

  try {
    const price = await tryFetch(network);
    if (price > 0) return price;
  } catch (err) { }

  if (network === "nile") {
    try {
      const mainnetPrice = await tryFetch("mainnet");
      if (mainnetPrice > 0) return mainnetPrice;
    } catch (err) { }
  }
  return 0;
}

async function getAssetPriceUSD(tronWeb: any, oracleAddress: string, assetAddress: string, assetInfo: JTokenInfo | undefined, network: string): Promise<number> {
  let priceRaw = 0n;
  let priceUSD = 0;

  try {
    const oracle = tronWeb.contract(PRICE_ORACLE_ABI, oracleAddress);
    priceRaw = BigInt(await oracle.methods.getUnderlyingPrice(assetAddress).call());
  } catch (err) { }

  if (priceRaw > 0n && network === "mainnet") {
    const decimals = assetInfo ? assetInfo.underlyingDecimals : 18;
    priceUSD = Number(priceRaw) / (10 ** (36 - decimals));
  } else if (assetInfo) {
    priceUSD = await fetchPriceFromAPI(assetInfo.underlyingSymbol, assetInfo.underlyingDecimals, network);
  }
  return priceUSD;
}

// ============================================================================
// SUPPLY (Mint jTokens)
// ============================================================================

export async function supply(
  privateKey: string,
  jTokenSymbol: string,
  amount: string,
  network = "mainnet",
): Promise<{ txID: string; jTokenSymbol: string; amount: string; message: string }> {
  const info = resolveJToken(jTokenSymbol, network);
  const tronWeb = getWallet(privateKey, network);
  const amountRaw = utils.parseUnits(amount, info.underlyingDecimals);
  const walletAddress = tronWeb.defaultAddress.base58 as string;

  if (info.underlyingSymbol === "TRX" || !info.underlying) {
    const balanceSun = await tronWeb.trx.getBalance(walletAddress);
    const supplyTypical = getTypicalResources("supply", true);
    const supplyResourceCheck = await checkResourceSufficiency(walletAddress, supplyTypical.energy, supplyTypical.bandwidth, network);
    const supplyGasSun = BigInt(Math.ceil((parseFloat(supplyResourceCheck.energyBurnTRX) + parseFloat(supplyResourceCheck.bandwidthBurnTRX)) * 1e6));
    const needed = BigInt(amountRaw.toString()) + supplyGasSun;
    if (BigInt(balanceSun) < needed) {
      throw new Error(
        `Insufficient TRX balance. Have ${(Number(balanceSun) / 1e6).toFixed(2)} TRX, need ~${(Number(needed) / 1e6).toFixed(2)} TRX (supply + estimated gas)`,
      );
    }

    const { txID } = await safeSend(privateKey, {
      address: info.address,
      abi: JTRX_MINT_ABI,
      functionName: "mint",
      callValue: amountRaw.toString(),
    }, network);
    return { txID, jTokenSymbol, amount, message: `Supplied ${amount} TRX to ${jTokenSymbol}. IMPORTANT: Please call get_account_summary to see your updated position and health factor.` };
  } else {
    const token = tronWeb.contract(TRC20_ABI, info.underlying);
    const balance = BigInt(await token.methods.balanceOf(walletAddress).call());
    if (balance < BigInt(amountRaw.toString())) {
      throw new Error(
        `Insufficient ${info.underlyingSymbol} balance. Have ${utils.formatUnits(balance.toString(), info.underlyingDecimals)}, need ${amount}`,
      );
    }

    const allowance = BigInt(await token.methods.allowance(walletAddress, info.address).call());
    const formattedAllowance = utils.formatUnits(allowance.toString(), info.underlyingDecimals);
    if (allowance < BigInt(amountRaw.toString())) {
      throw new Error(
        `Insufficient ${info.underlyingSymbol} allowance for ${jTokenSymbol}. Current allowance: ${formattedAllowance}. You need to approve at least ${amount} ${info.underlyingSymbol}. Please call approve_underlying first.`,
      );
    }

    const { txID } = await safeSend(privateKey, {
      address: info.address,
      abi: JTOKEN_ABI,
      functionName: "mint",
      args: [amountRaw.toString()],
    }, network);
    return { txID, jTokenSymbol, amount, message: `Supplied ${amount} ${info.underlyingSymbol} to ${jTokenSymbol}. IMPORTANT: Please call get_account_summary to see your updated position and health factor.` };
  }
}

// ============================================================================
// WITHDRAW (Redeem jTokens)
// ============================================================================

export async function withdraw(
  privateKey: string,
  jTokenSymbol: string,
  amount: string,
  network = "mainnet",
): Promise<{ txID: string; jTokenSymbol: string; amount: string; message: string }> {
  const info = resolveJToken(jTokenSymbol, network);
  const tronWeb = getWallet(privateKey, network);
  const amountRaw = utils.parseUnits(amount, info.underlyingDecimals);
  const walletAddress = tronWeb.defaultAddress.base58 as string;

  const contract = tronWeb.contract(JTOKEN_ABI, info.address);
  const jTokenBalance = BigInt(await contract.methods.balanceOf(walletAddress).call());
  const exchangeRate = BigInt(await contract.methods.exchangeRateStored().call());
  const supplyBalance = (jTokenBalance * exchangeRate) / BigInt(1e18);
  if (supplyBalance < BigInt(amountRaw.toString())) {
    throw new Error(
      `Insufficient supply balance in ${jTokenSymbol}. Have ${utils.formatUnits(supplyBalance.toString(), info.underlyingDecimals)} ${info.underlyingSymbol}, want to withdraw ${amount}`,
    );
  }

  const { txID } = await safeSend(privateKey, {
    address: info.address,
    abi: JTOKEN_ABI,
    functionName: "redeemUnderlying",
    args: [amountRaw.toString()],
  }, network);
  return { txID, jTokenSymbol, amount, message: `Withdrew ${amount} ${info.underlyingSymbol} from ${jTokenSymbol}. IMPORTANT: Please call get_account_summary to see your updated position and health factor.` };
}

export async function withdrawAll(
  privateKey: string,
  jTokenSymbol: string,
  network = "mainnet",
): Promise<{ txID: string; jTokenSymbol: string; message: string }> {
  const info = resolveJToken(jTokenSymbol, network);
  const tronWeb = getWallet(privateKey, network);

  const contract = tronWeb.contract(JTOKEN_ABI, info.address);
  const walletAddress = tronWeb.defaultAddress.base58;
  const jTokenBalance = await contract.methods.balanceOf(walletAddress).call();

  if (BigInt(jTokenBalance) === 0n) {
    throw new Error(`No ${jTokenSymbol} balance to withdraw`);
  }

  const { txID } = await safeSend(privateKey, {
    address: info.address,
    abi: JTOKEN_ABI,
    functionName: "redeem",
    args: [jTokenBalance.toString()],
  }, network);
  return { txID, jTokenSymbol, message: `Withdrew all supply from ${jTokenSymbol}. IMPORTANT: Please call get_account_summary to see your updated position and health factor.` };
}

// ============================================================================
// BORROW
// ============================================================================

export async function borrow(
  privateKey: string,
  jTokenSymbol: string,
  amount: string,
  network = "mainnet",
): Promise<{ txID: string; jTokenSymbol: string; amount: string; message: string }> {
  const info = resolveJToken(jTokenSymbol, network);
  const tronWeb = getWallet(privateKey, network);
  const amountRaw = utils.parseUnits(amount, info.underlyingDecimals);
  const walletAddress = tronWeb.defaultAddress.base58;

  const addresses = getJustLendAddresses(network);
  const comptroller = tronWeb.contract(COMPTROLLER_ABI, addresses.comptroller);

  const oracleAddressHex = await comptroller.methods.oracle().call();
  const realOracleAddress = tronWeb.address.fromHex(oracleAddressHex);

  const assetsInRaw: string[] = await comptroller.methods.getAssetsIn(walletAddress).call();

  if (assetsInRaw.length === 0) {
    throw new Error(
      `No borrowing capacity. You need to supply assets and enable them as collateral (enter_market) before borrowing.`
    );
  }

  interface CollateralDetail {
    symbol: string;
    supplyBalance: number;
    supplyValueUSD: number;
    collateralFactor: number;
    adjustedValueUSD: number;
    borrowBalanceUSD: number;
  }

  const MANTISSA_18 = BigInt(1e18);
  const collateralDetails: CollateralDetail[] = [];
  let totalAdjustedCollateralUSD = 0;
  let totalBorrowUSD = 0;

  for (const rawAsset of assetsInRaw) {
    try {
      // 💡 核心修复：将底层返回的 Hex 地址强制转换为标准的 T 开头地址
      const asset = tronWeb.address.fromHex(rawAsset);

      const assetInfo = getJTokenInfo(asset, network);
      const jToken = tronWeb.contract(JTOKEN_ABI, asset);
      const snapshot = await jToken.methods.getAccountSnapshot(walletAddress).call();

      const jTokenBalance = BigInt(snapshot[1] ?? snapshot.jTokenBalance ?? 0);
      const borrowBalance = BigInt(snapshot[2] ?? snapshot.borrowBalance ?? 0);
      const exchangeRateMantissa = BigInt(snapshot[3] ?? snapshot.exchangeRateMantissa ?? 0);
      const supplyBalanceRaw = jTokenBalance * exchangeRateMantissa / MANTISSA_18;

      const assetPriceUSD = await getAssetPriceUSD(tronWeb, realOracleAddress, asset, assetInfo, network);

      const marketInfo = await comptroller.methods.markets(asset).call();
      const cf = Number(BigInt(marketInfo.collateralFactorMantissa || marketInfo[1])) / 1e18;

      const assetDecimals = assetInfo ? assetInfo.underlyingDecimals : 18;
      const supplyBalance = Number(supplyBalanceRaw) / 10 ** assetDecimals;
      const supplyValueUSD = supplyBalance * assetPriceUSD;
      const adjustedValueUSD = supplyValueUSD * cf;
      const borrowBalanceUSD = Number(borrowBalance) / 10 ** assetDecimals * assetPriceUSD;

      totalAdjustedCollateralUSD += adjustedValueUSD;
      totalBorrowUSD += borrowBalanceUSD;

      const label = assetInfo ? assetInfo.underlyingSymbol : asset;
      collateralDetails.push({
        symbol: label,
        supplyBalance,
        supplyValueUSD,
        collateralFactor: cf,
        adjustedValueUSD,
        borrowBalanceUSD,
      });
    } catch (e) {
      console.error(`[Borrow Debug] Skipped asset ${rawAsset}:`, e);
    }
  }

  const availableLiquidityUSD = totalAdjustedCollateralUSD - totalBorrowUSD;

  if (availableLiquidityUSD <= 0) {
    const breakdown = collateralDetails.map(d =>
      `${d.symbol}: supply=$${d.supplyValueUSD.toFixed(2)} × CF ${(d.collateralFactor * 100).toFixed(0)}% = $${d.adjustedValueUSD.toFixed(2)}` +
      (d.borrowBalanceUSD > 0 ? `, borrow=$${d.borrowBalanceUSD.toFixed(2)}` : "")
    ).join("; ");

    throw new Error(
      `No borrowing capacity. Total adjusted collateral: $${totalAdjustedCollateralUSD.toFixed(2)}, ` +
      `total borrows: $${totalBorrowUSD.toFixed(2)}, available: $${availableLiquidityUSD.toFixed(2)}. ` +
      `Breakdown: [${breakdown}]. ` +
      `Supply more collateral or repay existing borrows first.`
    );
  }

  const targetPriceUSD = await getAssetPriceUSD(tronWeb, realOracleAddress, info.address, info, network);

  if (targetPriceUSD === 0) {
    throw new Error(`Cannot fetch price for ${info.underlyingSymbol}. Unable to verify borrowing capacity.`);
  }

  const maxBorrowable = availableLiquidityUSD / targetPriceUSD;
  const maxBorrowableRaw = BigInt(Math.floor(maxBorrowable * 10 ** info.underlyingDecimals));

  if (amountRaw > maxBorrowableRaw) {
    const breakdown = collateralDetails.map(d =>
      `${d.symbol}: supply=$${d.supplyValueUSD.toFixed(2)} × CF ${(d.collateralFactor * 100).toFixed(0)}% = $${d.adjustedValueUSD.toFixed(2)}` +
      (d.borrowBalanceUSD > 0 ? `, borrow=$${d.borrowBalanceUSD.toFixed(2)}` : "")
    ).join("; ");

    throw new Error(
      `Insufficient borrowing capacity. Requested: ${amount} ${info.underlyingSymbol} (~$${(parseFloat(amount) * targetPriceUSD).toFixed(2)}), ` +
      `max borrowable: ~${maxBorrowable.toFixed(info.underlyingDecimals > 6 ? 6 : info.underlyingDecimals)} ${info.underlyingSymbol} ` +
      `(~$${availableLiquidityUSD.toFixed(2)}). ` +
      `${info.underlyingSymbol} price: $${targetPriceUSD.toFixed(6)}. ` +
      `Collateral breakdown: [${breakdown}]. ` +
      `Supply more collateral or reduce borrow amount.`
    );
  }

  const { txID } = await safeSend(privateKey, {
    address: info.address,
    abi: JTOKEN_ABI,
    functionName: "borrow",
    args: [amountRaw.toString()],
  }, network);
  return { txID, jTokenSymbol, amount, message: `Borrowed ${amount} ${info.underlyingSymbol} from ${jTokenSymbol}. IMPORTANT: Please call get_account_summary to see your updated position and health factor.` };
}

// ============================================================================
// REPAY
// ============================================================================

export async function repay(
  privateKey: string,
  jTokenSymbol: string,
  amount: string,
  network = "mainnet",
): Promise<{ txID: string; jTokenSymbol: string; amount: string; message: string }> {
  const info = resolveJToken(jTokenSymbol, network);
  const tronWeb = getWallet(privateKey, network);

  const isMax = amount === "-1" || amount.toLowerCase() === "max";

  const contract = tronWeb.contract(JTOKEN_ABI, info.address);
  const walletAddress = tronWeb.defaultAddress.base58;
  const borrowBal = BigInt(await contract.methods.borrowBalanceStored(walletAddress).call());

  if (borrowBal === 0n) {
    throw new Error(`No outstanding ${info.underlyingSymbol} borrow on ${jTokenSymbol}. Nothing to repay.`);
  }

  if (!isMax) {
    const repayRaw = BigInt(utils.parseUnits(amount, info.underlyingDecimals).toString());
    if (info.underlyingSymbol === "TRX" || !info.underlying) {
      const balanceSun = await tronWeb.trx.getBalance(walletAddress as string);
      const repayTypical = getTypicalResources("repay", true);
      const repayResourceCheck = await checkResourceSufficiency(walletAddress as string, repayTypical.energy, repayTypical.bandwidth, network);
      const repayGasSun = BigInt(Math.ceil((parseFloat(repayResourceCheck.energyBurnTRX) + parseFloat(repayResourceCheck.bandwidthBurnTRX)) * 1e6));
      const needed = repayRaw + repayGasSun;
      if (BigInt(balanceSun) < needed) {
        throw new Error(
          `Insufficient TRX balance for repayment. Have ${(Number(balanceSun) / 1e6).toFixed(2)} TRX, need ~${(Number(needed) / 1e6).toFixed(2)} TRX (repay + estimated gas)`
        );
      }
    } else {
      const token = tronWeb.contract(TRC20_ABI, info.underlying);
      const tokenBal = BigInt(await token.methods.balanceOf(walletAddress).call());
      if (tokenBal < repayRaw) {
        throw new Error(
          `Insufficient ${info.underlyingSymbol} balance for repayment. Have ${utils.formatUnits(tokenBal.toString(), info.underlyingDecimals)}, need ${amount}`
        );
      }
    }
  }

  if (info.underlyingSymbol === "TRX" || !info.underlying) {
    const repayAmount = isMax
      ? borrowBal + borrowBal / 1000n
      : utils.parseUnits(amount, info.underlyingDecimals);

    // ✅ 修正：TRX 还款与 dapp 前端一致
    // dapp 使用 repayBorrow(uint256) + parameters: [amount] + callValue: amount
    // 同时传参数和 callValue
    const { txID } = await safeSend(privateKey, {
      address: info.address,
      abi: JTRX_REPAY_ABI,                // ✅ 使用 payable ABI，与合约签名匹配
      functionName: "repayBorrow",
      args: [repayAmount.toString()],     // ✅ 传金额参数，与 dapp 前端一致
      callValue: repayAmount.toString(),   // 同时通过 callValue 发送 TRX
      feeLimit: 150_000_000,
    }, network);
    return { txID, jTokenSymbol, amount: isMax ? "max" : amount, message: `Repaid ${isMax ? "all" : amount} TRX to ${jTokenSymbol}. IMPORTANT: Please call get_account_summary to see your updated position and health factor.` };
  } else {
    const repayAmount = isMax ? MAX_UINT256 : utils.parseUnits(amount, info.underlyingDecimals).toString();
    const { txID } = await safeSend(privateKey, {
      address: info.address,
      abi: JTOKEN_ABI,
      functionName: "repayBorrow",
      args: [repayAmount],
      feeLimit: 300_000_000,
    }, network);
    return { txID, jTokenSymbol, amount: isMax ? "max" : amount, message: `Repaid ${isMax ? "all" : amount} ${info.underlyingSymbol} to ${jTokenSymbol}. IMPORTANT: Please call get_account_summary to see your updated position and health factor.` };
  }
}

// ============================================================================
// COLLATERAL MANAGEMENT (Enter/Exit Markets)
// ============================================================================

export async function enterMarket(
  privateKey: string,
  jTokenSymbol: string,
  network = "mainnet",
): Promise<{ txID?: string; message: string }> {
  const info = resolveJToken(jTokenSymbol, network);
  const tronWeb = getWallet(privateKey, network);
  const addresses = getJustLendAddresses(network);

  const comptroller = tronWeb.contract(COMPTROLLER_ABI, addresses.comptroller);
  const walletAddress = tronWeb.defaultAddress.base58;
  const isMember = await comptroller.methods.checkMembership(walletAddress, info.address).call();
  if (isMember) {
    return { message: `${jTokenSymbol} is already enabled as collateral, no need to enable again.` };
  }

  const { txID } = await safeSend(privateKey, {
    address: addresses.comptroller,
    abi: COMPTROLLER_ABI,
    functionName: "enterMarkets",
    args: [[info.address]],
  }, network);
  return { txID, message: `Enabled ${jTokenSymbol} as collateral` };
}

export async function exitMarket(
  privateKey: string,
  jTokenSymbol: string,
  network = "mainnet",
): Promise<{ txID?: string; message: string; events?: any[] }> {
  const info = resolveJToken(jTokenSymbol, network);
  const tronWeb = getWallet(privateKey, network);
  const addresses = getJustLendAddresses(network);

  const comptroller = tronWeb.contract(COMPTROLLER_ABI, addresses.comptroller);
  const walletAddress = tronWeb.defaultAddress.base58;

  const isMember = await comptroller.methods.checkMembership(walletAddress, info.address).call();
  if (!isMember) {
    return { message: `${jTokenSymbol} is not currently enabled as collateral, no need to disable.` };
  }

  const jToken = tronWeb.contract(JTOKEN_ABI, info.address);
  const snapshot = await jToken.methods.getAccountSnapshot(walletAddress).call();
  const borrowBalance = BigInt(snapshot[2] ?? snapshot.borrowBalance ?? 0);
  if (borrowBalance > 0n) {
    const borrowHuman = Number(borrowBalance) / 10 ** info.underlyingDecimals;
    throw new Error(
      `Cannot disable ${jTokenSymbol} as collateral: you have an outstanding borrow of ${borrowHuman} ${info.underlyingSymbol} in this market. ` +
      `Please repay the borrow first before disabling collateral.`
    );
  }

  const oracleAddressHex = await comptroller.methods.oracle().call();
  const realOracleAddress = tronWeb.address.fromHex(oracleAddressHex);

  const assetsInRaw: string[] = await comptroller.methods.getAssetsIn(walletAddress).call();

  const MANTISSA_18 = BigInt(1e18);
  let totalAdjustedCollateralUSD = 0;
  let totalBorrowUSD = 0;
  let removedCollateralUSD = 0;

  for (const rawAsset of assetsInRaw) {
    try {
      // 💡 核心修复：十六进制转换
      const asset = tronWeb.address.fromHex(rawAsset);

      const assetInfo = getJTokenInfo(asset, network);
      const assetJToken = tronWeb.contract(JTOKEN_ABI, asset);
      const assetSnapshot = await assetJToken.methods.getAccountSnapshot(walletAddress).call();

      const jTokenBal = BigInt(assetSnapshot[1] ?? assetSnapshot.jTokenBalance ?? 0);
      const borrowBal = BigInt(assetSnapshot[2] ?? assetSnapshot.borrowBalance ?? 0);
      const exchangeRateMantissa = BigInt(assetSnapshot[3] ?? assetSnapshot.exchangeRateMantissa ?? 0);

      const supplyBalanceRaw = jTokenBal * exchangeRateMantissa / MANTISSA_18;

      const assetPriceUSD = await getAssetPriceUSD(tronWeb, realOracleAddress, asset, assetInfo, network);

      const marketInfo = await comptroller.methods.markets(asset).call();
      const cf = Number(BigInt(marketInfo.collateralFactorMantissa || marketInfo[1])) / 1e18;

      const assetDecimals = assetInfo ? assetInfo.underlyingDecimals : 18;
      const supplyBalance = Number(supplyBalanceRaw) / 10 ** assetDecimals;
      const supplyValueUSD = supplyBalance * assetPriceUSD;
      const adjustedValueUSD = supplyValueUSD * cf;
      const borrowBalanceUSD = Number(borrowBal) / 10 ** assetDecimals * assetPriceUSD;

      totalAdjustedCollateralUSD += adjustedValueUSD;
      totalBorrowUSD += borrowBalanceUSD;

      if (asset.toLowerCase() === info.address.toLowerCase()) {
        removedCollateralUSD = adjustedValueUSD;
      }
    } catch { /* skip unavailable markets */ }
  }

  if (totalBorrowUSD > 0) {
    const remainingCollateralUSD = totalAdjustedCollateralUSD - removedCollateralUSD;
    if (remainingCollateralUSD < totalBorrowUSD) {
      const currentRatio = totalBorrowUSD > 0 ? (totalBorrowUSD / remainingCollateralUSD * 100).toFixed(2) : "0";
      throw new Error(
        `Cannot disable ${jTokenSymbol} as collateral: doing so would make your account undercollateralized. ` +
        `After removing ${jTokenSymbol} collateral ($${removedCollateralUSD.toFixed(2)}), ` +
        `remaining collateral: $${remainingCollateralUSD.toFixed(2)}, total borrows: $${totalBorrowUSD.toFixed(2)}, ` +
        `borrow risk would be ${currentRatio}% (must be < 100%). ` +
        `Please repay some borrows or add more collateral first.`
      );
    }
  }

  const { txID } = await safeSend(privateKey, {
    address: addresses.comptroller,
    abi: COMPTROLLER_ABI,
    functionName: "exitMarket",
    args: [info.address],
  }, network);

  const events = await parseTxEvents(txID, network);
  return { txID, message: `Disabled ${jTokenSymbol} as collateral`, events };
}

// ============================================================================
// APPROVE (TRC20 underlying for jToken)
// ============================================================================

export async function approveUnderlying(
  privateKey: string,
  jTokenSymbol: string,
  amount: string = "max",
  network = "mainnet",
): Promise<{ txID: string; message: string }> {
  const info = resolveJToken(jTokenSymbol, network);
  if (!info.underlying) throw new Error(`${jTokenSymbol} is native TRX — no approval needed`);

  const tronWeb = getWallet(privateKey, network);
  const walletAddress = tronWeb.defaultAddress.base58 as string;
  const token = tronWeb.contract(TRC20_ABI, info.underlying);

  const currentAllowance = BigInt(await token.methods.allowance(walletAddress, info.address).call());
  const approveAmount = amount.toLowerCase() === "max"
    ? MAX_UINT256
    : utils.parseUnits(amount, info.underlyingDecimals).toString();

  if (currentAllowance >= BigInt(approveAmount)) {
    return {
      txID: "",
      message: `${info.underlyingSymbol} already has sufficient allowance (${utils.formatUnits(currentAllowance.toString(), info.underlyingDecimals)}) for ${jTokenSymbol}. No approve needed.`,
    };
  }

  const { txID } = await safeSend(privateKey, {
    address: info.underlying!,
    abi: TRC20_ABI,
    functionName: "approve",
    args: [info.address, approveAmount],
  }, network);
  return { txID, message: `Approved ${amount === "max" ? "unlimited" : amount} ${info.underlyingSymbol} for ${jTokenSymbol}` };
}

// ============================================================================
// CLAIM REWARDS
// ============================================================================

export async function claimRewards(
  privateKey: string,
  network = "mainnet",
): Promise<{ txID: string; message: string }> {
  const tronWeb = getWallet(privateKey, network);
  const addresses = getJustLendAddresses(network);
  const walletAddress = tronWeb.defaultAddress.base58;

  const { txID } = await safeSend(privateKey, {
    address: addresses.comptroller,
    abi: COMPTROLLER_ABI,
    functionName: "claimReward",
    args: [walletAddress],
  }, network);
  return { txID, message: `Claimed JustLend rewards for ${walletAddress}` };
}

// ============================================================================
// RESOURCE ESTIMATION (Energy + Bandwidth + TRX Cost)
// ============================================================================

const TYPICAL_RESOURCES: Record<string, { energy: number; bandwidth: number }> = {
  approve: { energy: 23000, bandwidth: 265 },
  supply_trx: { energy: 80000, bandwidth: 280 },
  supply_trc20: { energy: 100000, bandwidth: 310 },
  withdraw: { energy: 90000, bandwidth: 300 },
  withdraw_all: { energy: 90000, bandwidth: 300 },
  borrow: { energy: 100000, bandwidth: 313 },
  repay_trx: { energy: 80000, bandwidth: 280 },
  repay_trc20: { energy: 90000, bandwidth: 320 },
  enter_market: { energy: 80000, bandwidth: 300 },
  exit_market: { energy: 50000, bandwidth: 280 },
  claim_rewards: { energy: 60000, bandwidth: 330 },
};

const RESOURCE_PRICES = {
  energyPriceSun: 100,
  bandwidthPriceSun: 1000,
  freeBandwidthPerDay: 600,
  sunPerTRX: 1_000_000,
};

interface StepEstimate {
  step: string;
  description: string;
  energyEstimate: number;
  energyBase: number;
  energyPenalty: number;
  bandwidthEstimate: number;
  energySource: "simulation" | "typical";
  simulationError?: string;
}

export interface ResourceEstimation {
  operation: string;
  market: string;
  steps: StepEstimate[];
  totalEnergy: number;
  totalBandwidth: number;
  estimatedTRXCost: string;
  costBreakdown: {
    energyCostTRX: string;
    bandwidthCostTRX: string;
    note: string;
  };
  note: string;
}

const DATA_HEX_PROTOBUF_EXTRA = 3;
const SIGNATURE_PER_BANDWIDTH = 67;
const MAX_RESULT_SIZE_IN_TX = 64;
const FEE_LIMIT_PROTOBUF_EXTRA = 6;

function encodeParams(tronWeb: any, params: Array<{ type: string; value: any }>): string {
  if (!params || params.length === 0) return "";
  try {
    const types = params.map(p => p.type);
    const values = params.map(p => p.value);
    const hex = tronWeb.utils.abi.encodeParams(types, values);
    return typeof hex === "string" && hex.startsWith("0x") ? hex.slice(2) : hex;
  } catch {
    return "";
  }
}

async function trySimulateEnergy(
  tronWeb: any,
  ownerAddress: string,
  contractAddress: string,
  functionSelector: string,
  params: Array<{ type: string; value: any }>,
  options: any = {},
  _network = "mainnet",
): Promise<{ energy: number | null; energyPenalty: number; bandwidth: number | null; error?: string }> {
  const parameter = encodeParams(tronWeb, params);
  const callValue = options.callValue ? parseInt(options.callValue.toString(), 10) : 0;

  const requestBody: Record<string, any> = {
    owner_address: tronWeb.address.toHex(ownerAddress),
    contract_address: tronWeb.address.toHex(contractAddress),
    function_selector: functionSelector,
    parameter,
    call_value: callValue,
    visible: false,
  };

  const [estimateResult, simResult] = await Promise.allSettled([
    tronWeb.transactionBuilder.estimateEnergy(
      contractAddress,
      functionSelector,
      options,
      params,
      ownerAddress,
    ),
    tronWeb.fullNode.request('wallet/triggerconstantcontract', requestBody, 'post'),
  ]);

  const estimateData = estimateResult.status === "fulfilled" ? estimateResult.value : null;
  const simData = simResult.status === "fulfilled" ? simResult.value : null;

  const estimatedEnergy = (estimateData?.energy_required > 0) ? estimateData.energy_required : null;

  let energy: number | null = null;
  let energyPenalty = 0;
  let bandwidth: number | null = null;
  let error: string | undefined;

  if (simData?.result?.result) {
    const simEnergy = simData.energy_used || 0;
    energyPenalty = simData.energy_penalty || 0;

    energy = estimatedEnergy ?? simEnergy;

    try {
      const rawDataHex = simData.transaction?.raw_data_hex;
      if (rawDataHex) {
        const rawDataBytes = Buffer.byteLength(rawDataHex, 'hex');
        bandwidth = rawDataBytes + DATA_HEX_PROTOBUF_EXTRA + SIGNATURE_PER_BANDWIDTH + MAX_RESULT_SIZE_IN_TX + FEE_LIMIT_PROTOBUF_EXTRA;
      }
    } catch { /* ignore */ }
  } else {
    energy = estimatedEnergy;
    const errorMsg = simData?.result?.message
      ? Buffer.from(simData.result.message, "hex").toString()
      : "simulation reverted";
    error = errorMsg;
  }

  return { energy, energyPenalty, bandwidth, error };
}

function buildStep(
  step: string,
  description: string,
  simResult: { energy: number | null; energyPenalty: number; bandwidth: number | null; error?: string },
  typicalKey: string,
): StepEstimate {
  const typical = TYPICAL_RESOURCES[typicalKey];
  const simEnergy = simResult.energy;
  const energyEstimate = simEnergy !== null ? simEnergy : typical.energy;
  const energyPenalty = simResult.energyPenalty || 0;
  const energyBase = Math.max(energyEstimate - energyPenalty, 0);
  const bandwidthEstimate = simResult.bandwidth !== null
    ? simResult.bandwidth
    : typical.bandwidth;
  const energySource: StepEstimate["energySource"] = simEnergy !== null ? "simulation" : "typical";
  return {
    step,
    description,
    energyEstimate,
    energyBase,
    energyPenalty,
    bandwidthEstimate,
    energySource,
    ...(simResult.error ? { simulationError: simResult.error } : {}),
  };
}

function calculateTRXCost(totalEnergy: number, totalBandwidth: number): ResourceEstimation["costBreakdown"] & { total: string } {
  const energyCost = totalEnergy * RESOURCE_PRICES.energyPriceSun;
  const bandwidthCost = totalBandwidth * RESOURCE_PRICES.bandwidthPriceSun;
  const totalCost = energyCost + bandwidthCost;

  return {
    energyCostTRX: (energyCost / RESOURCE_PRICES.sunPerTRX).toFixed(3),
    bandwidthCostTRX: (bandwidthCost / RESOURCE_PRICES.sunPerTRX).toFixed(3),
    total: (totalCost / RESOURCE_PRICES.sunPerTRX).toFixed(3),
    note: `Energy price: ${RESOURCE_PRICES.energyPriceSun} SUN/unit, Bandwidth price: ${RESOURCE_PRICES.bandwidthPriceSun} SUN/point. If you have staked TRX for energy/bandwidth, actual TRX cost will be lower. Each account gets ${RESOURCE_PRICES.freeBandwidthPerDay} free bandwidth points per day.`,
  };
}

export type LendingOperation =
  | "supply" | "withdraw" | "withdraw_all" | "borrow" | "repay"
  | "enter_market" | "exit_market" | "approve" | "claim_rewards";

export interface ResourceWarning {
  hasEnoughEnergy: boolean;
  hasEnoughBandwidth: boolean;
  accountEnergy: number;
  accountBandwidth: number;
  requiredEnergy: number;
  requiredBandwidth: number;
  energyDeficit: number;
  bandwidthDeficit: number;
  energyBurnTRX: string;
  bandwidthBurnTRX: string;
  totalBurnTRX: string;
  warning: string;
}

export async function checkResourceSufficiency(
  ownerAddress: string,
  requiredEnergy: number,
  requiredBandwidth: number,
  network = "mainnet",
): Promise<ResourceWarning> {
  const tronWeb = getTronWeb(network);
  const resources = await tronWeb.trx.getAccountResources(ownerAddress);

  const totalEnergy = (resources.EnergyLimit || 0) - (resources.EnergyUsed || 0);
  const freeBandwidth = (resources.freeNetLimit || 0) - (resources.freeNetUsed || 0);
  const stakedBandwidth = (resources.NetLimit || 0) - (resources.NetUsed || 0);

  const energyDeficit = Math.max(0, requiredEnergy - totalEnergy);
  const bandwidthCovered = freeBandwidth >= requiredBandwidth || stakedBandwidth >= requiredBandwidth;
  const bandwidthDeficit = bandwidthCovered ? 0 : requiredBandwidth;
  const totalBandwidth = freeBandwidth + stakedBandwidth;

  const energyBurnTRX = energyDeficit * RESOURCE_PRICES.energyPriceSun / RESOURCE_PRICES.sunPerTRX;
  const bandwidthBurnTRX = bandwidthDeficit * RESOURCE_PRICES.bandwidthPriceSun / RESOURCE_PRICES.sunPerTRX;

  const warnings: string[] = [];
  if (energyDeficit > 0) {
    warnings.push(
      `Energy insufficient: you have ${totalEnergy} but need ~${requiredEnergy}. ` +
      `Deficit of ${energyDeficit} energy will burn ~${energyBurnTRX.toFixed(3)} TRX.`
    );
  }
  if (bandwidthDeficit > 0) {
    warnings.push(
      `Bandwidth insufficient: you have ${totalBandwidth} but need ~${requiredBandwidth}. ` +
      `Deficit of ${bandwidthDeficit} bandwidth will burn ~${bandwidthBurnTRX.toFixed(3)} TRX.`
    );
  }

  return {
    hasEnoughEnergy: energyDeficit === 0,
    hasEnoughBandwidth: bandwidthDeficit === 0,
    accountEnergy: totalEnergy,
    accountBandwidth: totalBandwidth,
    requiredEnergy,
    requiredBandwidth,
    energyDeficit,
    bandwidthDeficit,
    energyBurnTRX: energyBurnTRX.toFixed(3),
    bandwidthBurnTRX: bandwidthBurnTRX.toFixed(3),
    totalBurnTRX: (energyBurnTRX + bandwidthBurnTRX).toFixed(3),
    warning: warnings.length > 0
      ? `⚠️ RESOURCE WARNING: ${warnings.join(" ")} Consider staking TRX for energy to reduce costs.`
      : "",
  };
}

export function getTypicalResources(operation: string, isTRX: boolean): { energy: number; bandwidth: number } {
  let key = operation;
  if (operation === "supply") key = isTRX ? "supply_trx" : "supply_trc20";
  if (operation === "repay") key = isTRX ? "repay_trx" : "repay_trc20";
  return TYPICAL_RESOURCES[key] || { energy: 100000, bandwidth: 300 };
}

async function estimateApproveStep(
  tronWeb: any,
  ownerAddress: string,
  tokenAddress: string,
  spenderAddress: string,
  tokenSymbol: string,
  spenderLabel: string,
  requiredAmount: bigint | undefined,
  network: string,
): Promise<{ step: StepEstimate; skipped: boolean } | null> {
  const sim = (addr: string, fn: string, params: Array<{ type: string; value: any }>, opts: any = {}) =>
    trySimulateEnergy(tronWeb, ownerAddress, addr, fn, params, opts, network);

  let currentAllowance = 0n;
  try {
    const token = tronWeb.contract(TRC20_ABI, tokenAddress);
    const raw = await token.methods.allowance(ownerAddress, spenderAddress).call();
    currentAllowance = BigInt(raw);
  } catch { /* default to 0 */ }

  if (requiredAmount !== undefined && currentAllowance >= requiredAmount && currentAllowance > 0n) {
    return null;
  }

  const r = await sim(tokenAddress, "approve(address,uint256)", [
    { type: "address", value: spenderAddress }, { type: "uint256", value: MAX_UINT256 },
  ]);

  if (r.energy !== null && currentAllowance === 0n) {
    r.energy = Math.max(r.energy, TYPICAL_RESOURCES.approve.energy);
  }

  const step = buildStep("approve", `Approve ${tokenSymbol} for ${spenderLabel}`, r, "approve");
  return { step, skipped: false };
}

export async function estimateLendingEnergy(
  operation: LendingOperation,
  jTokenSymbol: string,
  amount: string,
  ownerAddress: string,
  network = "mainnet",
  spender?: string,
): Promise<ResourceEstimation> {
  const tronWeb = getTronWeb(network);
  const addresses = getJustLendAddresses(network);
  const steps: StepEstimate[] = [];

  const sim = (addr: string, fn: string, params: Array<{ type: string; value: any }>, opts: any = {}) =>
    trySimulateEnergy(tronWeb, ownerAddress, addr, fn, params, opts, network);

  let info: JTokenInfo | undefined;
  if (operation !== "claim_rewards") {
    info = resolveJToken(jTokenSymbol, network);
  }

  const isTRX = info ? (info.underlyingSymbol === "TRX" || !info.underlying) : false;

  switch (operation) {

    case "approve": {
      if (isTRX || !info!.underlying) throw new Error(`${jTokenSymbol} is native TRX — no approval needed`);
      const spenderAddr = spender || info!.address;
      const spenderLabel = spender ? spender : jTokenSymbol;
      const result = await estimateApproveStep(
        tronWeb, ownerAddress, info!.underlying, spenderAddr,
        info!.underlyingSymbol, spenderLabel, undefined, network,
      );
      if (result) steps.push(result.step);
      break;
    }

    case "supply": {
      const amountRaw = utils.parseUnits(amount, info!.underlyingDecimals);
      if (!isTRX && info!.underlying) {
        const approveResult = await estimateApproveStep(
          tronWeb, ownerAddress, info!.underlying, info!.address,
          info!.underlyingSymbol, jTokenSymbol, amountRaw, network,
        );
        if (approveResult) {
          steps.push(approveResult.step);
        }
      }
      if (isTRX) {
        const mr = await sim(info!.address, "mint()", [], { callValue: amountRaw.toString() });
        steps.push(buildStep("mint", `Supply ${amount} TRX to ${jTokenSymbol}`, mr, "supply_trx"));
      } else {
        const mr = await sim(info!.address, "mint(uint256)", [{ type: "uint256", value: amountRaw.toString() }]);
        steps.push(buildStep("mint", `Supply ${amount} ${info!.underlyingSymbol} to ${jTokenSymbol}`, mr, "supply_trc20"));
      }
      break;
    }

    case "withdraw": {
      const amountRaw = utils.parseUnits(amount, info!.underlyingDecimals).toString();
      const r = await sim(info!.address, "redeemUnderlying(uint256)", [{ type: "uint256", value: amountRaw }]);
      steps.push(buildStep("redeemUnderlying", `Withdraw ${amount} ${info!.underlyingSymbol} from ${jTokenSymbol}`, r, "withdraw"));
      break;
    }

    case "withdraw_all": {
      const r = await sim(info!.address, "redeem(uint256)", [{ type: "uint256", value: "100000000" }]);
      steps.push(buildStep("redeem", `Withdraw all ${info!.underlyingSymbol} from ${jTokenSymbol}`, r, "withdraw_all"));
      break;
    }

    case "borrow": {
      const amountRaw = utils.parseUnits(amount, info!.underlyingDecimals).toString();
      const r = await sim(info!.address, "borrow(uint256)", [{ type: "uint256", value: amountRaw }]);
      steps.push(buildStep("borrow", `Borrow ${amount} ${info!.underlyingSymbol} from ${jTokenSymbol}`, r, "borrow"));
      break;
    }

    case "repay": {
      const amountRaw = utils.parseUnits(amount, info!.underlyingDecimals);
      if (!isTRX && info!.underlying) {
        const approveResult = await estimateApproveStep(
          tronWeb, ownerAddress, info!.underlying, info!.address,
          info!.underlyingSymbol, jTokenSymbol, amountRaw, network,
        );
        if (approveResult) {
          steps.push(approveResult.step);
        }
      }
      if (isTRX) {
        const r = await sim(info!.address, "repayBorrow()", [], { callValue: amountRaw.toString() });
        steps.push(buildStep("repayBorrow", `Repay ${amount} TRX to ${jTokenSymbol}`, r, "repay_trx"));
      } else {
        const r = await sim(info!.address, "repayBorrow(uint256)", [{ type: "uint256", value: amountRaw.toString() }]);
        steps.push(buildStep("repayBorrow", `Repay ${amount} ${info!.underlyingSymbol} to ${jTokenSymbol}`, r, "repay_trc20"));
      }
      break;
    }

    case "enter_market": {
      const r = await sim(addresses.comptroller, "enterMarkets(address[])", [{ type: "address[]", value: [info!.address] }]);
      steps.push(buildStep("enterMarkets", `Enable ${jTokenSymbol} as collateral`, r, "enter_market"));
      break;
    }

    case "exit_market": {
      const r = await sim(addresses.comptroller, "exitMarket(address)", [{ type: "address", value: info!.address }]);
      steps.push(buildStep("exitMarket", `Disable ${jTokenSymbol} as collateral`, r, "exit_market"));
      break;
    }

    case "claim_rewards": {
      const r = await sim(addresses.comptroller, "claimReward(address)", [{ type: "address", value: ownerAddress }]);
      steps.push(buildStep("claimReward", `Claim JustLend mining rewards`, r, "claim_rewards"));
      break;
    }
  }

  const totalEnergy = steps.reduce((sum, s) => sum + s.energyEstimate, 0);
  const totalBandwidth = steps.reduce((sum, s) => sum + s.bandwidthEstimate, 0);
  const hasTypical = steps.some((s) => s.energySource === "typical");
  const cost = calculateTRXCost(totalEnergy, totalBandwidth);

  return {
    operation,
    market: jTokenSymbol,
    steps,
    totalEnergy,
    totalBandwidth,
    estimatedTRXCost: cost.total,
    costBreakdown: {
      energyCostTRX: cost.energyCostTRX,
      bandwidthCostTRX: cost.bandwidthCostTRX,
      note: cost.note,
    },
    note: hasTypical
      ? "Some steps could not be simulated on-chain. Typical values from historical data are used."
      : "All steps were successfully simulated on-chain.",
  };
}

export async function simulateOperationResources(
  operation: string,
  jTokenSymbol: string,
  amount: string,
  ownerAddress: string,
  network = "mainnet",
): Promise<{ energy: number; bandwidth: number; source: "simulation" | "typical" }> {
  const typical = getTypicalResources(operation, operation === "supply" || operation === "repay"
    ? (() => {
      try { const i = resolveJToken(jTokenSymbol, network); return i.underlyingSymbol === "TRX" || !i.underlying; } catch { return false; }
    })()
    : false,
  );

  try {
    const tronWeb = getTronWeb(network);
    const addresses = getJustLendAddresses(network);
    let info: JTokenInfo | undefined;
    if (operation !== "claim_rewards") {
      info = resolveJToken(jTokenSymbol, network);
    }
    const isTRX = info ? (info.underlyingSymbol === "TRX" || !info.underlying) : false;

    const sim = (addr: string, fn: string, params: Array<{ type: string; value: any }>, opts: any = {}) =>
      trySimulateEnergy(tronWeb, ownerAddress, addr, fn, params, opts, network);

    let result: { energy: number | null; energyPenalty: number; bandwidth: number | null; error?: string };

    switch (operation) {
      case "supply": {
        const amountRaw = utils.parseUnits(amount, info!.underlyingDecimals);
        if (isTRX) {
          result = await sim(info!.address, "mint()", [], { callValue: amountRaw.toString() });
        } else {
          result = await sim(info!.address, "mint(uint256)", [{ type: "uint256", value: amountRaw.toString() }]);
        }
        break;
      }
      case "withdraw": {
        const amountRaw = utils.parseUnits(amount, info!.underlyingDecimals).toString();
        result = await sim(info!.address, "redeemUnderlying(uint256)", [{ type: "uint256", value: amountRaw }]);
        break;
      }
      case "withdraw_all": {
        result = await sim(info!.address, "redeem(uint256)", [{ type: "uint256", value: "100000000" }]);
        break;
      }
      case "borrow": {
        const amountRaw = utils.parseUnits(amount, info!.underlyingDecimals).toString();
        result = await sim(info!.address, "borrow(uint256)", [{ type: "uint256", value: amountRaw }]);
        break;
      }
      case "repay": {
        let repayRaw: bigint;
        const isMax = amount === "-1" || amount.toLowerCase() === "max";
        if (isMax) {
          const jToken = tronWeb.contract(JTOKEN_ABI, info!.address);
          const borrowBal = BigInt(await jToken.methods.borrowBalanceStored(ownerAddress).call());
          repayRaw = borrowBal > 0n ? borrowBal + borrowBal / 1000n : BigInt(10 ** info!.underlyingDecimals);
        } else {
          repayRaw = utils.parseUnits(amount, info!.underlyingDecimals);
        }
        if (isTRX) {
          result = await sim(info!.address, "repayBorrow()", [], { callValue: repayRaw.toString() });
        } else {
          result = await sim(info!.address, "repayBorrow(uint256)", [{ type: "uint256", value: repayRaw.toString() }]);
        }
        break;
      }
      case "enter_market": {
        result = await sim(addresses.comptroller, "enterMarkets(address[])", [{ type: "address[]", value: [info!.address] }]);
        break;
      }
      case "exit_market": {
        result = await sim(addresses.comptroller, "exitMarket(address)", [{ type: "address", value: info!.address }]);
        break;
      }
      case "claim_rewards": {
        result = await sim(addresses.comptroller, "claimReward(address)", [{ type: "address", value: ownerAddress }]);
        break;
      }
      default:
        return { ...typical, source: "typical" };
    }

    const energy = result!.energy ?? typical.energy;
    const bandwidth = result!.bandwidth ?? typical.bandwidth;

    return { energy, bandwidth, source: result!.energy !== null ? "simulation" : "typical" };

  } catch {

    return { ...typical, source: "typical" };

  }

}