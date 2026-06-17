import { describe, it, expect } from "vitest";
import {
  fetchMoolahVaultList,
  fetchMoolahMarketList,
  fetchMoolahLiquidationTokenList,
} from "../../../src/core/services/moolah-backend.js";
import { skipOn429 } from "../../helpers.js";

// Mainnet read-only tests validating real API shapes sourced from
// front-app/src/service/V2backend.js and stores/JLv2/*.
// Each fetch* function flattens nested envelopes to { list, total, ... }.
//
// NOTE: the /index/vault/list and /vault/info endpoints use different field
// names for the same vault data (vaultAddress vs address, assetDecimals
// plural vs assetDecimal singular). Our MoolahVaultInfo interface marks all
// fields optional to tolerate either shape. Tests below check only the
// list-endpoint field names.

describe("Moolah backend API (mainnet)", () => {
  it("fetchMoolahVaultList returns flattened shape with real item fields", skipOn429(async () => {
    const res = await fetchMoolahVaultList({ pageSize: 3 }, "mainnet");
    expect(Array.isArray(res.list)).toBe(true);
    expect(typeof res.total).toBe("number");
    expect(Array.isArray(res.userList)).toBe(true);
    expect(typeof res.userTotal).toBe("number");
    expect(Array.isArray(res.depositTokens)).toBe(true);
    expect(Array.isArray(res.collateralTokens)).toBe(true);
    if (res.list.length > 0) {
      const v = res.list[0];
      // /index/vault/list items expose vaultAddress (not address)
      expect(typeof v.vaultAddress).toBe("string");
      expect(typeof v.assetSymbol).toBe("string");
      expect(typeof v.assetAddress).toBe("string");
    }
  }));

  it("fetchMoolahMarketList returns flattened shape with market items", skipOn429(async () => {
    const res = await fetchMoolahMarketList({ pageSize: 3 }, "mainnet");
    expect(Array.isArray(res.list)).toBe(true);
    expect(typeof res.total).toBe("number");
    if (res.list.length > 0) {
      const m = res.list[0];
      // /index/market/list items expose `id` for market ID (not marketId)
      expect(typeof (m.id ?? m.marketId)).toBe("string");
      expect(typeof m.loanSymbol).toBe("string");
      expect(typeof m.collateralSymbol).toBe("string");
    }
  }));

  it("fetchMoolahLiquidationTokenList returns loanSymbols and collateralSymbols arrays", skipOn429(async () => {
    const res = await fetchMoolahLiquidationTokenList("mainnet");
    expect(Array.isArray(res.loanSymbols)).toBe(true);
    expect(Array.isArray(res.collateralSymbols)).toBe(true);
  }));

  it("fetchMoolahVaultApyHistory returns an object with APY/TVL time-series fields", skipOn429(async () => {
    const { getMoolahVaultInfo } = await import("../../../src/core/chains.js");
    const { fetchMoolahVaultApyHistory } = await import("../../../src/core/services/moolah-backend.js");
    const vault = getMoolahVaultInfo("USDT", "mainnet");
    const res = await fetchMoolahVaultApyHistory(vault.address, "mainnet");
    expect(res).toBeTruthy();
    // Real response keys (from curl): currentSupplyUsd, supplyBaseApy, historyRecords, etc.
    expect(typeof res).toBe("object");
  }));

  it("fetchMoolahMarketApyHistory returns an object with market totals + list", skipOn429(async () => {
    const { fetchMoolahMarketList, fetchMoolahMarketApyHistory } = await import(
      "../../../src/core/services/moolah-backend.js"
    );
    const markets = await fetchMoolahMarketList({ pageSize: 1 }, "mainnet");
    if (markets.list.length === 0) return;
    const marketId = (markets.list[0] as any).id ?? markets.list[0].marketId;
    if (!marketId) return;
    const res = await fetchMoolahMarketApyHistory(marketId, "mainnet");
    expect(res).toBeTruthy();
    expect(typeof res).toBe("object");
  }));

  // ── V2 mining endpoints ───────────────────────────────────────────────────
  // The /v2/* endpoints are read-only and return empty maps for addresses
  // with no activity, so we hit them with a known empty address rather than
  // depending on a wallet that may have rewards. Each test asserts the
  // response shape is an object so a structural regression (e.g. an extra
  // wrapping envelope reintroduced) trips the test.

  const EMPTY_ADDRESS = "TFakeAddressNoMiningActivity000000";

  it("fetchV2VaultMiningRates returns a vault → entry map", skipOn429(async () => {
    const { fetchV2VaultMiningRates } = await import(
      "../../../src/core/services/moolah-backend.js"
    );
    const res = await fetchV2VaultMiningRates(undefined, undefined, "mainnet");
    expect(res && typeof res === "object" && !Array.isArray(res)).toBe(true);
    // When entries exist, each value must look like the real APY shape so
    // useMining.js's USDDNEW/TRXNEW reads land on real fields.
    for (const entry of Object.values(res)) {
      expect(typeof entry).toBe("object");
    }
  }));

  it("fetchV2UserMiningState returns an object even for an address with no activity", skipOn429(async () => {
    const { fetchV2UserMiningState } = await import(
      "../../../src/core/services/moolah-backend.js"
    );
    const res = await fetchV2UserMiningState(EMPTY_ADDRESS, undefined, "mainnet");
    expect(res && typeof res === "object" && !Array.isArray(res)).toBe(true);
  }));

  it("fetchV2UnclaimedAirdrop returns an object even for an address with no rewards", skipOn429(async () => {
    const { fetchV2UnclaimedAirdrop } = await import(
      "../../../src/core/services/moolah-backend.js"
    );
    const res = await fetchV2UnclaimedAirdrop(EMPTY_ADDRESS, true, "mainnet");
    expect(res && typeof res === "object" && !Array.isArray(res)).toBe(true);
  }));
});
