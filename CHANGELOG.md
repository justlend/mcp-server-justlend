# Changelog

All notable changes to `@justlend/mcp-server-justlend` are documented here. Format inspired by [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) with [Semantic Versioning](https://semver.org/). Dates are approximate, derived from git history; see the repository log for exact commits.

## [Unreleased]

### Security

- Close the 2026-10-26 audit findings with body-parser `1.20.9` / `2.4.0` and fast-uri `3.1.9`. Their preceding releases on the same major lines remain affected, so use the latest patched versions on those lines.
- Migrate the shared Zod dependency to `4.6.6` (the next-to-latest stable release); no Zod 3 release fixes GHSA-mrhx-c7xc-m3w5. Apply the same version to agent-wallet and other transitive consumers, and verify temporary-wallet creation/import/reload and MCP schemas against the override.
- Generate field descriptions through Zod 4's public JSON Schema API instead of Zod 3 private internals; retain required/null/default/constraint distinctions. Add collection-size and loopback compressed-body regressions, including both installed body-parser major lines.

- Limit each tool call to 10,000 combined array elements and object members before schema validation; retain the HTTP parser's 1 MiB request-body limit.
- Patch remaining redirect-header and source-map advisories with follow-redirects `1.16.1` and source-map-js `1.2.2`; the previous stable releases remain affected. Add loopback regressions for array-form and declared sensitive headers across redirects.
- Refresh the development toolchain to patched next-to-latest stable releases on the existing major lines: Vitest `4.1.11`, Vite `8.3.4`, and PostCSS `8.5.30`. Release order and advisory ranges checked on 2026-10-21; production dependencies and the CI audit threshold are otherwise unchanged.
- Upgrade the SDK to `1.32.0` and pin patched transitive HTTP/URL dependencies: Axios `1.20.0`, fast-uri `3.1.8`, Hono `4.13.12`, ip-address `10.7.3`, proxy-addr `2.0.8`, and qs `6.16.0`.
- Prefer the next-to-latest stable release on the existing major line where patched (SDK, Hono, ip-address, qs). Axios, fast-uri 3.x, and proxy-addr require their latest release on that line because the previous release remains affected. Selection checked on 2026-10-19; no major-version migration or audit-threshold relaxation.
- Remove redundant Express-specific body-parser overrides that conflicted during npm dependency validation; the locked body-parser versions remain unchanged.
- Add offline regressions for proxy-trust IP spoofing and comma-array query-limit bypasses. Dependency audit findings do not by themselves establish that every vulnerable feature is used by this server.

### Fixed

- Replace obsolete browser-wallet recommendations in the quick-setup script with agent-mode and local-only import guidance; browser signing remains disabled.

- Fail energy-rental quotes and transaction preflight on unavailable, rejected or malformed contract reads instead of substituting parameter, pause, usage-ratio or rate defaults.
- Require both market rates; deployments without the required getters return errors rather than a rate-model substitute quote.
- Require real global resource values for API-to-chain energy conversion, expose quote input sources, and distinguish unknown order/renewal data from verified zero values.
- Add offline quote, renewal, RPC-failure and no-broadcast regression controls.

## [1.1.4] — 2026-09-02

**Theme**: wallet initialization race hardening and release-artifact alignment.

### Fixed

- Serialized first-use wallet initialization across processes with an owned `O_EXCL` lock descriptor, bounded stale-lock handling, and a second existence check before creation.
- Wired the secure local secret loader into every agent-wallet provider so persisted key material is decrypted through the configured secret store.
- Verified CSPRNG failure and concurrent first-use paths fail closed without leaving private-key or lock artifacts.
- Kept operator-supplied `AGENT_WALLET_PASSWORD` in memory during wallet import; only an explicitly opted-in generated fallback may be persisted.
- Reject invalid HTTP numeric environment settings before startup so `NaN` cannot disable session, timeout, or rate-limit boundaries.
- Aligned the package metadata and release documentation with the fixed wallet implementation.

## [1.1.3] — 2026-08-19

**Theme**: secure energy direct purchase, versioned MCP structured outputs, and market-inventory reconciliation.

### Added

- Added six fail-closed energy direct-purchase tools for configuration discovery, authoritative quotes, public history, order recovery, payment-risk reconciliation, and confirmed purchases.
- All 104 tools now declare a common MCP `outputSchema` and return a versioned `structuredContent` envelope (`schemaVersion`, `tool`, `result`) on success while preserving legacy text content.
- The generated `mcp-api-list.md` now documents the output contract globally and on every tool.
- Registration and adapter tests lock output-schema coverage and backward-compatible text results.

### Fixed

- Reconciled the V1 roster to **24 markets (18 active + 6 legacy)** and restored active `jU` to the README table.
- Corrected stale tool-module and historical-record counts in the architecture reference.
- Hardened direct-purchase recovery with payer-scoped intents, cross-process serialization, duplicate-payment protection, and solidified-success confirmation before order creation.
- Blocked redirect forwarding for signed payments/order tokens, restored public payer history, and retained recovery state until history confirms tokenless idempotent orders.
- Updated the transitive `nanoid` override to the patched `3.3.18` release.

## [1.1.2] — 2026-07-15

**Theme**: TRX↔WTRX wrap/unwrap tools + USDT/USDC/USDJ approve reset-to-0 hardening.

### Added — WTRX wrap / unwrap

- New tools **`wrap_trx`** (native TRX → WTRX, 1:1 via the WTRX contract's payable `deposit()`) and **`unwrap_trx`** (WTRX → native TRX via `withdraw(uint256)`). Mirrors the app front-end's WTRX swap; runs on the hardened `safeSend` path (pre-flight simulation + mainnet fail-closed on `REVERT`) with non-negative/precision-guarded amounts and TRX/WTRX balance pre-checks. Tool count **96 → 98**.
- Both paths validate the on-chain WTRX `decimals()` against TRX's `6` before moving funds — the 1:1 mapping is only valid at 6 decimals, so a mismatch aborts (a transient read failure falls back to 6). `unwrap_trx` gained a symmetric TRX-for-gas pre-check (matching `wrap_trx`), and the tool descriptions now note wrap/unwrap are reversible.

### Fixed — approve allowance handling

- TetherToken-style tokens (**USDT / USDC / USDJ**) now reset the allowance to `0` before a new non-zero `approve`, so re-approving on a stale non-zero allowance no longer reverts. Applied across all five approve services (`approveUnderlying`, `approveMoolahVault`, `approveMoolahProxy`, `approveLiquidatorToken`, `approveTRC20`) via a shared `approveWithReset` helper (reset then await confirmation before the target approve, so its pre-flight simulation sees the zeroed allowance).
- `amount='0'` revoke is no longer swallowed by the sufficient-allowance short-circuit — it now sends `approve(0)`, so the revoke path the unlimited-approval warning points to actually works.
- The reset-to-0 step now waits for the reset tx to **succeed** (not merely be mined) before the target approve, via a new opt-in `requireSuccess` on `waitForTransaction`; a reverted reset aborts with the decoded reason instead of falling through.
- `approveTRC20` (the generic approve) now reads the token `symbol()` best-effort so a USDT/USDC/USDJ token whose address isn't in the mainnet reset list (e.g. a testnet mock) still gets the reset-to-0 treatment, and uses the known TRC20 ABI instead of an on-chain ABI fetch.

## [1.1.1] — 2026-06-26

**Theme**: New `jU` (U) V1 jToken market + dependency/security hardening + tooling-doc consistency.

### Added — jU market

- Registered the new **`jU`** mainnet jToken in `src/core/chains.ts`:
  - jToken delegator `TMz7vmyqoq4WKDiztrZpjAZPnzE9XgXaK4`
  - underlying **U** `TFNirp6PbqYE1ZTtWuCMUKJWLNZkoCoeFJ`, 18 underlying decimals (jToken decimals 8)
  - Source of truth: `GET https://openapi.just.network/lend/jtoken` (symbol `jU` / underlyingSymbol `U`).
- All market, account, and balance tools now surface `jU` automatically via `getJTokenInfo` / `getAllJTokens`. This brings the mainnet roster to **18 active + 6 legacy = 24 jToken markets**.

### Fixed

- npm audit advisories cleared and Moolah V2 amount/decimals validation hardened (folded in from the closed PR #23 audit branch).
- README directory-tree comment tool count `90 → 96` to match the actual tool registry (`server.tool` registrations, `mcp-api-list.md`, and the docs all agree on 96).

## [1.1.0] — 2026-06-16

**Theme**: JustLend V2 (Moolah) protocol support + historical records + gas estimation, plus AI-agent ergonomics (structured self-healing errors, self-describing amounts, hardened input schemas).

### Added — JustLend V2 (Moolah) core (M1)

- **Service layer** (6 modules, 42 exported functions):
  - `moolah-backend.ts` — REST wrapper for `zenvora.ablesdxd.link` (16 functions covering vault / market / position / liquidation / records / token endpoints)
  - `moolah-query.ts` — on-chain view reads: `getMoolahMarketState`, `getMoolahUserPosition`, `getMoolahMarketParams`, `isMoolahPositionHealthy`, vault totalAssets / maxWithdraw / convertToShares+Assets, and liquidation quote helper
  - `moolah-vault.ts` — ERC4626 vault write ops (deposit / withdraw / redeem / approve)
  - `moolah-market.ts` — supplyCollateral / withdrawCollateral / borrow / repay / composite supplyCollateralAndBorrow / approveMoolahProxy
  - `moolah-liquidation.ts` — `moolahLiquidate` + `approveLiquidatorToken`
  - `moolah-dashboard.ts` — `getMoolahDashboard`, `getMoolahUserSummary`, V2 vault/market history helpers
- **Contract ABIs** (4 new): `MOOLAH_CORE_ABI`, `TRX_PROVIDER_ABI`, `MOOLAH_VAULT_ABI`, `PUBLIC_LIQUIDATOR_ABI`
- **Contract addresses**: mainnet + nile Moolah core addresses (MoolahProxy, TrxProviderProxy, PublicLiquidatorProxy, WTRX, ResilientOracle, IRM) plus vault registry. Nile is missing USDD vault (not deployed there); only TRX and USDT vaults are registered.
- **MCP tools** (21 new):
  - Vault (6): `get_moolah_vault`, `get_moolah_vaults`, `approve_moolah_vault`, `moolah_vault_deposit`, `moolah_vault_withdraw`, `moolah_vault_redeem`
  - Market (8): `get_moolah_market`, `get_moolah_markets`, `get_moolah_user_position`, `approve_moolah_proxy`, `moolah_supply_collateral`, `moolah_withdraw_collateral`, `moolah_borrow`, `moolah_repay`
  - Liquidation (5): `get_moolah_pending_liquidations`, `get_moolah_liquidation_quote`, `get_moolah_liquidation_records`, `approve_liquidator_token`, `moolah_liquidate`
  - Dashboard (2): `get_moolah_dashboard`, `get_moolah_history`
- **AI prompts** (4 new): `moolah_supply`, `moolah_borrow`, `moolah_liquidate`, `moolah_portfolio`

### Added — historical records (M2, +6 tools)

- New service module `records.ts` wrapping the paginated history endpoints on `labc.ablesdxd.link` (mainnet-only):
  - `get_lending_records` → `/justlend/record/depositBorrow` (11 V1 action types)
  - `get_strx_records` → `/justlend/record/strx`
  - `get_vote_records` → `/justlend/record/vote`
  - `get_energy_rental_records` → `/justlend/record/rent`
  - `get_liquidation_records` → `/justlend/record/liquidate` (V1 liquidations)
- Plus V2 Moolah records: `get_moolah_records` → `/record/lend`
- Each service function enriches numeric action/op codes with human-readable names (`actionName` / `opName`) so callers don't need a local lookup table.

### Added — history time series + airdrop rewards (M3, +3 tools)

- `get_moolah_vault_history` → `/vault/history-data` (APY / TVL curves)
- `get_moolah_market_history` → `/market/history-data` (borrow/supply APY + utilization curves)
- `get_claimable_rewards` → `/sunProject/getAllUnClaimedAirDrop` (scans all JustLend merkle distributors; read-only — the write path `multiClaim()` is deferred until the live response's merkle-proof fields are verified against a real airdropped address)

### Added — Moolah gas estimator (M4, +1 tool)

- `estimate_moolah_energy` + `moolah-estimate.ts` service module. Returns historical typical values for all 11 Moolah write operations with TRX vs TRC20 route differentiation. On-chain simulation for Moolah's tuple-args ops is not yet wired (typical values used as fallback; status exposed via `source: "typical"`).

### Added — AI-agent ergonomics

- **Structured, self-healing tool errors**: every tool now returns errors via `toolError()`
  (`core/tools/shared.ts`) as JSON `{ error, errorCode?, hint? }` instead of a bare `Error: <msg>`
  string. `classifyError()` maps common failures (insufficient allowance/balance, wallet not
  configured, execution reverted, market not found, invalid address) to a machine-readable
  `errorCode` and an actionable `hint` (e.g. "Raise the allowance with approve_underlying first,
  then retry"), so an agent can self-heal without parsing prose. `isError: true` is preserved.

### Changed — AI-agent ergonomics

- **Self-describing amounts across the core read paths**: token-unit amount fields now carry a
  `{ raw, decimals, _unit, display }` object alongside the existing display string, so agents
  never re-apply decimals:
    - `get_token_balance` → `amount` (and `services.getTokenBalance` returns the raw balance);
    - `get_account_summary` positions → `supplyBalanceAmount`, `borrowBalanceAmount`,
      `jTokenBalanceAmount` (built from on-chain raw + per-market decimals in the service);
    - `get_market_data` / `get_all_markets` → `totalSupplyAmount`, `totalBorrowsAmount`,
      `totalReservesAmount`, `availableLiquidityAmount`;
    - sTRX stake account → `strxBalanceAmount`, `accountSupplyAmount` (both API and on-chain paths);
    - user vote status → `votesAmount` (on-chain path, the cast vote weight);
    - energy rental info → `rentBalanceAmount`, `securityDepositAmount`.
  All existing string fields are unchanged (additive). New `describeFromDisplay()` helper in
  `core/services/bigint-math.ts` reconstructs raw exactly from a de-scaled display string for
  paths that only expose the human-readable value. USD-value and rate/APY fields are already
  self-describing by field name and are intentionally left as-is; mining rewards are USD-denominated
  and similarly need no change.
- **Hardened tool input schemas**: TRON address parameters now validate against the Base58
  format (`/^T[1-9A-HJ-NP-Za-km-z]{33}$/`) and human-readable amount parameters against a
  decimal-string format (`/^\d+(\.\d+)?$/`, or `…|max` for tools that accept a full-balance
  `max` sentinel), via shared `tronAddress` / `amountString` / `amountOrMaxString` builders in
  `core/tools/shared.ts`. Previously these were bare `z.string()` with the format only hinted in
  the description. Agents that pass a malformed address or amount now get a schema-level rejection
  instead of a deeper runtime error. Tools accepting either a symbol **or** an address (e.g.
  `market`) are intentionally left unconstrained. The hardening adds no tools.
- **`mcp-api-list.md` surfaces input constraints**: the catalog generator
  (`scripts/gen-mcp-api-list.ts`) now introspects string `regex` / `min` / `max` checks (in
  addition to the existing numeric bounds and enums), so the offline tool catalog shows the exact
  format an agent must send (e.g. `string (pattern /^T[1-9A-HJ-NP-Za-km-z]{33}$/)`).

### Fixed — HIGH-severity audit findings

- **`Number(callValue)` precision**: all TRX-payable broadcast paths (`writeContract`, `safeSend`, and both `estimateEnergy` fallbacks) now go through a new exported `callValueToSafeNumber()` helper that rejects amounts above `Number.MAX_SAFE_INTEGER` (~9.007×10¹⁵ sun / ~9 B TRX) and negative values. Mirrors the existing guard in `transfer.ts`.
- **HTTP Bearer-token timing leak**: API-key comparison in `http-server.ts` is now routed through `crypto.timingSafeEqual` via a new `src/server/auth.ts` helper. Equal-length buffers only; short-circuit and length-difference leakages removed.

### Changed — backend type alignment

- Rewrote every interface in `moolah-backend.ts` after verifying real API response shapes against the live endpoints (the first-pass types were extrapolated from front-end store field names that differ from the wire format). All fields marked optional since `/index/vault/list` and `/vault/info` use different field names for the same vault data (`vaultAddress` vs `address`, `assetDecimals` plural vs `assetDecimal` singular, etc.).
- `fetchMoolahVaultList` and `fetchMoolahMarketList` flatten the nested `allVaults.list` / `allMarkets` envelopes into a consistent `{ list, total, userList, userTotal, ... }` shape for downstream consumers.
- `getMoolahDashboard` now enforces the requested `pageSize` client-side because `/index/market/list` ignores the server-side `pageSize` parameter.
- AI prompt copy: every reference to non-existent fields (`safePercent`, `healthFactor`, `maxBorrowableUSD`) replaced with the real `risk` (0–1 ratio) and `lltv` fields.

### Tests

- New files:
  - `moolah-config.test.ts` — chains.ts + helper validation (no network)
  - `moolah-query.test.ts` — mainnet on-chain reads (skipOn429)
  - `moolah-backend.test.ts` — mainnet REST reachability + shape (skipOn429)
  - `moolah-dashboard.test.ts` — dashboard composition (skipOn429)
  - `moolah-liquidation-logic.test.ts` — mocked input validation
  - `moolah-estimate.test.ts` — typical-resources table coverage
  - `records.test.ts` — all 5 V1 record endpoints + nile rejection
  - `describe-amount.test.ts` — self-describing amount construction / round-trip
  - `strx-precision.test.ts` — sTRX BigInt precision paths
  - `wallet-signature-validation.test.ts` — wallet signature validation coverage

### Docs

- `forTest/docs/v1.1.0/v1.1.0-development-plan.md` and `m1-moolah-dev-steps.md` revised to match shipped reality and annotated with a "分支代码落地情况" section that cross-checks plan against code via `grep`/`git log`/`npm test`.
- `forTest/audit/mcp-server-justlend-audit-report-v1.1.0-20260417.md` + 修改版 variant documenting the security audit and HIGH fixes.

---

## [1.0.8] - 2026-06-10

Security-hardening release: addresses the 2026-06-03 **and** 2026-06-09 full-audit
findings, plus dependency advisory cleanup. Tool surface unchanged (59 tools).

### Security
- Address 2026-06-03 full-audit findings (governance read-path data-integrity, energy-rental
  float-to-Sun construction review, dependency reachability).
- Clear transitive `npm audit` advisories via `overrides`: `qs` `6.15.2`, `ws` `8.20.1`
  (alongside the existing `fast-uri` `3.1.2`), and bump `hono` `4.12.18 → 4.12.25` (it was
  pinned to a vulnerable version; transitive via `@modelcontextprotocol/sdk`).
  `npm audit --omit=dev` no longer reports `hono`.
- **HTTP rate limiting**: add `express-rate-limit` — a per-IP general limiter (default 120/min,
  `/health` exempt, `MCP_RATE_LIMIT_PER_MIN`) plus a stricter new-session limiter on `/sse`
  (default 10/min, `MCP_SSE_RATE_LIMIT_PER_MIN`). Guards against abuse / RPC-quota & memory
  exhaustion if the API key leaks.
- Enable the security-guidance plugin in project settings.

### Fixed
- **Governance data integrity**: `getProposalList` no longer silently drops proposals whose
  on-chain `state()` read fails — it collects them into `failedProposals[]`, logs a warning, and
  surfaces them via the `get_proposal_list` tool, so callers can tell "no such proposal" from
  "read failed" (the returned list may be shorter than `total`).
- **Collateral safety**: `disableCollateral` no longer silently skips markets it fails to read
  (which could under-count borrows and make the pre-check look safe). It now warns per skip and
  fails closed — refusing to disable collateral on incomplete on-chain risk data.
- **Display precision**: `markets` price now computes `priceUSD` with BigInt scaling (oracle
  mantissa can exceed `Number.MAX_SAFE_INTEGER`), consistent with the account path.
- **Dead code**: remove the unused `writeContract` export from `contracts.ts` (`safeSend` is the
  real write path).
- **Resource cleanup**: the HTTP session-sweeper `setInterval` is now `unref()`'d so it never
  blocks process exit.

### Added
- `mcp-api-list.md` — machine-readable, offline-loadable catalog of all tools (input
  schemas, side-effect class, HITL guidance), generated from source via
  `npm run gen:api-list` (`scripts/gen-mcp-api-list.ts`).
- Self-describing units (`_unit` / `decimals` / `raw`) on the core balance tools.

### Unchanged
- Runtime deps: `@modelcontextprotocol/sdk` `1.29.0`, `tronweb` `6.2.2`,
  `@bankofai/agent-wallet` `2.3.0`, `tronlink-signer` `0.1.1`.

## [1.0.7]

### Added
- HTX market added to mainnet chains; README market table refreshed.

### Changed
- Dependency / runtime freshness; sTRX fallback precision expectations updated.
- Resolves the v1.0.7 audit findings. Keeps the 59-tool surface.

## [1.0.6]

### Fixed
- Address `audit-2026-05-13` findings: approve safety (explicit approval amounts, opt-in
  unlimited `max`), BigInt precision, typed broadcast handling.
- Expand scientific notation in BigInt parsing for high-TVL exchange rates.
- Degrade gracefully when the mining-rewards API is unavailable on Nile (fallback).

## [1.0.4]

### Fixed
- Address `audit-2026-05-07` high findings: timing-safe `MCP_API_KEY` comparison
  (`crypto.timingSafeEqual` + length check), callValue precision.
- Stop `safeSend` from broadcasting on a simulated `REVERT` (mainnet fail-closed); scope
  stdio session state.
- Resolve real `decimals` for `transfer_trc20` when given a raw token address.
- Zero the private-key buffer after use; bump `follow-redirects`.
- Use BigInt comparison for sTRX unstake balance check and safe float-to-Sun conversion.

### Changed
- Pin all dependency versions to exact installed versions.

## [1.0.3]

### Changed
- Browser-wallet signing via TronLink (sign-only mode); dual wallet mode: `browser`
  (recommended) or `agent` (encrypted local storage).
- Maintenance and dependency updates.

## [1.0.1]

### Changed
- Early post-release fixes.

## [1.0.0]

### Added
- Initial release: 59 MCP tools across Wallet & Network, Market Data, Account & Balances,
  Lending Operations, Mining & Rewards, JST Voting / Governance, Energy Rental, sTRX
  Staking, Transfers, and general TRON utilities. Dual-mode signing (browser TronLink via
  TIP-6963 or encrypted `@bankofai/agent-wallet`). stdio and HTTP/SSE transports.

[1.1.0]: https://github.com/justlend/mcp-server-justlend/releases/tag/v1.1.0
[1.0.8]: https://github.com/justlend/mcp-server-justlend/releases/tag/v1.0.8
[1.0.7]: https://github.com/justlend/mcp-server-justlend/commit/e6d4bc917e522d8fc7fe50a6e653e2719943b129
[1.0.6]: https://github.com/justlend/mcp-server-justlend/releases/tag/v1.0.6
[1.0.4]: https://github.com/justlend/mcp-server-justlend/releases/tag/v1.0.4
[1.0.3]: https://github.com/justlend/mcp-server-justlend/releases/tag/v1.0.3
[1.0.1]: https://github.com/justlend/mcp-server-justlend/releases/tag/v1.0.1
[1.0.0]: https://github.com/justlend/mcp-server-justlend/releases/tag/v1.0.0
