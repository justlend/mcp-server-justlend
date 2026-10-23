# mcp-server-justlend

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![TRON Network](https://img.shields.io/badge/Network-TRON-red)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-3178C6)
![MCP](https://img.shields.io/badge/MCP-1.22.0+-blue)
![JustLend](https://img.shields.io/badge/Protocol-JustLend_DAO-green)
![npm](https://img.shields.io/badge/npm-@justlend/mcp--server--justlend-CB3837)

A Model Context Protocol (MCP) server that enables AI agents to interact with the **JustLend DAO** lending protocol on TRON. Supply assets, borrow against collateral, manage positions, participate in V2 (Moolah) isolated markets and vaults, and analyze DeFi portfolios — all through a unified AI interface.

Beyond JustLend-specific operations, the server also exposes a full set of **general-purpose TRON chain utilities** — balance queries, block/transaction data, token metadata, TRX transfers, smart contract reads/writes, staking (Stake 2.0), multicall, and more.

## Overview

[JustLend DAO](https://justlend.org) is the largest lending protocol on TRON. This MCP server wraps the full protocol functionality into tools and guided prompts that local MCP clients such as Claude Desktop, Codex, Claude Code, and Cursor can use.

**📌 Current Version: v1.1.4 — JustLend V1 + V2 (Moolah), plus TRX↔WTRX wrap/unwrap**

- **JustLend V1** (Compound V2 fork): the original pool-based protocol — `jUSDT`, `jTRX`, `jUSDD`, `jSUN`, `jWBTC`, etc. Full supply / borrow / repay / withdraw / collateral management and mining rewards.
- **JustLend V2 (Moolah)** (Morpho Blue fork): isolated markets with `MarketParams (loanToken, collateralToken, oracle, irm, lltv)` and ERC4626 vaults that auto-allocate across markets. Full vault deposit / redeem, collateral supply / borrow / repay / liquidate, and public liquidations.

### Key Capabilities

#### JustLend V1 (pool-based, Compound V2 fork)
- **Market Data**: Real-time APYs, TVL, utilization rates, prices for all markets
  - Smart fallback: contract queries first, API fallback for reliability
  - TTL caching (30–60s) to reduce RPC calls
- **Account Data**: Full position analysis via Multicall3 batch queries (~2.5s vs ~8s legacy)
  - Health factor, collateral, borrow positions
  - On-chain Oracle prices with API fallback
- **Batch Wallet Balances**: Query all TRC20 token balances in a single Multicall3 RPC call
- **Mining Rewards**: Advanced mining reward calculation (based on justlend-app logic)
  - Detailed breakdown by market and reward token (USDD, TRX, WBTC, etc.)
  - USD value calculation with live token prices
- **Supply / Borrow / Repay / Withdraw**: Full lending operations with pre-flight checks
- **Collateral Management**: Enter/exit markets, manage what counts as collateral
- **Portfolio Analysis**: AI-guided risk assessment, health factor monitoring, optimization
- **JST Voting / Governance**: View proposals, cast votes, deposit/withdraw JST for voting power, reclaim votes
- **Energy Rental + Direct Purchase**: Rent energy on-chain, or query/quote/buy energy through the separately configured direct-purchase service
- **sTRX Staking**: Stake TRX to receive sTRX, unstake sTRX, claim staking rewards, check withdrawal eligibility
  - Precision-safe BigInt/string math for TRX Sun conversion and 18-decimal sTRX balances/exchange-rate display

#### JustLend V2 — Moolah (New in v1.1.0)
- **ERC4626 Vaults** (TRX / USDT / USDD on mainnet; TRX + USDT on nile): auto-compounding yield with a curator that allocates deposits across isolated markets. Deposit / withdraw (by asset amount or `max`) / redeem (by shares) with TRC20 approvals handled as a separate tool so LLMs can reason about each step.
- **Isolated Markets**: each market is a `(loanToken, collateralToken, oracle, irm, lltv)` tuple. Supply collateral → borrow → repay → withdraw collateral, plus a composite `moolah_borrow` that handles collateral+borrow as two sequential txs. TRX routes through the `TrxProviderProxy` contract; TRC20 goes through `MoolahProxy` directly.
- **Public Liquidations**: list undercollateralized positions (`risk > 1.0`), quote loan-token requirement for a target seize, execute liquidation. Includes an explicit `approve_liquidator_token` step.
- **Dashboard + History**: aggregated user position, APY / TVL time-series for vaults and markets, paginated V2 transaction records.
- **Gas estimation**: `estimate_moolah_energy` returns typical historical energy / bandwidth / TRX cost for every V2 write op.

#### Historical records (New in v1.1.0)
- Paginated REST wrappers for V1 lending / sTRX / voting / energy-rental / liquidation history, plus V2 Moolah records. Each endpoint's numeric action/op codes are enriched with human-readable names (`actionName` / `opName`) client-side so MCP tools are self-describing.

#### Browser Wallet Signing
- **Disabled by default**: the legacy `tronlink-signer` loopback bridge lacks request-level authentication
- **Safe current mode**: use agent-wallet with `AGENT_WALLET_PASSWORD`; browser signing will return only after an authenticated bridge is available

#### General TRON Chain
- **Balances**: TRX balance (with Sun/TRX conversion), TRC20/TRC1155 token balances
- **Blocks**: Latest block, block by number/hash, block number, chain ID
- **Transactions**: Fetch transaction details, receipts, wait for confirmation
- **Contracts**: Read/write any contract, fetch on-chain ABI, multicall (v2 & v3), deploy, estimate energy
- **Token Metadata**: TRC20 info (name/symbol/decimals/supply), TRC721 metadata, TRC1155 URI
- **Transfers**: Send TRX, transfer TRC20 tokens, approve spenders
  - Transfer/approval paths validate recipient, token, and spender TRON addresses before signing
- **Staking (Stake 2.0)**: Freeze/unfreeze TRX for BANDWIDTH or ENERGY, withdraw expired unfreeze
- **Address Utilities**: Hex ↔ Base58 conversion, address validation, resolution
- **Wallet**: Sign messages and transactions through agent-wallet; the unauthenticated browser bridge is disabled

## Supported Markets

### JustLend V1 (pool-based)

The protocol currently exposes **18 active + 6 legacy = 24 markets**. This roster was cross-checked against the expanded JustLend app market table and live `/lend/jtoken` API on 2026-08-19. Call `get_supported_markets` for the live list with addresses; the active markets are:

| jToken     | Underlying | Description |
|------------|-----------|-------------|
| jTRX       | TRX       | Native TRON token |
| jUSDT      | USDT      | Tether USD |
| jUSDD      | USDD      | Decentralized USD (USDD/TRX supply‑mining rewards) |
| jUSD1      | USD1      | World Liberty Financial USD |
| jTUSD      | TUSD      | TrueUSD |
| jwstUSDT   | wstUSDT   | Wrapped staked USDT (yields underlying staking APY) |
| jsTRX      | sTRX      | Staked TRX (yields underlying staking APY) |
| jBTC       | BTC       | Bitcoin (wrapped) |
| jWBTC      | WBTC      | Wrapped Bitcoin |
| jETH       | ETH       | Ethereum — dApp UI displays as "ETH" (formerly "ETHOLD") |
| jETHB      | ETHB      | Bridged Ethereum — dApp UI displays as "ETHB" (formerly "ETH") |
| jSUN       | SUN       | SUN token |
| jJST       | JST       | JUST governance token |
| jWIN       | WIN       | WINkLink |
| jBTT       | BTT       | BitTorrent token |
| jNFT       | NFT       | APENFT |
| jHTX       | HTX       | HTX token |
| jU         | U         | U token |

Paused / legacy markets (closed to new supply/borrow, queryable for read & to unwind positions): `jUSDCOLD`, `jUSDD_OLD`, `jBUSDOLD`, `jSUNOLD`, `jUSDJ`, `jWBTT`.

### JustLend V2 (Moolah) — vaults

| Vault | Underlying | Mainnet | Nile |
|-------|-----------|---------|------|
| TRX   | native TRX | ✅ | ✅ |
| USDT  | TRC20 USDT | ✅ | ✅ (different underlying address from mainnet) |
| USDD  | TRC20 USDD | ✅ | ❌ (not deployed on nile) |

Markets are not enumerated here because they are created dynamically on-chain; use `get_moolah_markets` to list them at runtime (each market returns a `marketId` / `id` plus `loanSymbol` / `collateralSymbol` / `lltv` / rates).

## Prerequisites

Recommended development and CI baseline: **Node.js 24.22.1**, pinned in `.nvmrc`.

- [Node.js](https://nodejs.org/) 22.23.4+ (22.x), 24.22.1+ (24.x), or 26.12.1+
- Optional: [TronGrid API key](https://www.trongrid.io/) for reliable mainnet access (strongly recommended)

## Installation

```bash
git clone https://github.com/justlend/mcp-server-justlend.git
cd mcp-server-justlend
npm install
```

## Quick Setup

For a guided setup experience (build, configure, generate `.mcp.json`, print Codex setup command):

```bash
bash scripts/setup-mcp-test.sh
# Add --claude-desktop to also print Claude Desktop JSON
```

The script checks for a security-patched Node.js release, installs dependencies, builds the project, generates local Claude Code config, and prints the local Codex registration command.

## Configuration

### Wallet Setup (First-Use Choice)

On first use, select `agent` mode via `set_wallet_mode` with `mode="agent"`.
Browser mode is disabled until its local bridge supports request-level authentication.

The encrypted wallet is stored in `~/.agent-wallet/`. Configure `AGENT_WALLET_PASSWORD`
so its encryption password is not persisted beside the wallet data.

You can also manage wallets via **CLI** or **MCP tools**:

#### CLI (agent-wallet)
```bash
# Import an existing private key or mnemonic
npx agent-wallet add

# Generate a new wallet
npx agent-wallet generate

# List all wallets
npx agent-wallet list

# Switch active wallet
npx agent-wallet activate <wallet-id>
```

#### MCP Tools (runtime)

| Tool | Description |
|------|-------------|
| `get_wallet_address` | Shows current address, or returns first-use wallet selection guidance |
| `connect_browser_wallet` | Returns a safety notice while the unauthenticated browser bridge is disabled |
| `set_wallet_mode` | Select supported `agent` signing (`browser` currently returns an error) |
| `get_wallet_mode` | Show current signing mode and addresses |
| `list_wallets` | List all wallets with IDs, types, addresses |
| `set_active_wallet` | Switch active wallet by ID |

Importing an existing private key is intentionally not exposed as an MCP tool because MCP arguments can be logged by clients and transports. Use the CLI instead:

```bash
npx agent-wallet import
```

```bash
# (Optional) For automated/CI setups, set the wallet password
export AGENT_WALLET_PASSWORD="your_wallet_password"

# Strongly recommended — avoids TronGrid 429 rate limiting on mainnet
export TRONGRID_API_KEY="your_trongrid_api_key"
```

### Energy direct-purchase API

Direct purchase uses the official production endpoint from the app release by default:
`https://tegrow.ablesdxd.link`. Limits, durations, prices, payment address, and pool capacity are still
loaded live; no economic values are hard-coded. Set `JUSTLEND_ENERGY_API_URL` only to override the
production service. Custom/test endpoints require an explicit trust opt-in:

```bash
export JUSTLEND_ENERGY_API_URL="https://energy-api.example" # optional override
export JUSTLEND_ALLOW_UNTRUSTED_HOSTS=1 # temporary/custom endpoints only
```

Recommended tool sequence:

1. `get_energy_purchase_config` — load live limits, durations, prices, and pool capacity.
2. `quote_energy_purchase` — obtain an authoritative read-only quote.
3. Show the exact payer, receivers, duration, and TRX amount to the user.
4. `buy_energy_direct` — set `confirmPayment=true` only after explicit user confirmation.
5. `get_energy_purchase_order` — track a token-bearing result.
6. `get_energy_purchase_history` — recover accepted/in-progress orders by payer when a retry has no token.
7. `get_energy_payment_risk` — reconcile any remaining ambiguous payment before signing again.

The server signs the native TRX payment but never broadcasts it locally. The configured backend
validates and may broadcast the signed transaction. Ambiguous submissions retry only the same signed
transaction. For ambiguous submissions, the exact signed request (including the signature and raw
transaction) is stored locally with `0600` permissions under
`~/.mcp-server-justlend/energy-payment-risks.json`. It remains broadcastable until transaction expiry,
is redacted from MCP output, and is removed only after public purchase history confirms the payment/order
or the backend deterministically rejects it before broadcast. Use `get_energy_payment_risk` before any
new payment when a previous result is uncertain. Risk reconciliation reports `chainStatus` as
`observed`/`included` from FullNode first and `solidified` only after SolidityNode finality; RPC
errors or a missing transaction never authorize a newly signed payment.

### Client Configuration

Build the local server first:

```bash
npm run build
```

All local client examples below use the built stdio entrypoint:

```bash
node /absolute/path/to/mcp-server-justlend/build/index.js
```

#### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "justlend": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server-justlend/build/index.js"],
      "env": {
        "TRONGRID_API_KEY": "SET_VIA_SYSTEM_ENV"
      }
    }
  }
}
```

#### Codex

Recommended: register the local stdio server with `codex mcp add`:

```bash
codex mcp add justlend --env TRONGRID_API_KEY=your_trongrid_api_key -- \
  node /absolute/path/to/mcp-server-justlend/build/index.js
```

If you do not want to set a TronGrid key yet, omit the `--env` flag:

```bash
codex mcp add justlend -- node /absolute/path/to/mcp-server-justlend/build/index.js
```

Useful maintenance commands:

```bash
codex mcp list
codex mcp get justlend
codex mcp remove justlend
```

#### Claude Code

Add to `.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "justlend": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server-justlend/build/index.js"],
      "env": {
        "TRONGRID_API_KEY": "SET_VIA_SYSTEM_ENV"
      }
    }
  }
}
```

#### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "justlend": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server-justlend/build/index.js"],
      "env": {
        "TRONGRID_API_KEY": "SET_VIA_SYSTEM_ENV"
      }
    }
  }
}
```

## Usage

The server supports two transport modes. Both share the same Tools, Resources, and wallet initialization — the difference is how clients connect.

### Stdio Mode (Local AI Clients)

```bash
npm start
```

The server communicates via stdin/stdout. This is the standard mode for local MCP clients like **Claude Desktop**, **Codex**, **Claude Code**, and **Cursor**, which launch the server as a child process.

### HTTP/SSE Mode (Remote / Multi-Client)

```bash
MCP_API_KEY=my-secret-key npm run start:http
```

The server starts an Express HTTP service with Server-Sent Events (SSE) transport. Suitable for **web applications**, **remote clients**, or scenarios where **multiple clients** need to connect concurrently.

HTTP mode is fail-closed: `MCP_API_KEY` is required, the server binds to `127.0.0.1` by default, and CORS is disabled unless you explicitly set `MCP_CORS_ORIGIN`.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/sse` | GET | SSE connection endpoint — returns a `sessionId` |
| `/messages?sessionId=xxx` | POST | Send MCP messages for a session |
| `/health` | GET | Health check (no auth required) |

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP listen port |
| `MCP_HOST` | `127.0.0.1` | HTTP listen host. Keep the default unless you intentionally want remote exposure. |
| `MCP_API_KEY` | _(required)_ | Bearer token for authentication. HTTP mode refuses to start without it. |
| `MCP_CORS_ORIGIN` | _(disabled)_ | Allowed CORS origin. If unset, no CORS headers are sent. |
| `MCP_MAX_SESSIONS` | `100` | Maximum concurrent SSE sessions |
| `MCP_SESSION_TIMEOUT_MS` | `1800000` | Session idle timeout in ms (default: 30 min) |
| `MCP_RATE_LIMIT_PER_MIN` | `120` | Per-IP HTTP requests per minute, excluding `/health` |
| `MCP_SSE_RATE_LIMIT_PER_MIN` | `10` | Per-IP new SSE sessions per minute |

Numeric settings must be positive, safe base-10 integers (`PORT`: 1–65535).
Unset or empty values use the defaults; other invalid values stop HTTP startup
rather than silently disabling a limit. `AGENT_WALLET_PASSWORD` remains
memory-only during both wallet creation and import. Only an explicitly allowed,
auto-generated legacy password may be written to `runtime_secrets.json`.

Example with authentication:

```bash
MCP_API_KEY=my-secret-key PORT=8080 npm run start:http
```

```bash
# Connect from client
curl -H "Authorization: Bearer my-secret-key" http://localhost:8080/sse
```

### Development

```bash
npm run dev          # Stdio with auto-reload
npm run dev:http     # HTTP/SSE with auto-reload
```

## API Reference

> **Machine-readable tool catalog for AI agents:** [`mcp-api-list.md`](./mcp-api-list.md) — a complete, offline-loadable list of every tool with its input schema (parameter / type / required / default), common output schema, MCP side-effect annotations (read-only vs. on-chain write / destructive) and HITL guidance. It is **generated from source** (`npm run gen:api-list`, see [`scripts/gen-mcp-api-list.ts`](./scripts/gen-mcp-api-list.ts)) so it never drifts from the actual tool definitions. Agents can load it to plan tool routing without connecting to the server.

### Structured output contract

All 104 tools declare an MCP `outputSchema`. Successful calls preserve the existing text `content` for older clients and also return a versioned envelope in `structuredContent`:

```json
{
  "schemaVersion": "1.0.0",
  "tool": "get_supported_markets",
  "result": {}
}
```

Schema-aware clients should consume `structuredContent`; consumers should pin the schema major. Tool-specific payloads live under `result`. Error calls preserve `isError: true` and the existing JSON error body with `errorCode`, `retryable`, and `hint` when classified.

**Compatibility scope:** `schemaVersion` versions the common envelope, not every nested
API result. The generic `result` remains unconstrained for most tools. Do not assume
that an unchanged envelope version guarantees every business field; inspect the
connected tool's `outputSchema` and pin the package version for stricter consumers.
The bundled Skills server's structured error envelope is different from this full
server's JSON text errors. For unknown codes or missing `retryable`, stop a write
workflow and inspect state; `retryable: true` permits backoff for reads, not blind
replay of a possibly submitted transaction.

#### sTRX eligibility result contract

`check_strx_withdrawal_eligibility` has a field-level `result` schema (discoverable
through MCP `tools/list`, also rendered in the generated catalog):

| Fields | Meaning |
|---|---|
| `stakedAmount`, `totalIncome`, `claimableRewards`, `withdrawnAmount` | Human-readable TRX numbers, or `null` if unavailable; do not use these Number-based summaries for exact transaction arithmetic. |
| `hasStakedTrx`, `hasCompletedWithdrawals` | Boolean for known state, otherwise `null`. |
| `pendingUnstakeRounds`, `completedUnstakeRounds`, `roundDetails` | Counts / API round array; `null` when unavailable. `[]` means a known empty queue, not contract fallback. Round `endTimestamp` is Unix milliseconds. |
| `unfreezeDelayDays` | Days, or `null` if unknown. |
| `claimEligibility` | `eligible` for a known positive claimable amount, `ineligible` for a known zero, otherwise `unknown`; not a guarantee that a future transaction succeeds. |
| `source`, `dashboardSource`, `dataStatus`, `unknownFields`, `note` | Account/dashboard provenance and field completeness; preserve degradation notes. `complete` describes eligibility fields only, not all dashboard data. |

This corrects the old fallback's misleading zeros/false/empty queue. Consumers
must handle nullable fields before using the result for decisions. An unavailable
claim amount causes `claim_strx_rewards` to return `data_unavailable`,
`retryable: false`, without submission; re-read account/eligibility and obtain
confirmation before trying a known-positive claim. `unstake_strx` starts a new
unbonding round; collecting available TRX uses `claim_strx_rewards` (`claimAll`),
followed by receipt and post-state verification.

### Tools (104 total)

The full, authoritative per-tool catalog — every tool's input and output schema, side-effect class (read-only / on-chain write / destructive) and HITL guidance — lives in [`mcp-api-list.md`](./mcp-api-list.md), **generated from source** (`npm run gen:api-list`) so it never drifts. Counts by category:

| Category | Tools | Covers |
|----------|------:|--------|
| Wallet & Network | 10 | wallet selection, signing mode (browser/agent), active wallet, network |
| Market Data | 13 | per-market & protocol APY/TVL/rates (contract query + API fallback) |
| Lending Operations | 10 | supply / borrow / repay / withdraw / collateral / approve (V1 jTokens) |
| JST Voting / Governance | 10 | proposals, vote status, WJST approve / vote / withdraw |
| Energy | 15 | rental dashboard and writes; direct-purchase config, quote, history, order/risk, confirmed buy |
| sTRX Staking | 7 | sTRX dashboard & account, stake / unstake / claim / withdraw |
| WTRX Wrap / Unwrap | 2 | `wrap_trx` (TRX→WTRX 1:1) / `unwrap_trx` (WTRX→TRX 1:1) |
| JustLend V2 (Moolah) — Vaults | 6 | ERC4626 vault read + deposit / withdraw / redeem / approve |
| JustLend V2 (Moolah) — Markets | 8 | isolated markets: supply-collateral / borrow / repay / approve |
| JustLend V2 (Moolah) — Liquidation | 5 | pending liquidations, quote, liquidate, approve |
| JustLend V2 (Moolah) — Dashboard & History | 6 | portfolio, positions, dashboard & history |
| JustLend V2 (Moolah) — Mining, Rewards & Estimator | 5 | mining APY / accrual, claim, gas estimate |
| Historical Records (V1 + airdrop) — mainnet-only | 7 | transaction / vote / reward history, claimable airdrops |

Every write / destructive tool is marked `destructiveHint: true` and must be gated behind host-side human confirmation (HITL); see [`mcp-api-list.md`](./mcp-api-list.md) for the exact per-tool side-effect class.


## Architecture

```
mcp-server-justlend/
├── src/
│   ├── core/
│   │   ├── chains.ts          # Network configs + V1 jTokens + V2 Moolah addresses (mainnet + nile)
│   │   ├── abis.ts            # jToken, Comptroller, Oracle, TRC20 + 4 Moolah ABIs
│   │   ├── tools/             # MCP tool registrations (104 tools)
│   │   │   ├── index.ts                      # Barrel: registers all 13 tool modules with structured outputs
│   │   │   ├── wallet-tools.ts               # Wallet, network, transfer
│   │   │   ├── market-tools.ts               # V1 market data, balance, mining
│   │   │   ├── lending-tools.ts              # V1 supply / borrow / repay / collateral / approve / estimate
│   │   │   ├── voting-tools.ts               # V1 governance proposals & voting
│   │   │   ├── energy-tools.ts               # Energy rental + direct purchase
│   │   │   ├── staking-tools.ts              # sTRX staking
│   │   │   ├── wtrx-tools.ts                 # TRX ↔ WTRX
│   │   │   ├── moolah-vault-tools.ts         # V2 vault (6 tools)
│   │   │   ├── moolah-market-tools.ts        # V2 market (8 tools)
│   │   │   ├── moolah-liquidation-tools.ts   # V2 liquidation (5 tools)
│   │   │   ├── moolah-dashboard-tools.ts     # V2 dashboard + history + estimator (6 tools)
│   │   │   ├── moolah-mining-tools.ts        # V2 mining / rewards (5 tools)
│   │   │   ├── records-tools.ts              # V1 + airdrop records (7 tools, mainnet-only)
│   │   │   ├── structured-output.ts          # Common MCP outputSchema + structuredContent
│   │   │   └── shared.ts                     # Shared helpers
│   │   ├── prompts.ts         # AI-guided workflow prompts (14: 10 V1-era + 4 V2 Moolah)
│   │   ├── resources.ts       # Static protocol info resource
│   │   ├── browser-signer.ts  # fail-closed compatibility shim; legacy bridge disabled
│   │   └── services/
│   │       ├── # — Global + utilities —
│   │       ├── global.ts     # Global state: network, wallet mode
│   │       ├── clients.ts    # TronWeb client factory (cached)
│   │       ├── wallet.ts     # Wallet routing: browser / agent-wallet signing
│   │       ├── cache.ts      # TTL cache layer (30–60s) for prices, markets, sTRX
│   │       ├── http.ts       # fetchWithTimeout
│   │       ├── utils.ts      # toSun/fromSun, formatJson, hexToNumber, isAddress, …
│   │       ├── bigint-math.ts# BigInt helpers: divRound, formatPercentRatio, USD cent math
│   │       ├── resource-prices.ts # Energy / bandwidth prices in sun
│   │       ├── # — JustLend V1 —
│   │       ├── price.ts      # On-chain Oracle prices with API fallback
│   │       ├── markets.ts    # APY, TVL, utilization — contract + API fallback
│   │       ├── account.ts    # User positions via Multicall3 batch queries
│   │       ├── lending.ts    # V1 supply / borrow / repay / withdraw / collateral / estimator
│   │       ├── rewards.ts    # Mining reward calculation (USDD, TRX, WBTC)
│   │       ├── voting.ts     # JST governance: proposals, cast vote, deposit/withdraw WJST
│   │       ├── energy-rental.ts # Energy rental: query, calculate, rent, return
│   │       ├── energy-purchase.ts # Explicit API client, sign-only payment, idempotent submit, risk recovery
│   │       ├── strx-staking.ts  # sTRX staking: stake, unstake, rewards, withdrawal check
│   │       ├── records.ts    # V1 + cross-cutting paginated REST history + airdrop scan
│   │       ├── # — JustLend V2 (Moolah) —
│   │       ├── moolah-backend.ts    # REST wrapper for zenvora.ablesdxd.link
│   │       ├── moolah-query.ts      # On-chain view reads (market state, vault totalAssets, health, etc.)
│   │       ├── moolah-vault.ts      # Vault write ops (deposit / withdraw / redeem / approve)
│   │       ├── moolah-market.ts     # Market write ops (supply collateral / borrow / repay / composite)
│   │       ├── moolah-liquidation.ts# liquidate + approveLiquidatorToken
│   │       ├── moolah-dashboard.ts  # Aggregated dashboard + history helpers
│   │       ├── moolah-estimate.ts   # Typical energy / bandwidth for all V2 write ops
│   │       ├── # — General TRON chain —
│   │       ├── address.ts     # Hex ↔ Base58 conversion, validation
│   │       ├── balance.ts     # TRX balance (rich), TRC20/TRC1155 balances
│   │       ├── blocks.ts      # Block queries, block number, chain ID
│   │       ├── transactions.ts# getTransaction, getTransactionInfo, waitForTransaction
│   │       ├── transfer.ts    # transferTRX, transferTRC20, approveTRC20
│   │       ├── tokens.ts      # TRC20/TRC721/TRC1155 metadata
│   │       ├── contracts.ts   # readContract, writeContract, multicall, estimateEnergy + callValueToSafeNumber
│   │       ├── multicall-abi.ts # Multicall2 & Multicall3 ABIs
│   │       └── staking.ts     # Stake 2.0: freeze, unfreeze, withdrawExpireUnfreeze
│   ├── server/
│   │   ├── server.ts          # MCP server init
│   │   ├── http-server.ts     # Express HTTP/SSE transport (uses auth.ts for Bearer check)
│   │   └── auth.ts            # Constant-time Bearer-token comparison (crypto.timingSafeEqual)
│   └── index.ts               # Stdio entry point
├── bin/cli.js                 # CLI entry for npx
├── scripts/
│   └── setup-mcp-test.sh      # Quick setup: build + generate .mcp.json config
└── tests/
    └── core/
        ├── chains.test.ts
        └── services/
            ├── services.test.ts        # Client cache, legacy balance tests
            ├── address.test.ts         # Pure: address format conversion (16 tests)
            ├── utils.test.ts           # Pure: unit conversions, formatters (26 tests)
            ├── cache.test.ts           # Unit: TTL cache behavior
            ├── price.test.ts           # Unit: price service fallback logic
            ├── markets-fallback.test.ts # Unit: market data fallback chain
            ├── strx-fallback.test.ts   # Unit: sTRX dashboard fallback
            ├── account-multicall.test.ts # Unit: Multicall3 account queries
            ├── balance.test.ts         # Integration: TRX & TRC20 balances
            ├── blocks.test.ts          # Integration: block queries
            ├── contracts.test.ts       # Mixed: pure ABI helpers + integration reads
            ├── tokens.test.ts          # Integration: TRC20 token metadata
            ├── transactions.test.ts    # Integration: transaction fetch
            ├── transfer.test.ts        # Write: skipped by default (TEST_TRANSFER=1)
            ├── staking.test.ts         # Write: skipped by default (TEST_STAKING=1)
            ├── energy-rental.test.ts   # Integration: energy rental queries; Write: skipped (TEST_ENERGY_RENTAL=1)
            ├── strx-staking.test.ts    # Integration: sTRX queries; Write: skipped (TEST_STRX_STAKING=1)
            └── wallet.test.ts          # Unit: agent-wallet integration tests
```

## Testing

```bash
# Run all tests (pure/unit tests always pass; integration tests need network)
npm test

# Run individual test files (recommended to avoid TronGrid rate limits)
npx vitest run tests/core/services/utils.test.ts
npx vitest run tests/core/services/address.test.ts
npx vitest run tests/core/services/balance.test.ts
npx vitest run tests/core/services/blocks.test.ts
npx vitest run tests/core/services/contracts.test.ts
npx vitest run tests/core/services/transactions.test.ts
npx vitest run tests/core/services/tokens.test.ts

# Offline rental quote/preflight failure controls (no RPC or wallet transactions)
npx vitest run tests/core/services/energy-rental-fail-closed.test.ts

# Energy rental & sTRX staking read tests
npx vitest run tests/core/services/energy-rental.test.ts
npx vitest run tests/core/services/strx-staking.test.ts

# Enable write/staking tests (uses real funds — use Nile testnet!)
# Requires agent-wallet to be configured: npx agent-wallet start
TEST_TRANSFER=1 npx vitest run tests/core/services/transfer.test.ts
TEST_STAKING=1 npx vitest run tests/core/services/staking.test.ts
TEST_ENERGY_RENTAL=1 npx vitest run tests/core/services/energy-rental.test.ts
TEST_STRX_STAKING=1 npx vitest run tests/core/services/strx-staking.test.ts

# Moolah V2 end-to-end write-path test on nile (vault deposit/withdraw +
# market supply-collateral/borrow/repay). Requires a funded nile wallet:
# see forTest/docs/v1.1.0/nile-write-path-runbook.md for the runbook.
TEST_MOOLAH_WRITE=1 npx vitest run tests/integration/moolah-writes.nile.test.ts
```

> **Rate limiting**: Integration tests make real RPC calls to TronGrid. Without `TRONGRID_API_KEY` the free tier limits to a few requests per second. Run test files individually, or set `TRONGRID_API_KEY` to avoid 429 errors.

## Energy rental quote safety

Energy rental quotes now require successful reads of the market parameters, pause flag, usage-charge ratio, and **both** market rates. Missing, reverted, or malformed reads return an error, not fixed defaults or a rate-model substitute. The same checks run before `rent_energy` reaches the transaction sender. An unreadable rental order is not treated as an empty order, and the read-only renewal quote rejects an unknown remaining duration rather than assuming zero.

Successful quotes include `dataSources` with the network, energy conversion source (`dashboard-api` or `chain-resources`), and market-contract parameter/rate sources. API-to-chain conversion fallback is allowed only when actual global energy limit and weight reads are positive and valid; fallback dashboard metrics listed in `unavailableFields` are not observed prices or yields. These sources identify how inputs were obtained, not an atomic-block snapshot or a guarantee that an API response is fresh. Re-quote before a separate confirmed write.

Older/testnet deployments that do not expose the required quote inputs now fail closed, including Nile deployments missing `usageChargeRatio` or either market-rate getter. They are not silently assigned a 0.5 ratio or a default rate. This change does not publish a server release or alter any contract.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| MCP client doesn't list any tools (stdio) | Server not launched, or wrong command/path in client config | Verify the client `command`/`args` point to this server (`npx @justlend/mcp-server-justlend` or `tsx src/index.ts`). Check the client's MCP logs for a spawn error. |
| `429 Too Many Requests` / slow market reads on mainnet | TronGrid free-tier rate limit | Set `TRONGRID_API_KEY` (strongly recommended for mainnet). Avoid tight polling; use `get_wallet_balances`/`get_all_markets` batch tools instead of per-token loops. |
| HTTP/SSE returns `401 Unauthorized` | Missing/wrong `Authorization` header in HTTP mode | HTTP mode is fail-closed: set `MCP_API_KEY` on the server and send `Authorization: Bearer <key>` from the client. `/health` is the only unauthenticated path. |
| Server refuses to start: `MCP_API_KEY is required in HTTP mode` | HTTP/SSE transport started without an API key | Set `MCP_API_KEY` (e.g. `openssl rand -base64 32`). stdio mode does not require it. |
| `503 Too many active sessions` (HTTP) | Concurrent SSE sessions exceed `MCP_MAX_SESSIONS` (default 100) | Close idle clients or raise `MCP_MAX_SESSIONS`. Stale sessions are swept every 60s. |
| Write tool errors with "no wallet" / wallet selection guide | No wallet mode chosen yet | Run `npx agent-wallet start` or select agent mode, and configure `AGENT_WALLET_PASSWORD`. Then retry. |
| Write tool fails with a pre-flight `REVERT` on mainnet | The transaction would revert on-chain (fail-closed by design) | Read the returned revert reason; fix the precondition (e.g. call `approve_underlying` before `supply`, `enter_market` before borrowing). The server does **not** broadcast simulated-revert txs on mainnet. |
| `approval_required` returned from `supply`/`repay` | TRC20 allowance below the amount | Call `approve_underlying` first (prefer an exact amount; `max` is opt-in and grants unlimited allowance). |
| Wrong network / unexpected addresses | Active network not set as intended | Check with `get_network`; switch with `set_network` (`mainnet` / `nile`). Nile is the testnet for safe write testing. |
| Amounts look off by 6–18 orders of magnitude | Double-applying token `decimals` | Balance/amount tool outputs are **already human-readable** (decimals applied) and carry `decimals` + `_unit`; do not divide again. See `mcp-api-list.md` for each tool's output units. |

For deeper inspection, run the server under the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) and watch stderr — startup diagnostics, auth failures, and schema errors are logged there (stdout is reserved for the MCP protocol frames in stdio mode).

## Security Considerations

- **Private keys** are managed by [@bankofai/agent-wallet](https://github.com/BofAI/agent-wallet) — never stored in environment variables or exposed via MCP tools
- **Wallet encryption**: Keys are stored in `~/.agent-wallet/` with password-based encryption
- **Write operations** are clearly marked with `destructiveHint: true` in MCP annotations
- **Transaction summaries before signing**: contract write paths pass signer-facing summaries with network, contract, function, arguments, callValue, feeLimit, and simulation status
- **Address validation before signing**: transfer and approval services reject invalid recipient/token/spender addresses before contract loading or wallet signing
- **Precision-safe value handling**: sTRX staking uses string/BigInt parsing for TRX Sun conversion and 18-decimal sTRX display/estimates
- **Self-describing amounts**: balance/amount fields return human-readable values with explicit `_unit` + `decimals` (and `raw` where applicable) so agents never re-apply decimals or misjudge magnitude. New tools should build amounts with `describeAmount(raw, decimals, unit)` from `core/services/bigint-math.ts`.
- **Health factor checks** in prompts prevent dangerous borrowing
- Always **test on Nile testnet** before mainnet operations
- Be cautious with **unlimited approvals** (`approve_underlying` with `max`)

## Example Conversations

**"What are the best supply rates on JustLend right now?"**
→ AI calls `get_all_markets`, sorts by supplyAPY, presents ranking

**"I want to supply 10,000 USDT to earn interest"**
→ AI uses `supply_assets` prompt: checks balance → approves USDT → supplies → verifies

**"Am I at risk of liquidation?"**
→ AI calls `get_account_summary`, analyzes health factor, warns if < 1.5

**"Borrow 500 USDT against my TRX collateral"**
→ AI uses `borrow_assets` prompt: checks collateral → calculates new health factor → executes if safe

**"What is the TRX balance of address TXxx...?"**
→ AI calls the general-purpose TRX balance tool, returns balance in both TRX and Sun

**"Freeze 100 TRX for ENERGY"**
→ AI calls staking service to freeze via Stake 2.0, returns transaction hash

**"Show me the latest governance proposals"**
→ AI calls `get_proposal_list`, displays proposals sorted by ID with status and vote counts

**"I want to vote for proposal #425 with 1000 JST"**
→ AI checks `get_vote_info` → if no votes, suggests `approve_jst_for_voting` + `deposit_jst_for_votes` → then `cast_vote`

**"Withdraw my votes from completed proposals"**
→ AI calls `get_user_vote_status` to find withdrawable proposals → calls `withdraw_votes_from_proposal` for each

**"How much does it cost to rent 300,000 energy for 7 days?"**
→ AI calls `calculate_energy_rental_price` with energyAmount=300000, durationHours=168, returns cost breakdown

**"Rent 500,000 energy to address TXxx... for 14 days"**
→ AI uses `rent_energy` prompt: checks balance → checks rental status → calculates price → rents energy → verifies

**"Cancel my energy rental to TXxx..."**
→ AI calls `get_energy_rent_info` to verify active rental → calls `return_energy_rental` → confirms refund

**"Stake 1000 TRX to earn sTRX rewards"**
→ AI uses `stake_trx` prompt: checks balance → checks exchange rate & APY → stakes TRX → verifies sTRX received

**"Do I have any sTRX rewards to claim?"**
→ AI reads `get_strx_account` and `check_strx_withdrawal_eligibility`, then reports the result only. Unknown/null data is not zero and must not trigger a claim. A query alone never authorizes a transaction. If the user later requests a claim, refresh eligibility; for a known positive amount, show the current claimable amount, network and signer, obtain separate explicit confirmation, then call `claim_strx_rewards` and verify the receipt and post-state.

**"Can I withdraw my unstaked TRX?"**
→ AI calls `check_strx_withdrawal_eligibility` to check unbonding status and completed withdrawal rounds

**"Deposit 500 USDT into the JustLend V2 vault"** _(Moolah)_
→ AI uses `moolah_supply` prompt: lists vaults with APY → selects USDT → checks allowance → calls `approve_moolah_vault` → calls `moolah_vault_deposit` → verifies shares via `get_moolah_vault`

**"What's my risk on the TRX→USDT market?"** _(Moolah)_
→ AI calls `get_moolah_user_position` for the market, interprets the `risk` ratio (which can exceed 1); approaching 1 is a warning, not proof of liquidation eligibility. Rounded or stale API values, including 1.0, are not an execution predicate; verify current on-chain health before acting

**"Find me a liquidation opportunity"** _(Moolah)_
→ AI calls `get_moolah_pending_liquidations` with `minRiskLevel=1.0` to find candidates, not guaranteed liquidatable positions → verifies current on-chain health for the target → calls `get_moolah_liquidation_quote` (a cost estimate, not proof of borrower eligibility) → estimates profit → if eligible and viable, separately confirms `approve_liquidator_token` + `moolah_liquidate`

**"How much did I supply to JustLend in the last month?"**
→ AI calls `get_lending_records` paginated and filters action type `1` (supply) from the returned `actionName`

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md) for the per-version history (Keep a Changelog format, SemVer).

## License

MIT License Copyright (c) 2026 JustLend
SPDX-License-Identifier: MIT
