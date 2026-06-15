# Changelog

All notable changes to `@justlend/mcp-server-justlend` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Dates are
approximate, derived from git history; see the repository log for exact commits.

## [Unreleased]

### Changed
- **Hardened tool input schemas**: TRON address parameters now validate against the Base58
  format (`/^T[1-9A-HJ-NP-Za-km-z]{33}$/`) and human-readable amount parameters against a
  decimal-string format (`/^\d+(\.\d+)?$/`, or `…|max` for tools that accept a full-balance
  `max` sentinel), via shared `tronAddress` / `amountString` / `amountOrMaxString` builders in
  `core/tools/shared.ts`. Previously these were bare `z.string()` with the format only hinted in
  the description. Agents that pass a malformed address or amount now get a schema-level rejection
  instead of a deeper runtime error. Tools accepting either a symbol **or** an address (e.g.
  `market`) are intentionally left unconstrained. Tool surface unchanged (59 tools).
- **`mcp-api-list.md` surfaces input constraints**: the catalog generator
  (`scripts/gen-mcp-api-list.ts`) now introspects string `regex` / `min` / `max` checks (in
  addition to the existing numeric bounds and enums), so the offline tool catalog shows the exact
  format an agent must send (e.g. `string (pattern /^T[1-9A-HJ-NP-Za-km-z]{33}$/)`).

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
- `mcp-api-list.md` — machine-readable, offline-loadable catalog of all 59 tools (input
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

[1.0.8]: https://github.com/justlend/mcp-server-justlend/releases/tag/v1.0.8
[1.0.7]: https://github.com/justlend/mcp-server-justlend/releases/tag/v1.0.7
[1.0.6]: https://github.com/justlend/mcp-server-justlend/releases/tag/v1.0.6
[1.0.4]: https://github.com/justlend/mcp-server-justlend/releases/tag/v1.0.4
[1.0.3]: https://github.com/justlend/mcp-server-justlend/releases/tag/v1.0.3
[1.0.1]: https://github.com/justlend/mcp-server-justlend/releases/tag/v1.0.1
[1.0.0]: https://github.com/justlend/mcp-server-justlend/releases/tag/v1.0.0
