# JustLend MCP Server

This Skill provides a complete setup and usage guide for the JustLend Model Context Protocol (MCP) Server. It enables local AI Agents (Claude Desktop, Cursor, Claude Code) to seamlessly interact with the JustLend DAO protocol on the TRON network, retrieve market data, check user positions, and execute DeFi operations like supply, borrow, and stake.

## Prerequisites
- **Node.js**: v20 or higher (as specified in package.json)
- **pnpm, npm, or yarn**: For dependency management
- **TRON API Key**: Obtain from [TronGrid](https://www.trongrid.io/)
- **TRON Wallet**: Private key or Mnemonic (required for write operations)

## Installation
Clone and build the MCP server locally:
```bash
git clone https://github.com/justlend/mcp-server-justlend.git
cd mcp-server-justlend
npm install
npm run build
```

## Client Configuration
Add the server to your local AI client's configuration file.

### For Claude Desktop
Edit your configuration file:
- **Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "justlend": {
      "command": "node",
      "args": ["/ABSOLUTE_PATH_TO/mcp-server-justlend/build/index.js"],
      "env": {
        "TRONGRID_API_KEY": "your_trongrid_api_key_here",
        "TRON_PRIVATE_KEY": "your_private_key_here",
        "NETWORK": "mainnet"
      }
    }
  }
}
```

> [!TIP]
> You can also use `TRON_MNEMONIC` and `TRON_ACCOUNT_INDEX` instead of `TRON_PRIVATE_KEY`.

---

## Available MCP Capabilities

### 1. Tools (Functions)
The Agent gains access to a comprehensive suite of tools categorized by function:

#### 📊 Market Data (Read-only)
- `get_supported_markets`: List all available jTokens and their addresses.
- `get_market_data`: Get detailed APY, TVL, and utilization for a specific jToken.
- `get_all_markets`: Overview of all JustLend markets including mining rewards.
- `get_protocol_summary`: Comptroller configuration and protocol-level info.

#### 👤 Account & Position (Read-only)
- `get_wallet_address`: Checks the currently used wallet.
- `get_account_summary`: Health factor, supply/borrow balances, and liquidity.
- `get_trx_balance` / `get_token_balance`: Check on-chain balances.
- `check_allowance`: Verify if tokens are approved for lending operations.

#### 💸 Lending Operations (Write)
- `supply` / `withdraw`: Deposit or redeem assets.
- `borrow` / `repay`: Take out or pay back loans.
- `enter_market` / `exit_market`: Enable/disable assets as collateral.
- `approve_underlying`: Approve tokens for JustLend contracts.
- `claim_rewards`: Claim accrued mining rewards.

#### ⚡ Energy & Resources
- `estimate_lending_energy`: Pre-flight estimation of energy, bandwidth, and TRX costs.
- `rent_energy`: Rent energy from JustLend to save on transaction fees.
- `get_energy_rental_dashboard`: Check energy rental market rates.

#### 🥩 sTRX Staking
- `stake_trx_to_strx`: Stake TRX to earn rewards and receive sTRX.
- `unstake_strx`: Unstake sTRX (subject to unbonding period).
- `get_strx_dashboard`: View staking APY and total rewards.

#### 🗳️ Governance
- `get_proposal_list`: List active and past DAO proposals.
- `cast_vote`: Vote on governance proposals using WJST.
- `deposit_jst_for_votes`: Convert JST to voting power.

### 2. Resources (Static Data)
- `justlend://protocol-info`: Returns the JustLend protocol overview and latest contract addresses.

### 3. Prompts (Guided Workflows)
- `supply_assets`: Multi-step guide for safe deposits.
- `borrow_assets`: Risk-aware borrowing workflow with health factor checks.
- `analyze_portfolio`: Deep analysis of positions with risk and optimization reports.
- `compare_markets`: Find the best yield or cheapest borrow rates.

---

## Example Agent Prompts

**Check Market Opportunity:**
> "Using JustLend MCP, what is the current supply APY for USDD and USDT? Which one is higher including mining rewards?"

**Risk Analysis:**
> "Analyze my portfolio. Tell me my current health factor and how much TRX price needs to drop before I face liquidation."

**Guided Operation:**
> "I want to supply 1000 USDT. Please guide me through the supply_assets prompt."

---

## TRON-Specific Troubleshooting

### ❌ Error: `BANDWIDTH_ERROR` or `OUT_OF_ENERGY`
**Reason**: TRON requires Energy for smart contract calls and Bandwidth for transactions.
**Fix**:
- Ensure the wallet has sufficient TRX to "burn" for fees (approx. 50-100 TRX for complex calls).
- Use the `rent_energy` tool to obtain energy at a lower cost before executing large operations.
- Stake TRX using `stake_trx_to_strx` to generate daily free energy.

### ❌ Error: `REVERT` on Supply/Repay
**Reason**: Most TRC20 tokens require "approval" before they can be moved by the JustLend contract.
**Fix**:
- Always call `check_allowance` first.
- If insufficient, call `approve_underlying` before attempting to supply or repay.

### ❌ Status: `Failure` Event in exit_market
**Reason**: You cannot disable a market as collateral if it would push your health factor below 1.0.
**Fix**:
- Repay some debt or supply more of another collateral asset before exiting the market.

---

## Security Notes
- **Read-Only by Default**: For safety, you can omit `TRON_PRIVATE_KEY` to keep the Agent in "Read-Only" mode.
- **Private Key Storage**: Never share your `.json` configuration file or hardcode keys. The MCP server reads from the environment variables of the local process.
- **Simulation First**: Always ask the Agent to `estimate_lending_energy` before broadcasting a write transaction to see the expected outcome.
