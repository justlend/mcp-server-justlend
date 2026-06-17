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

**📌 Current Version: v1.1.0 — supports both JustLend V1 and JustLend V2 (Moolah)**

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
- **Energy Rental**: Rent energy from JustLend, calculate rental prices, query rental orders, return/cancel rentals
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
- **TronLink Integration**: Connect TronLink (and other TIP-6963 browser wallets) via the `tronlink-signer` SDK
- **Sign-only mode**: Server builds transactions, browser only signs — private keys never leave the wallet
- **Confirmable transaction summaries**: Contract writes pass a deterministic summary (network, contract, function, args, callValue, feeLimit, simulation status) to the signer
- **Dual wallet mode**: Users choose between `browser` (recommended) or `agent` (encrypted local storage)

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
- **Wallet**: Sign messages, secure key management via agent-wallet or browser wallet

## Supported Markets

### JustLend V1 (pool-based)

The protocol currently exposes **17 active + 6 paused legacy = 23 markets**. Call `get_supported_markets` for the live list with addresses; the active markets are:

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

Paused / legacy markets (closed to new supply/borrow, queryable for read & to unwind positions): `jUSDCOLD`, `jUSDD_OLD`, `jBUSDOLD`, `jSUNOLD`, `jUSDJ`, `jWBTT`.

### JustLend V2 (Moolah) — vaults

| Vault | Underlying | Mainnet | Nile |
|-------|-----------|---------|------|
| TRX   | native TRX | ✅ | ✅ |
| USDT  | TRC20 USDT | ✅ | ✅ (different underlying address from mainnet) |
| USDD  | TRC20 USDD | ✅ | ❌ (not deployed on nile) |

Markets are not enumerated here because they are created dynamically on-chain; use `get_moolah_markets` to list them at runtime (each market returns a `marketId` / `id` plus `loanSymbol` / `collateralSymbol` / `lltv` / rates).

## Prerequisites

- [Node.js](https://nodejs.org/) 20.0.0 or higher
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

The script checks Node.js 20+, installs dependencies, builds the project, generates local Claude Code config, and prints the local Codex registration command.

## Configuration

### Wallet Setup (First-Use Choice)

On first use, the server does **not** force a wallet choice. Users can explicitly choose between:

1. `browser` mode via TronLink using `connect_browser_wallet`
2. `agent` mode via encrypted local wallet using `set_wallet_mode` with `mode="agent"`

Private keys are **never** stored in environment variables by default. If the user selects `agent` mode, the encrypted wallet is stored in `~/.agent-wallet/`.

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
| `connect_browser_wallet` | Connect TronLink / browser wallet for signing |
| `set_wallet_mode` | Switch between `browser` and `agent` signing |
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

> **Machine-readable tool catalog for AI agents:** [`mcp-api-list.md`](./mcp-api-list.md) — a complete, offline-loadable list of every tool with its input schema (parameter / type / required / default), MCP side-effect annotations (read-only vs. on-chain write / destructive) and HITL guidance. It is **generated from source** (`npm run gen:api-list`, see [`scripts/gen-mcp-api-list.ts`](./scripts/gen-mcp-api-list.ts)) so it never drifts from the actual tool definitions. Agents can load it to plan tool routing without connecting to the server.

### Tools (96 total)

Numbers by category: V1 base 59 · JustLend V2 (Moolah) 30 · historical records 7. See [`mcp-api-list.md`](./mcp-api-list.md) (generated from source) for the authoritative per-tool catalog.

#### Wallet & Network
| Tool | Description | Write? |
|------|-------------|--------|
| `get_wallet_address` | Show wallet address or first-use wallet selection guidance | No |
| `connect_browser_wallet` | Connect TronLink / browser wallet for signing | Yes |
| `set_wallet_mode` | Switch between `browser` and `agent` signing | Yes |
| `get_wallet_mode` | Show current signing mode and addresses | No |
| `list_wallets` | List all wallets (IDs, types, addresses) | No |
| `set_active_wallet` | Switch active wallet by wallet ID | No |
| `get_supported_networks` | List available networks | No |
| `get_supported_markets` | List all jToken markets with addresses | No |
| `set_network` | Set global default network (mainnet, nile) | Yes |
| `get_network` | Get current global default network | No |

#### Market Data
| Tool | Description | Write? |
|------|-------------|--------|
| `get_market_data` | Detailed data for one market (APY, TVL, rates) — contract + API fallback | No |
| `get_all_markets` | Overview of all markets — contract + API fallback | No |
| `get_protocol_summary` | Comptroller config & protocol parameters — contract query | No |

#### Account & Balances
| Tool | Description | Write? |
|------|-------------|--------|
| `get_account_summary` | Full position: supplies, borrows, health factor — Multicall3 batch | No |
| `check_allowance` | Check TRC20 approval for jToken | No |
| `get_trx_balance` | TRX balance | No |
| `get_token_balance` | TRC20 token balance | No |
| `get_wallet_balances` | Batch-fetch TRC20 balances across multiple markets via Multicall3 | No |

#### Lending Operations
| Tool | Description | Write? |
|------|-------------|--------|
| `supply` | Deposit assets to earn interest | **Yes** |
| `withdraw` | Withdraw supplied assets | **Yes** |
| `withdraw_all` | Withdraw all from a market | **Yes** |
| `borrow` | Borrow against collateral | **Yes** |
| `repay` | Repay outstanding borrows | **Yes** |
| `enter_market` | Enable market as collateral | **Yes** |
| `exit_market` | Disable market as collateral | **Yes** |
| `approve_underlying` | Approve TRC20 for jToken | **Yes** |
| `claim_rewards` | Claim mining rewards | **Yes** |
| `estimate_lending_energy` | Estimate energy/bandwidth/TRX cost for any lending operation | No |

#### Mining & Rewards
| Tool | Description | Write? |
|------|-------------|--------|
| `get_mining_rewards` | Unclaimed mining rewards, APY, and reward breakdown | No |
| `get_usdd_mining_config` | USDD mining periods, reward tokens, and schedule | No |
| `get_wbtc_mining_config` | WBTC supply mining configuration and activity details | No |

#### JST Voting / Governance
| Tool | Description | Write? |
|------|-------------|--------|
| `get_proposal_list` | List all governance proposals with status and vote counts | No |
| `get_user_vote_status` | User's voting history: voted proposals, withdrawable votes | No |
| `get_vote_info` | Voting power: JST balance, available votes, locked votes | No |
| `get_locked_votes` | Votes locked in a specific proposal | No |
| `check_jst_allowance_for_voting` | Check JST approval for WJST voting contract | No |
| `approve_jst_for_voting` | Approve JST for the WJST voting contract | **Yes** |
| `deposit_jst_for_votes` | Deposit JST to get voting power (1 JST = 1 Vote) | **Yes** |
| `withdraw_votes_to_jst` | Withdraw WJST back to JST | **Yes** |
| `cast_vote` | Cast for/against votes on a proposal | **Yes** |
| `withdraw_votes_from_proposal` | Reclaim votes from completed proposals | **Yes** |

#### Energy Rental
| Tool | Description | Write? |
|------|-------------|--------|
| `get_energy_rental_dashboard` | Market data: TRX price, exchange rate, APY, energy per TRX | No |
| `get_energy_rental_params` | On-chain params: fees, limits, pause status, usage charge ratio | No |
| `calculate_energy_rental_price` | Estimate cost for renting energy (prepayment, deposit, daily cost) | No |
| `get_energy_rental_rate` | Current rental rate for a given TRX amount | No |
| `get_user_energy_rental_orders` | User's rental orders (as renter, receiver, or all) | No |
| `get_energy_rent_info` | On-chain rental info for a renter-receiver pair | No |
| `get_return_rental_info` | Return/cancel estimation (refund, remaining rent, daily cost) | No |
| `rent_energy` | Rent energy for a receiver (with balance, pause, limit checks) | **Yes** |
| `return_energy_rental` | Cancel an active rental (with active order check) | **Yes** |

#### sTRX Staking
| Tool | Description | Write? |
|------|-------------|--------|
| `get_strx_dashboard` | Staking market data: exchange rate, APY, total supply | No |
| `get_strx_account` | User staking account: staked amount, income, rewards | No |
| `get_strx_balance` | sTRX token balance for an address | No |
| `check_strx_withdrawal_eligibility` | Check unbonding status, pending/completed withdrawal rounds | No |
| `stake_trx_to_strx` | Stake TRX to receive sTRX with precision-safe string amount parsing (with balance check) | **Yes** |
| `unstake_strx` | Unstake sTRX to receive TRX back (with balance check) | **Yes** |
| `claim_strx_rewards` | Claim all staking rewards (with rewards existence check) | **Yes** |

#### Transfers
| Tool | Description | Write? |
|------|-------------|--------|
| `transfer_trx` | Transfer TRX to another address (with balance check) | **Yes** |
| `transfer_trc20` | Transfer TRC20 tokens by symbol or contract address; validates token and recipient addresses before signing | **Yes** |

#### JustLend V2 (Moolah) — Vaults
| Tool | Description | Write? |
|------|-------------|--------|
| `get_moolah_vaults` | List all Moolah vaults with APY / TVL | No |
| `get_moolah_vault` | Single vault details + allocation + user position (if address provided) | No |
| `approve_moolah_vault` | Approve underlying TRC20 for a vault (not needed for TRX vault) | **Yes** |
| `moolah_vault_deposit` | Deposit into an ERC4626 vault | **Yes** |
| `moolah_vault_withdraw` | Withdraw by underlying amount; `"max"` supported | **Yes** |
| `moolah_vault_redeem` | Redeem by share amount; `"max"` supported | **Yes** |

#### JustLend V2 (Moolah) — Markets
| Tool | Description | Write? |
|------|-------------|--------|
| `get_moolah_markets` | List all Moolah markets with borrow/supply APY, LLTV, liquidity | No |
| `get_moolah_market` | Single market details + supplying vaults | No |
| `get_moolah_user_position` | User position in a market: collateral, borrow, `risk` (0–1 ratio) | No |
| `approve_moolah_proxy` | Approve TRC20 for MoolahProxy (collateral or loan token) | **Yes** |
| `moolah_supply_collateral` | Supply collateral to a market (TRX → TrxProviderProxy; TRC20 → MoolahProxy) | **Yes** |
| `moolah_withdraw_collateral` | Withdraw collateral; `"max"` supported (only when no active borrows) | **Yes** |
| `moolah_borrow` | Borrow; accepts `collateralAmount` only, `borrowAmount` only, or both (composite) | **Yes** |
| `moolah_repay` | Repay by amount; `"max"` uses shares path for exact settlement | **Yes** |

#### JustLend V2 (Moolah) — Liquidation
| Tool | Description | Write? |
|------|-------------|--------|
| `get_moolah_pending_liquidations` | List positions eligible for liquidation (filter by risk / debt / collateral) | No |
| `get_moolah_liquidation_quote` | Quote loan-token required for a target seizedAssets OR repaidShares | No |
| `get_moolah_liquidation_records` | Historical V2 liquidations | No |
| `approve_liquidator_token` | Approve loan token for PublicLiquidatorProxy | **Yes** |
| `moolah_liquidate` | Execute a liquidation (seizedAssets OR repaidShares, not both) | **Yes** |

#### JustLend V2 (Moolah) — Dashboard, History & Estimation
| Tool | Description | Write? |
|------|-------------|--------|
| `get_moolah_dashboard` | Aggregated V2 position (vaults + markets + totals) for a user | No |
| `get_moolah_history` | V2 position curves + recent transactions for a user | No |
| `get_moolah_records` | Paginated V2 transaction records | No |
| `get_moolah_vault_history` | Time series of a vault's APY / TVL / mining APY | No |
| `get_moolah_market_history` | Time series of a market's borrow/supply APY + utilization | No |
| `estimate_moolah_energy` | Typical energy / bandwidth / TRX cost for any Moolah write op (TRX vs TRC20 routes) | No |

#### Historical Records (V1 + airdrop) — mainnet-only
| Tool | Description | Write? |
|------|-------------|--------|
| `get_lending_records` | V1 supply / withdraw / borrow / repay / collateral history | No |
| `get_strx_records` | sTRX stake / unstake / withdraw history | No |
| `get_vote_records` | Governance voting history (distinct from real-time `get_user_vote_status`) | No |
| `get_energy_rental_records` | Energy rental action history (distinct from on-chain `get_user_energy_rental_orders`) | No |
| `get_liquidation_records` | V1 liquidation history (distinct from V2 `get_moolah_liquidation_records`) | No |
| `get_claimable_rewards` | Scan all JustLend merkle airdrop distributors for unclaimed rewards (read-only) | No |

### Prompts (AI-Guided Workflows)

| Prompt | Description |
|--------|-------------|
| `getting_started` | First-time onboarding: wallet setup, connection, feature tour |
| `supply_assets` | Step-by-step V1 supply with balance checks and approval |
| `borrow_assets` | Safe V1 borrowing with risk assessment and health factor checks |
| `repay_borrow` | Guided V1 repayment with verification |
| `analyze_portfolio` | Comprehensive portfolio analysis with risk scoring |
| `compare_markets` | Find best supply/borrow opportunities |
| `rent_energy` | Guided energy rental with price estimation and balance checks |
| `stake_trx` | Guided TRX staking to sTRX with APY info and verification |
| `query_proposals` | Browse and query governance proposals, check voting requirements |
| `cast_vote` | Guided governance voting with vote verification |
| `moolah_supply` | **(V2)** Deposit into a Moolah ERC4626 vault with approval flow and APY comparison |
| `moolah_borrow` | **(V2)** Isolated-market borrow workflow with the `risk` threshold table |
| `moolah_liquidate` | **(V2)** Find and execute public liquidations; loan-token requirement + approval steps |
| `moolah_portfolio` | **(V2)** Full V2 portfolio overview with per-market risk assessment |

## Architecture

```
mcp-server-justlend/
├── src/
│   ├── core/
│   │   ├── chains.ts          # Network configs + V1 jTokens + V2 Moolah addresses (mainnet + nile)
│   │   ├── abis.ts            # jToken, Comptroller, Oracle, TRC20 + 4 Moolah ABIs
│   │   ├── tools/             # MCP tool registrations (90 tools)
│   │   │   ├── index.ts                      # Barrel: registers all 10 tool modules
│   │   │   ├── wallet-tools.ts               # Wallet, network, transfer
│   │   │   ├── market-tools.ts               # V1 market data, balance, mining
│   │   │   ├── lending-tools.ts              # V1 supply / borrow / repay / collateral / approve / estimate
│   │   │   ├── voting-tools.ts               # V1 governance proposals & voting
│   │   │   ├── energy-tools.ts               # Energy rental
│   │   │   ├── staking-tools.ts              # sTRX staking
│   │   │   ├── moolah-vault-tools.ts         # V2 vault (6 tools)
│   │   │   ├── moolah-market-tools.ts        # V2 market (8 tools)
│   │   │   ├── moolah-liquidation-tools.ts   # V2 liquidation (5 tools)
│   │   │   ├── moolah-dashboard-tools.ts     # V2 dashboard + history + estimator (6 tools)
│   │   │   ├── records-tools.ts              # V1 + airdrop records (6 tools, mainnet-only)
│   │   │   └── shared.ts                     # Shared helpers
│   │   ├── prompts.ts         # AI-guided workflow prompts (14: 10 V1-era + 4 V2 Moolah)
│   │   ├── resources.ts       # Static protocol info resource
│   │   ├── browser-signer.ts  # tronlink-signer SDK adapter (TronWalletSigner wrapper)
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

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| MCP client doesn't list any tools (stdio) | Server not launched, or wrong command/path in client config | Verify the client `command`/`args` point to this server (`npx @justlend/mcp-server-justlend` or `tsx src/index.ts`). Check the client's MCP logs for a spawn error. |
| `429 Too Many Requests` / slow market reads on mainnet | TronGrid free-tier rate limit | Set `TRONGRID_API_KEY` (strongly recommended for mainnet). Avoid tight polling; use `get_wallet_balances`/`get_all_markets` batch tools instead of per-token loops. |
| HTTP/SSE returns `401 Unauthorized` | Missing/wrong `Authorization` header in HTTP mode | HTTP mode is fail-closed: set `MCP_API_KEY` on the server and send `Authorization: Bearer <key>` from the client. `/health` is the only unauthenticated path. |
| Server refuses to start: `MCP_API_KEY is required in HTTP mode` | HTTP/SSE transport started without an API key | Set `MCP_API_KEY` (e.g. `openssl rand -base64 32`). stdio mode does not require it. |
| `503 Too many active sessions` (HTTP) | Concurrent SSE sessions exceed `MCP_MAX_SESSIONS` (default 100) | Close idle clients or raise `MCP_MAX_SESSIONS`. Stale sessions are swept every 60s. |
| Write tool errors with "no wallet" / wallet selection guide | No wallet mode chosen yet | Run `npx agent-wallet start` (agent mode), or call `connect_browser_wallet` (browser mode). Then retry. |
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
→ AI calls `get_strx_account` to check claimable rewards → calls `claim_strx_rewards` if available

**"Can I withdraw my unstaked TRX?"**
→ AI calls `check_strx_withdrawal_eligibility` to check unbonding status and completed withdrawal rounds

**"Deposit 500 USDT into the JustLend V2 vault"** _(Moolah)_
→ AI uses `moolah_supply` prompt: lists vaults with APY → selects USDT → checks allowance → calls `approve_moolah_vault` → calls `moolah_vault_deposit` → verifies shares via `get_moolah_vault`

**"What's my risk on the TRX→USDT market?"** _(Moolah)_
→ AI calls `get_moolah_user_position` for the market, interprets the `risk` ratio (0–1 where 1.0 = liquidatable), warns at `>0.85`

**"Find me a liquidation opportunity"** _(Moolah)_
→ AI calls `get_moolah_pending_liquidations` with `minRiskLevel=1.0` → for a target, calls `get_moolah_liquidation_quote` → estimates profit → if viable, guides through `approve_liquidator_token` + `moolah_liquidate`

**"How much did I supply to JustLend in the last month?"**
→ AI calls `get_lending_records` paginated and filters action type `1` (supply) from the returned `actionName`

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md) for the per-version history (Keep a Changelog format, SemVer).

## License

MIT License Copyright (c) 2026 JustLend
SPDX-License-Identifier: MIT
