# mcp-server-justlend

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![TRON Network](https://img.shields.io/badge/Network-TRON-red)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-3178C6)
![MCP](https://img.shields.io/badge/MCP-1.22.0+-blue)
![JustLend](https://img.shields.io/badge/Protocol-JustLend_DAO-green)
![npm](https://img.shields.io/badge/npm-mcp--server--justlend-CB3837)

A Model Context Protocol (MCP) server that enables AI agents to interact with the **JustLend DAO** lending protocol on TRON. Supply assets, borrow against collateral, manage positions, and analyze DeFi portfolios — all through a unified AI interface.

Beyond JustLend-specific operations, the server also exposes a full set of **general-purpose TRON chain utilities** — balance queries, block/transaction data, token metadata, TRX transfers, smart contract reads/writes, staking (Stake 2.0), multicall, and more.

## Overview

[JustLend DAO](https://justlend.org) is the largest lending protocol on TRON, based on the Compound V2 architecture. This MCP server wraps the full protocol functionality into tools and guided prompts that AI agents (Claude Desktop, Cursor, etc.) can use.

**📌 Current Version: JustLend V1**

This MCP server currently supports **JustLend V1** protocol. All contract addresses, ABIs, calculation functions, and lending operations are for V1.

### Key Capabilities

#### JustLend Protocol
- **Market Data**: Real-time APYs, TVL, utilization rates, prices for all markets
  - Direct contract queries for on-chain accuracy
  - API-based queries for comprehensive market data (more stable, includes historical data and mining rewards)
- **Account Data**: Full position analysis with API support
  - Contract-based: Health factor, collateral, borrow positions
  - API-based: Enhanced data with mining rewards, historical trends, risk metrics
- **Mining Rewards**: Advanced mining reward calculation (based on justlend-app logic)
  - Detailed breakdown by market and reward token (USDD, TRX, WBTC, etc.)
  - Separates new period vs. last period rewards
  - USD value calculation with live token prices
  - Mining status tracking (ongoing/paused/ended) and period end times
- **Supply**: Deposit TRX or TRC20 tokens to earn interest (mint jTokens)
- **Borrow**: Borrow assets against your collateral with health factor monitoring
- **Repay**: Repay outstanding borrows with full or partial amounts
- **Withdraw**: Redeem jTokens back to underlying assets
- **Collateral Management**: Enter/exit markets, manage what counts as collateral
- **Portfolio Analysis**: AI-guided risk assessment, health factor monitoring, optimization
- **Token Approvals**: Manage TRC20 approvals for jToken contracts

#### General TRON Chain
- **Balances**: TRX balance (with Sun/TRX conversion), TRC20/TRC1155 token balances
- **Blocks**: Latest block, block by number/hash, block number, chain ID
- **Transactions**: Fetch transaction details, receipts, wait for confirmation
- **Contracts**: Read/write any contract, fetch on-chain ABI, multicall (v2 & v3), deploy, estimate energy
- **Token Metadata**: TRC20 info (name/symbol/decimals/supply), TRC721 metadata, TRC1155 URI
- **Transfers**: Send TRX, transfer TRC20 tokens, approve spenders
- **Staking (Stake 2.0)**: Freeze/unfreeze TRX for BANDWIDTH or ENERGY, withdraw expired unfreeze
- **Address Utilities**: Hex ↔ Base58 conversion, address validation, resolution
- **Wallet**: Sign messages, sign typed data (EIP-712), HD wallet derivation from mnemonic

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
git clone https://github.com/your-org/mcp-server-justlend.git
cd mcp-server-justlend
npm install
```

## Configuration

### Environment Variables

> **SECURITY**: Never save private keys in config files. Use environment variables.

```bash
# Required for write operations (supply, borrow, transfer, stake, etc.)
export TRON_PRIVATE_KEY="your_private_key_hex"
# OR use a mnemonic phrase
export TRON_MNEMONIC="word1 word2 ... word12"
export TRON_ACCOUNT_INDEX="0"   # Optional HD wallet account index, default: 0

# Strongly recommended — avoids TronGrid 429 rate limiting on mainnet
export TRONGRID_API_KEY="your_trongrid_api_key"
```

### Client Configuration

#### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "justlend": {
      "command": "npx",
      "args": ["tsx", "mcp-server-justlend"],
      "env": {
        "TRONGRID_API_KEY": "your_key"
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
      "command": "npx",
      "args": ["tsx", "mcp-server-justlend"]
    }
  }
}
```

## Usage

```bash
# Stdio mode (for MCP clients)
npm start

# HTTP/SSE mode (for remote clients)
npm run start:http

# Development with auto-reload
npm run dev
```

## API Reference

### Tools (24 total)

#### Wallet & Network
| Tool | Description | Write? |
|------|-------------|--------|
| `get_wallet_address` | Show configured wallet address | No |
| `get_supported_networks` | List available networks | No |
| `get_supported_markets` | List all jToken markets with addresses | No |

#### Market Data
| Tool | Description | Write? |
|------|-------------|--------|
| `get_market_data` | Detailed data for one market (APY, TVL, rates) - Contract query | No |
| `get_all_markets` | Overview of all markets - Contract query | No |
| `get_protocol_summary` | Comptroller config & protocol parameters - Contract query | No |
| `get_markets_from_api` | **[API]** All market data with mining rewards & trends | No |
| `get_dashboard_from_api` | **[API]** Protocol-level statistics (TVL, users, etc.) | No |
| `get_jtoken_details_from_api` | **[API]** Detailed jToken info with interest rate model | No |

#### Account & Balances
| Tool | Description | Write? |
|------|-------------|--------|
| `get_account_summary` | Full position: supplies, borrows, health factor - Contract query | No |
| `get_account_data_from_api` | **[API]** Enhanced account data with mining rewards & trends | No |
| `check_allowance` | Check TRC20 approval for jToken | No |
| `get_trx_balance` | TRX balance | No |
| `get_token_balance` | TRC20 token balance | No |

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

### Prompts (AI-Guided Workflows)

| Prompt | Description |
|--------|-------------|
| `supply_assets` | Step-by-step supply with balance checks and approval |
| `borrow_assets` | Safe borrowing with risk assessment and health factor checks |
| `repay_borrow` | Guided repayment with verification |
| `analyze_portfolio` | Comprehensive portfolio analysis with risk scoring |
| `compare_markets` | Find best supply/borrow opportunities |

## Architecture

```
mcp-server-justlend/
├── src/
│   ├── core/
│   │   ├── chains.ts          # Network configs + JustLend contract addresses
│   │   ├── abis.ts            # jToken, Comptroller, Oracle, TRC20 ABIs
│   │   ├── tools.ts           # MCP tool registrations
│   │   ├── prompts.ts         # AI-guided workflow prompts
│   │   ├── resources.ts       # Static protocol info resource
│   │   └── services/
│   │       ├── # — JustLend-specific —
│   │       ├── clients.ts     # TronWeb client factory (cached)
│   │       ├── wallet.ts      # Key/mnemonic management, signMessage, signTypedData
│   │       ├── markets.ts     # APY, TVL, utilization, prices
│   │       ├── account.ts     # User positions, liquidity, allowances
│   │       ├── lending.ts     # supply, borrow, repay, withdraw, collateral
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
└── tests/
    └── core/
        ├── chains.test.ts
        └── services/
            ├── services.test.ts    # Client cache, legacy balance tests
            ├── address.test.ts     # Pure: address format conversion (16 tests)
            ├── utils.test.ts       # Pure: unit conversions, formatters (26 tests)
            ├── balance.test.ts     # Integration: TRX & TRC20 balances
            ├── blocks.test.ts      # Integration: block queries
            ├── contracts.test.ts   # Mixed: pure ABI helpers + integration reads
            ├── tokens.test.ts      # Integration: TRC20 token metadata
            ├── transactions.test.ts# Integration: transaction fetch
            ├── transfer.test.ts    # Write: skipped by default (TEST_TRANSFER=1)
            ├── staking.test.ts     # Write: skipped by default (TEST_STAKING=1)
            └── wallet.test.ts      # Unit: skipped without TRON_PRIVATE_KEY
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

# Enable write/staking tests (uses real funds — use Nile testnet!)
TRON_PRIVATE_KEY=xxx TEST_TRANSFER=1 npx vitest run tests/core/services/transfer.test.ts
TRON_PRIVATE_KEY=xxx TEST_STAKING=1 npx vitest run tests/core/services/staking.test.ts
```

> **Rate limiting**: Integration tests make real RPC calls to TronGrid. Without `TRONGRID_API_KEY` the free tier limits to a few requests per second. Run test files individually, or set `TRONGRID_API_KEY` to avoid 429 errors.

## Security Considerations

- **Private keys** are read from environment variables only, never exposed via MCP tools
- **Write operations** are clearly marked with `destructiveHint: true` in MCP annotations
- **Health factor checks** in prompts prevent dangerous borrowing
- Always **test on Nile testnet** before mainnet operations
- Be cautious with **unlimited approvals** (`approve_underlying` with `max`)
- **Never share** your `claude_desktop_config.json` if it contains keys

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

## License

MIT
