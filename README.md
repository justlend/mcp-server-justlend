# mcp-server-justlend

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![TRON Network](https://img.shields.io/badge/Network-TRON-red)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-3178C6)
![MCP](https://img.shields.io/badge/MCP-1.22.0+-blue)
![JustLend](https://img.shields.io/badge/Protocol-JustLend_DAO-green)
![npm](https://img.shields.io/badge/npm-@justlend/mcp--server--justlend-CB3837)

A Model Context Protocol (MCP) server that enables AI agents to interact with the **JustLend DAO** lending protocol on TRON. Supply assets, borrow against collateral, manage positions, and analyze DeFi portfolios — all through a unified AI interface.

Beyond JustLend-specific operations, the server also exposes a full set of **general-purpose TRON chain utilities** — balance queries, block/transaction data, token metadata, TRX transfers, smart contract reads/writes, staking (Stake 2.0), multicall, and more.

## Overview

[JustLend DAO](https://justlend.org) is the largest lending protocol on TRON, based on the Compound V2 architecture. This MCP server wraps the full protocol functionality into tools and guided prompts that local MCP clients such as Claude Desktop, Codex, Claude Code, and Cursor can use.

**📌 Current Version: JustLend V1**

This MCP server currently supports **JustLend V1** protocol. All contract addresses, ABIs, calculation functions, and lending operations are for V1.

### Key Capabilities

#### JustLend Protocol
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

#### Browser Wallet Signing
- **TronLink Integration**: Connect TronLink (and other TIP-6963 browser wallets) via the `tronlink-signer` SDK
- **Sign-only mode**: Server builds transactions, browser only signs — private keys never leave the wallet
- **Dual wallet mode**: Users choose between `browser` (recommended) or `agent` (encrypted local storage)

#### General TRON Chain
- **Balances**: TRX balance (with Sun/TRX conversion), TRC20/TRC1155 token balances
- **Blocks**: Latest block, block by number/hash, block number, chain ID
- **Transactions**: Fetch transaction details, receipts, wait for confirmation
- **Contracts**: Read/write any contract, fetch on-chain ABI, multicall (v2 & v3), deploy, estimate energy
- **Token Metadata**: TRC20 info (name/symbol/decimals/supply), TRC721 metadata, TRC1155 URI
- **Transfers**: Send TRX, transfer TRC20 tokens, approve spenders
- **Staking (Stake 2.0)**: Freeze/unfreeze TRX for BANDWIDTH or ENERGY, withdraw expired unfreeze
- **Address Utilities**: Hex ↔ Base58 conversion, address validation, resolution
- **Wallet**: Sign messages, secure key management via agent-wallet or browser wallet

## Supported Markets

| jToken | Underlying | Description |
|--------|-----------|-------------|
| jTRX   | TRX       | Native TRON token |
| jUSDT  | USDT      | Tether USD |
| jUSDC  | USDC      | USD Coin |
| jBTC   | BTC       | Bitcoin (wrapped) |
| jETH   | ETH       | Ethereum (wrapped) |
| jSUN   | SUN       | SUN token |
| jWIN   | WIN       | WINkLink |
| jTUSD  | TUSD      | TrueUSD |

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

### Tools (59 total)

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
| `stake_trx_to_strx` | Stake TRX to receive sTRX (with balance check) | **Yes** |
| `unstake_strx` | Unstake sTRX to receive TRX back (with balance check) | **Yes** |
| `claim_strx_rewards` | Claim all staking rewards (with rewards existence check) | **Yes** |

#### Transfers
| Tool | Description | Write? |
|------|-------------|--------|
| `transfer_trx` | Transfer TRX to another address (with balance check) | **Yes** |
| `transfer_trc20` | Transfer TRC20 tokens by symbol or contract address | **Yes** |

### Prompts (AI-Guided Workflows)

| Prompt | Description |
|--------|-------------|
| `getting_started` | First-time onboarding: wallet setup, connection, feature tour |
| `supply_assets` | Step-by-step supply with balance checks and approval |
| `borrow_assets` | Safe borrowing with risk assessment and health factor checks |
| `repay_borrow` | Guided repayment with verification |
| `analyze_portfolio` | Comprehensive portfolio analysis with risk scoring |
| `compare_markets` | Find best supply/borrow opportunities |
| `rent_energy` | Guided energy rental with price estimation and balance checks |
| `stake_trx` | Guided TRX staking to sTRX with APY info and verification |
| `query_proposals` | Browse and query governance proposals, check voting requirements |
| `cast_vote` | Guided governance voting with vote verification |

## Architecture

```
mcp-server-justlend/
├── src/
│   ├── core/
│   │   ├── chains.ts          # Network configs + JustLend contract addresses
│   │   ├── abis.ts            # jToken, Comptroller, Oracle, TRC20 ABIs
│   │   ├── tools/             # MCP tool registrations (59 tools)
│   │   │   ├── index.ts           # Barrel export
│   │   │   ├── wallet-tools.ts    # Wallet, network, transfer tools
│   │   │   ├── market-tools.ts    # Market data, balance, mining tools
│   │   │   ├── lending-tools.ts   # Supply, borrow, repay, collateral tools
│   │   │   ├── voting-tools.ts    # Governance proposal & voting tools
│   │   │   ├── energy-tools.ts    # Energy rental tools
│   │   │   ├── staking-tools.ts   # sTRX staking tools
│   │   │   └── shared.ts         # Shared helpers
│   │   ├── prompts.ts         # AI-guided workflow prompts
│   │   ├── resources.ts       # Static protocol info resource
│   │   ├── browser-signer.ts  # tronlink-signer SDK adapter (TronWalletSigner wrapper)
│   │   └── services/
│   │       ├── # — JustLend-specific —
│   │       ├── global.ts     # Global state: network, wallet mode
│   │       ├── clients.ts    # TronWeb client factory (cached)
│   │       ├── wallet.ts     # Wallet routing: browser / agent-wallet signing
│   │       ├── cache.ts      # TTL cache layer (30–60s) for prices, markets, sTRX
│   │       ├── price.ts      # On-chain Oracle prices with API fallback
│   │       ├── markets.ts    # APY, TVL, utilization — contract + API fallback
│   │       ├── account.ts    # User positions via Multicall3 batch queries
│   │       ├── lending.ts    # supply, borrow, repay, withdraw, collateral
│   │       ├── rewards.ts    # Mining reward calculation (USDD, TRX, WBTC)
│   │       ├── voting.ts     # JST governance: proposals, cast vote, deposit/withdraw WJST
│   │       ├── energy-rental.ts # Energy rental: query, calculate, rent, return
│   │       ├── strx-staking.ts  # sTRX staking: stake, unstake, rewards, withdrawal check
│   │       ├── # — General TRON chain —
│   │       ├── address.ts     # Hex ↔ Base58 conversion, validation
│   │       ├── balance.ts     # TRX balance (rich), TRC20/TRC1155 balances
│   │       ├── blocks.ts      # Block queries, block number, chain ID
│   │       ├── transactions.ts# getTransaction, getTransactionInfo, waitForTransaction
│   │       ├── transfer.ts    # transferTRX, transferTRC20, approveTRC20
│   │       ├── tokens.ts      # TRC20/TRC721/TRC1155 metadata
│   │       ├── contracts.ts   # readContract, writeContract, multicall, deploy, estimateEnergy
│   │       ├── multicall-abi.ts # Multicall2 & Multicall3 ABIs
│   │       ├── staking.ts     # Stake 2.0: freeze, unfreeze, withdrawExpireUnfreeze
│   │       └── utils.ts       # toSun/fromSun, formatJson, hexToNumber, isAddress, …
│   ├── server/
│   │   ├── server.ts          # MCP server init
│   │   └── http-server.ts     # Express HTTP/SSE transport
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
```

> **Rate limiting**: Integration tests make real RPC calls to TronGrid. Without `TRONGRID_API_KEY` the free tier limits to a few requests per second. Run test files individually, or set `TRONGRID_API_KEY` to avoid 429 errors.

## Security Considerations

- **Private keys** are managed by [@bankofai/agent-wallet](https://github.com/BofAI/agent-wallet) — never stored in environment variables or exposed via MCP tools
- **Wallet encryption**: Keys are stored in `~/.agent-wallet/` with password-based encryption
- **Write operations** are clearly marked with `destructiveHint: true` in MCP annotations
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

## License

MIT License Copyright (c) 2026 JustLend
