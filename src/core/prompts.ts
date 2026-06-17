import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Register JustLend task-oriented prompts.
 *
 * Each prompt guides the AI through a multi-step workflow with safety checks.
 */
export function registerJustLendPrompts(server: McpServer) {

  // ============================================================================
  // GETTING STARTED (Onboarding)
  // ============================================================================
  server.registerPrompt(
    "getting_started",
    {
      description: "First-time onboarding: choose wallet mode, connect wallet, and explore JustLend features",
      argsSchema: {},
    },
    () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `# Welcome to JustLend MCP Server

**Objective**: Help the user set up their wallet and get familiar with available features.

## Step 1 — Wallet Setup
Call the \`get_wallet_address\` tool. If the wallet mode is "unset", present the two options clearly:

### Option A: Browser Wallet (Recommended)
- Use TronLink or other browser wallets to sign transactions
- **Private keys never leave the browser** — most secure option
- Action: Call \`connect_browser_wallet\` to open TronLink in the browser

### Option B: Agent Wallet
- Encrypted private key stored locally in ~/.agent-wallet/
- Convenient for automated/headless usage
- Action: Call \`set_wallet_mode\` with mode="agent"

Ask the user which mode they prefer, then execute the corresponding action.

## Step 2 — Verify Connection
After wallet is connected:
- Show the connected address
- Call the \`get_trx_balance\` tool to display TRX balance
- Call the \`get_wallet_balances\` tool to show all token balances

## Step 3 — Quick Tour
Briefly introduce what the user can do:

📊 **Query** (read-only, no wallet needed):
- "JustLend 有哪些市场？" → market overview & APYs
- "帮我查地址 Txxx 的仓位" → account positions & health factor
- "sTRX 质押年化多少？" → staking APY & exchange rate

💰 **Operate** (requires wallet):
- "帮我存 100 USDT 到 JustLend" → supply assets
- "帮我借 500 USDT" → borrow against collateral
- "质押 1000 TRX" → stake TRX for sTRX

🏛️ **Governance**:
- "最新的治理提案有哪些？" → proposals & voting

Ask the user what they'd like to do first.`,
        },
      }],
    }),
  );

  // ============================================================================
  // SUPPLY WORKFLOW
  // ============================================================================
  server.registerPrompt(
    "supply_assets",
    {
      description: "Step-by-step guide to safely supply assets into JustLend to earn interest",
      argsSchema: {
        market: z.string().describe("jToken symbol (e.g. 'jUSDT', 'jTRX')"),
        amount: z.string().describe("Amount of underlying to supply"),
        network: z.string().optional().describe("Network (default: mainnet)"),
      },
    },
    ({ market, amount, network = "mainnet" }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `# Supply Assets to JustLend

**Objective**: Supply ${amount} into the ${market} market on ${network} to earn interest.

## Pre-flight Checks
1. **Wallet**: Call the \`get_wallet_address\` tool to confirm the active wallet, or choose browser/agent signing if this is the first use.
2. **Balance Check**:
   - If ${market} is jTRX: Call the \`get_trx_balance\` tool to verify sufficient TRX.
   - If TRC20 (jUSDT, jSUN, etc.): Call the \`get_token_balance\` tool with the underlying token address to verify balance.
3. **Market Status**: Call the \`get_market_data\` tool for ${market} to check:
   - Is \`mintPaused\` false? (supply must be enabled)
   - What is the current \`supplyAPY\`?
   - What is the \`collateralFactor\`?

## Approval (TRC20 only, skip for jTRX)
4. Call the \`check_allowance\` tool for ${market} passing amount='${amount}' to explicitly check sufficiency.
5. If the returned \`isSufficient\` is false, call the \`approve_underlying\` tool for ${market} with amount='${amount}' (exact amount, NOT 'max').
   - Unlimited (\`max\`) approval is convenient but lets the jToken contract spend the user's entire balance forever. Only use \`max\` if the user explicitly opts in after understanding this trade-off.

## Execute Supply
6. Call the \`supply\` tool with market='${market}', amount='${amount}'.

## Post-Supply Verification
7. **CRITICAL**: Call the \`get_account_summary\` tool immediately to refresh your context with:
   - Updated supply balance in ${market}
   - New health factor
   - Current block number and timestamp

## Report
Provide a summary:
- Amount supplied and estimated annual interest
- New total supply value
- Whether this market is being used as collateral
- Health factor status

**Safety**: If at any step an error occurs, STOP and report the issue. Never proceed blindly.`,
        },
      }],
    }),
  );

  // ============================================================================
  // BORROW WORKFLOW
  // ============================================================================
  server.registerPrompt(
    "borrow_assets",
    {
      description: "Step-by-step guide to safely borrow assets from JustLend against collateral",
      argsSchema: {
        market: z.string().describe("jToken market to borrow from (e.g. 'jUSDT')"),
        amount: z.string().describe("Amount to borrow"),
        network: z.string().optional().describe("Network (default: mainnet)"),
      },
    },
    ({ market, amount, network = "mainnet" }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `# Borrow Assets from JustLend

**Objective**: Borrow ${amount} from the ${market} market on ${network}.

## Risk Assessment (CRITICAL)
1. Call the \`get_account_summary\` tool to check current position:
   - Current collateral value (totalSupplyUSD)
   - Current borrows (totalBorrowUSD)
   - Health factor — must be > 1.0
   - Liquidity available
2. Call the \`get_market_data\` tool for ${market} to check:
   - Is \`borrowPaused\` false?
   - Current \`borrowAPY\` (cost of borrowing)
   - Available liquidity (can the market fulfill this borrow?)

## Collateral Verification
3. Ensure at least one market is entered as collateral.
   - Check \`collateralMarkets\` from account summary.
   - If none: guide user to the \`enter_market\` tool first.
4. Calculate projected health factor after borrow:
   - New borrow = current borrow + ${amount} * price
   - New health = collateral / new borrow
   - **WARN if health factor would drop below 1.25** (liquidation risk)
   - **REFUSE if health factor would drop below 1.05** (too dangerous)

## Execute Borrow
5. Call the \`borrow\` tool with market='${market}', amount='${amount}'.

## Post-Borrow Verification
6. **CRITICAL**: Call the \`get_account_summary\` tool immediately to refresh your context with:
   - New borrow balance
   - Updated health factor
   - Remaining borrowing capacity
   - Current block number and timestamp

## Report
- Amount borrowed and annual interest cost
- Updated health factor with risk assessment
- Distance to liquidation threshold
- Recommendation: safe range for additional borrows

**WARNING**: Borrowing reduces your health factor. If it drops below 1.0, your collateral can be liquidated.`,
        },
      }],
    }),
  );

  // ============================================================================
  // REPAY WORKFLOW
  // ============================================================================
  server.registerPrompt(
    "repay_borrow",
    {
      description: "Step-by-step guide to repay borrowed assets on JustLend",
      argsSchema: {
        market: z.string().describe("jToken market to repay (e.g. 'jUSDT')"),
        amount: z.string().describe("Amount to repay, or 'max' for full repayment"),
        network: z.string().optional().describe("Network (default: mainnet)"),
      },
    },
    ({ market, amount, network = "mainnet" }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `# Repay Borrow on JustLend

**Objective**: Repay ${amount} to the ${market} market on ${network}.

## Pre-flight Checks
1. Call the \`get_account_summary\` tool to see current borrow balance in ${market}.
2. Verify wallet has enough tokens to repay:
   - jTRX: Call the \`get_trx_balance\` tool
   - TRC20: Call the \`get_token_balance\` tool for the underlying

## Approval (TRC20 only, skip for jTRX)
3. Call the \`check_allowance\` tool for ${market} passing amount='${amount}' to explicitly check sufficiency.
4. If the returned \`isSufficient\` is false, call the \`approve_underlying\` tool for ${market} with amount='${amount}' (exact amount, NOT 'max'). Use 'max' only if the user explicitly opts in.

## Execute Repay
5. Call the \`repay\` tool with market='${market}', amount='${amount}'.

## Verification
6. **CRITICAL**: Call the \`get_account_summary\` tool immediately to refresh your context with:
   - Reduced borrow balance
   - Improved health factor
   - Current block number and timestamp

## Report
- Amount repaid
- Remaining borrow balance
- New health factor
- Estimated remaining interest cost`,
        },
      }],
    }),
  );

  // ============================================================================
  // PORTFOLIO ANALYSIS
  // ============================================================================
  server.registerPrompt(
    "analyze_portfolio",
    {
      description: "Comprehensive analysis of a user's JustLend portfolio with risk assessment and optimization suggestions",
      argsSchema: {
        address: z.string().optional().describe("Address to analyze. Default: configured wallet"),
        network: z.string().optional().describe("Network (default: mainnet)"),
      },
    },
    ({ address, network = "mainnet" }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `# JustLend Portfolio Analysis

**Objective**: Provide a comprehensive analysis of the lending portfolio${address ? ` for ${address}` : ""} on ${network}.

## Data Collection
1. Call the \`get_account_summary\` tool${address ? ` with address='${address}'` : ""} to get all positions.
2. Call the \`get_all_markets\` tool to get current market conditions.
3. Call the \`get_protocol_summary\` tool for protocol parameters.

## Analysis Points

### Position Overview
- List all supply positions with USD values and APYs
- List all borrow positions with USD values and APYs
- Net position (supply - borrow)
- Estimated net APY (weighted supply APY - weighted borrow APY)

### Risk Assessment
- Health factor analysis:
  - > 2.0: Very safe
  - 1.5 - 2.0: Safe
  - 1.2 - 1.5: Moderate risk
  - 1.0 - 1.2: High risk — recommend repaying
  - < 1.0: LIQUIDATION RISK — urgent action needed
- Collateral factor analysis: which markets are enabled as collateral?
- Concentration risk: is most collateral in a single asset?

### Optimization Suggestions
- Are there higher-APY markets the user could supply to?
- Could the user reduce borrow costs by switching markets?
- Is the collateral factor optimal? (e.g., disabling low-factor collateral)
- Unclaimed rewards?

### Liquidation Scenario
- How much would asset prices need to drop for liquidation?
- Which collateral would be seized first?

## Final Report Format
Present as a structured portfolio report with clear sections, numbers, and actionable recommendations.`,
        },
      }],
    }),
  );

  // ============================================================================
  // ENERGY RENTAL WORKFLOW
  // ============================================================================
  server.registerPrompt(
    "rent_energy",
    {
      description: "Step-by-step guide to safely rent energy from JustLend",
      argsSchema: {
        receiverAddress: z.string().describe("Address to receive the energy"),
        energyAmount: z.string().describe("Amount of energy to rent (e.g. '300000')"),
        durationDays: z.string().describe("Duration in days (e.g. '7')"),
        network: z.string().optional().describe("Network (default: mainnet)"),
      },
    },
    ({ receiverAddress, energyAmount, durationDays, network = "mainnet" }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `# Rent Energy from JustLend

**Objective**: Rent ${energyAmount} energy for ${durationDays} days to ${receiverAddress} on ${network}.

## Pre-flight Checks
1. **Wallet**: Call the \`get_wallet_address\` tool to confirm the active wallet, or choose browser/agent signing if this is the first use.
2. **Rental Status**: Call the \`get_energy_rental_params\` tool to check:
   - Is \`rentPaused\` false? (rental must be enabled)
   - What is the max rentable amount?
3. **Price Estimate**: Call the \`calculate_energy_rental_price\` tool with energyAmount=${energyAmount}, durationDays=${durationDays} to get:
   - Total TRX prepayment needed
   - Security deposit amount
   - Daily rental cost
4. **Balance Check**: Call the \`get_trx_balance\` tool to verify sufficient TRX for prepayment + gas (~200 TRX).
5. **Existing Rental**: Call the \`get_energy_rent_info\` tool with receiverAddress='${receiverAddress}' to check if there's already an active rental.

## Execute Rental
6. If all checks pass, call the \`rent_energy\` tool with:
   - receiverAddress='${receiverAddress}'
   - energyAmount=${energyAmount}
   - durationDays=${durationDays}

## Post-Rental Verification
7. Call the \`get_energy_rent_info\` tool to confirm the rental is active.
8. Call the \`get_user_energy_rental_orders\` tool to see the new order.

## Report
- Energy rented and duration
- Total cost and security deposit
- Estimated daily rental cost
- Receiver address confirmed

**Safety**: If rental is paused, balance insufficient, or any check fails, STOP and report the issue.`,
        },
      }],
    }),
  );

  // ============================================================================
  // STRX STAKING WORKFLOW
  // ============================================================================
  server.registerPrompt(
    "stake_trx",
    {
      description: "Step-by-step guide to stake TRX in JustLend to earn sTRX rewards",
      argsSchema: {
        amount: z.string().describe("Amount of TRX to stake"),
        network: z.string().optional().describe("Network (default: mainnet)"),
      },
    },
    ({ amount, network = "mainnet" }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `# Stake TRX in JustLend (sTRX)

**Objective**: Stake ${amount} TRX on ${network} to receive sTRX and earn staking rewards.

## Pre-flight Checks
1. **Wallet**: Call the \`get_wallet_address\` tool to confirm the active wallet, or choose browser/agent signing if this is the first use.
2. **Dashboard**: Call the \`get_strx_dashboard\` tool to check:
   - Current sTRX/TRX exchange rate
   - Total APY (vote APY + rental income)
   - How much sTRX you'll receive for ${amount} TRX
3. **Balance Check**: Call the \`get_trx_balance\` tool to verify sufficient TRX for staking + gas.
4. **Current Position**: Call the \`get_strx_account\` tool to see existing staking position.

## Execute Staking
5. Call the \`stake_trx_to_strx\` tool with amount=${amount}.

## Post-Staking Verification
6. Call the \`get_strx_balance\` tool to confirm sTRX received.
7. Call the \`get_strx_account\` tool to see updated staking position.

## Report
- Amount of TRX staked
- sTRX received (or estimated)
- Current APY and estimated annual earnings
- Note about unstaking: requires unbonding period

**Safety**: If balance is insufficient, STOP and report.`,
        },
      }],
    }),
  );

  // ============================================================================
  // MARKET COMPARISON
  // ============================================================================
  server.registerPrompt(
    "compare_markets",
    {
      description: "Compare JustLend markets to find the best opportunities for supply or borrow",
      argsSchema: {
        action: z.enum(["supply", "borrow"]).describe("Whether looking to supply or borrow"),
        network: z.string().optional().describe("Network (default: mainnet)"),
      },
    },
    ({ action, network = "mainnet" }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `# JustLend Market Comparison — Best ${action === "supply" ? "Supply" : "Borrow"} Opportunities

**Objective**: Compare all JustLend markets to find the best ${action} opportunities on ${network}.

## Data Collection
1. Call the \`get_all_markets\` tool to get all market data.

## Analysis
${action === "supply" ? `
### Best Supply Opportunities (sorted by APY)
- Rank markets by supplyAPY (highest first)
- For each market show: symbol, APY, TVL, utilization, collateral factor
- Flag any paused markets
- Note: higher utilization often means more volatile APY

### Considerations
- Collateral factor: higher = more borrowing power if used as collateral
- Utilization rate: very high (>90%) may cause withdrawal delays
- TVL: larger markets are generally more stable
` : `
### Best Borrow Opportunities (sorted by APY)
- Rank markets by borrowAPY (lowest first — cheapest to borrow)
- For each market show: symbol, APY, available liquidity, collateral factor
- Flag any paused markets

### Considerations
- Available liquidity: ensure enough exists for your borrow size
- Borrow APY: lower is better (less interest cost)
- Utilization: if near kink, rates may jump suddenly
`}

## Recommendation
Provide a top-3 recommendation with reasoning.`,
        },
      }],
    }),
  );

  // ============================================================================
  // GOVERNANCE & VOTING WORKFLOW
  // ============================================================================
  server.registerPrompt(
    "query_proposals",
    {
      description: "Guide to checking active governance proposals and user voting status",
      argsSchema: {
        network: z.string().optional().describe("Network (default: mainnet)"),
      },
    },
    ({ network = "mainnet" }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `# Check JustLend Governance Proposals

**Objective**: Check the latest DAO proposals and see if the user has available votes.

## Pre-flight Checks
1. Call the \`get_proposal_list\` tool to fetch recent proposals. Filter for those with state "Active" (state: 1).
2. The tool now returns both \`title\` and \`content\` for most proposals (including summaries for historically hardcoded ones). Use this information to explain the active proposals clearly to the user.
3. Note: If a very early proposal (e.g., ID 1-6) specifically returns "Details maintained in frontend." in its content, gently explain to the user that the exact text is unavailable via API, but they can still vote on it using its Proposal ID.
4. Call the \`get_wallet_address\` tool to get the active wallet, or choose browser/agent signing if this is the first use.
5. Call the \`get_vote_info\` tool to check the user's available voting power (surplusVotes).

## Report
Provide a summary:
- List of Active proposals (ID, Title, Brief summary of content, Current For/Against votes)
- User's available voting power (WJST)
- Ask if the user wants to cast a vote or needs to deposit JST for more voting power.`,
        },
      }],
    }),
  );

  server.registerPrompt(
    "cast_vote",
    {
      description: "Step-by-step guide to safely cast a vote on a JustLend governance proposal",
      argsSchema: {
        proposalId: z.string().describe("The ID of the proposal to vote on"),
        support: z.enum(["for", "against"]).describe("Whether to vote 'for' or 'against'"),
        amount: z.string().describe("Amount of votes (WJST) to cast"),
        network: z.string().optional().describe("Network (default: mainnet)"),
      },
    },
    ({ proposalId, support, amount, network = "mainnet" }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `# Cast Vote on JustLend Proposal

**Objective**: Cast ${amount} votes ${support.toUpperCase()} proposal #${proposalId} on ${network}.

## Pre-flight Checks
1. **Wallet**: Call the \`get_wallet_address\` tool to confirm the active wallet, or choose browser/agent signing if this is the first use.
2. **Voting Power Check**: Call the \`get_vote_info\` tool to verify the user has enough \`surplusVotes\` (>= ${amount}).
   - If \`surplusVotes\` is insufficient, inform the user they need to deposit JST first using the \`deposit_jst_for_votes\` tool.
3. **Proposal Status**: Call the \`get_proposal_list\` tool to verify that proposal #${proposalId} is currently "Active".

## Execute Vote
4. If checks pass, call the \`cast_vote\` tool with:
   - proposalId=${proposalId}
   - support=${support === "for" ? "true" : "false"}
   - votes=${amount}

## Post-Vote Verification
5. Call the \`get_vote_info\` tool to confirm the votes were consumed from \`surplusVotes\` and added to \`castVote\`.

## Report
- Proposal ID and decision (For/Against)
- Amount of votes cast
- Remaining available voting power`,
        },
      }],
    }),
  );

  // ============================================================================
  // MOOLAH V2 — VAULT SUPPLY
  // ============================================================================
  server.registerPrompt(
    "moolah_supply",
    {
      description: "Guide for depositing into a JustLend V2 (Moolah) vault to earn auto-compounding yield",
      argsSchema: {
        vaultSymbol: z.string().optional().describe("Vault symbol: 'TRX', 'USDT', or 'USDD'. Omit to compare all vaults."),
        amount: z.string().optional().describe("Amount to deposit"),
        network: z.string().optional().describe("Network (default: mainnet)"),
      },
    },
    ({ vaultSymbol, amount, network = "mainnet" }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `# JustLend V2 Vault Deposit Guide

**Objective**: ${vaultSymbol && amount ? `Deposit ${amount} into the ${vaultSymbol} vault on ${network}.` : "Help the user choose a Moolah vault and deposit assets."}

## Step 1 — Show Available Vaults
Call \`get_moolah_vaults\` to list all vaults with current APY and TVL.

Explain the three vaults:
- **TRX vault** — native TRX, no approval needed
- **USDT vault** — stablecoin, requires approval first
- **USDD vault** — TRON-native stablecoin, requires approval first

**How Moolah Vaults differ from V1 jTokens**:
- V1 jTokens: you manually pick a market and earn from that market's utilization
- V2 Vaults: a curator allocates your funds across multiple markets automatically — higher yield, lower management effort
- ERC4626 shares: you receive vault shares representing your proportional ownership; shares only increase in value, never decrease (barring protocol risk)

**Minimum deposit recommendation**: Skip if balance < 100 TRX or < 50 USDT — gas cost exceeds expected yield on small amounts.

## Step 2 — Select Vault${vaultSymbol ? ` (already chosen: ${vaultSymbol})` : ""}
${vaultSymbol ? `User has chosen the **${vaultSymbol}** vault. Proceed to Step 3.` : "Ask the user which vault they want to deposit into. Show APY comparison from Step 1."}

## Step 3 — Check Wallet & Balance
1. Call \`get_wallet_address\` to confirm wallet.
2. Check balance:
   - TRX vault → \`get_trx_balance\`
   - USDT/USDD vault → \`get_token_balance\` with token='${vaultSymbol ?? "USDT"}'

## Step 4 — Approval (TRC20 vaults only, skip for TRX)
For USDT or USDD vaults:
- Call \`approve_moolah_vault\` with vaultSymbol and the EXACT deposit amount (e.g. amount='${amount ?? "<user amount>"}'). Use amount='max' for unlimited approval ONLY if the user explicitly opts in (it can be revoked later with amount='0').
- Wait for the approval transaction to confirm before proceeding

## Step 5 — Deposit
Call \`moolah_vault_deposit\` with:
- vaultSymbol: '${vaultSymbol ?? "<chosen vault>"}'
- amount: '${amount ?? "<user amount>"}'

## Step 6 — Verify
Call \`get_moolah_vault\` with the vault symbol to confirm:
- User's share balance has increased
- Estimated asset value matches deposit amount (plus any accrued yield)

## Report
- Vault chosen, amount deposited, shares received
- Current APY and estimated annual yield on deposited amount
- How to withdraw: \`moolah_vault_withdraw\` with amount or amount='max'`,
        },
      }],
    }),
  );

  // ============================================================================
  // MOOLAH V2 — BORROW
  // ============================================================================
  server.registerPrompt(
    "moolah_borrow",
    {
      description: "Guide for supplying collateral and borrowing from a JustLend V2 (Moolah) market",
      argsSchema: {
        marketId: z.string().optional().describe("Market ID (bytes32 hex). Omit to browse markets first."),
        collateralAmount: z.string().optional().describe("Collateral amount to supply"),
        borrowAmount: z.string().optional().describe("Loan amount to borrow"),
        network: z.string().optional().describe("Network (default: mainnet)"),
      },
    },
    ({ marketId, collateralAmount, borrowAmount, network = "mainnet" }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `# JustLend V2 Borrow Guide

**Objective**: ${marketId ? `Borrow in market ${marketId} on ${network}.` : "Help the user find a market and set up a collateralized borrow position."}

## Step 1 — Browse Markets${marketId ? " (skip — market already provided)" : ""}
${marketId ? `Market ID: \`${marketId}\` — proceed to Step 2.` : `Call \`get_moolah_markets\` to list available markets.

Key market parameters to explain:
- **LLTV (Liquidation LTV)**: maximum borrow ratio before liquidation. Higher LLTV = more capital-efficient but riskier.
- **Borrow APY**: current annual cost of the loan (variable, driven by utilization)
- **Collateral token / Loan token**: each market is isolated with fixed pairs`}

## Step 2 — Understand Risk Thresholds
The market position API returns a **risk** ratio = (borrowed value) / (collateral value × LLTV).

| risk | Status | Action |
|---|---|---|
| < 0.70 | ✅ Healthy | No action needed |
| 0.70 – 0.85 | ⚠️ Caution | Monitor closely |
| 0.85 – 1.00 | 🔴 Danger | Repay or add collateral immediately |
| > 1.00 | ☠️ Liquidatable | Position will be liquidated |

**Recommendation**: Keep risk below 0.70 to allow for price fluctuations.

## Step 3 — Wallet & Balance Check
1. Call \`get_wallet_address\` to confirm wallet.
2. Check collateral token balance (TRX: \`get_trx_balance\`; TRC20: \`get_token_balance\`).

## Step 4 — Approval (TRC20 collateral only, skip for TRX)
If the collateral token is TRC20, call \`approve_moolah_proxy\` with the token details.

## Step 5 — Check Existing Position
Call \`get_moolah_user_position\` with marketId${marketId ? `='${marketId}'` : ""} to see current collateral and borrow.

## Step 6 — Execute
Call \`moolah_borrow\` with:
- marketId: '${marketId ?? "<chosen market>"}'
- collateralAmount: '${collateralAmount ?? "<amount or omit>"}' (omit if already deposited)
- borrowAmount: '${borrowAmount ?? "<amount or omit>"}'  (omit to only supply collateral)

## Step 7 — Post-Borrow Safety Check
Call \`get_moolah_user_position\` again to confirm risk is below 0.70.

## Repayment Reminder
- Full repay: \`moolah_repay\` with amount='max' (uses shares math for exact settlement)
- For TRC20 loan tokens, approve Moolah proxy before repaying
- For TRX loans, TRX is sent directly with no prior approval`,
        },
      }],
    }),
  );

  // ============================================================================
  // MOOLAH V2 — LIQUIDATION
  // ============================================================================
  server.registerPrompt(
    "moolah_liquidate",
    {
      description: "Guide for finding and executing JustLend V2 (Moolah) public liquidations",
      argsSchema: {
        network: z.string().optional().describe("Network (default: mainnet)"),
      },
    },
    ({ network = "mainnet" }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `# JustLend V2 Liquidation Guide

**Objective**: Find undercollateralized positions and execute profitable public liquidations on ${network}.

## Step 1 — Find Liquidatable Positions
Call \`get_moolah_pending_liquidations\` with minRiskLevel=1.0 to list positions that can be liquidated right now.

Key fields to interpret:
- **riskLevel > 1.0**: position is liquidatable (borrowed value exceeds collateral × LLTV)
- **borrowAssets / borrowUSD**: the debt you will partially repay
- **collateralAssets / collateralUSD**: the collateral you will seize (at a discount defined by the protocol)
- **maxSeizableAssets**: maximum collateral you can seize in one liquidation call

For near-threshold positions (riskLevel 0.95–1.0), monitor frequently — prices move fast.

## Step 2 — Estimate Profitability
For a target position, call \`get_moolah_liquidation_quote\` with:
- marketId from the pending liquidation
- seizedAssets = desired collateral to seize (in raw token units)

The returned \`loanTokenAmountNeeded\` tells you how much loan token you must provide.

**Profit estimate** = value of seized collateral − cost of loan token repaid
A healthy liquidation should yield 3–10% depending on the protocol's liquidation incentive.

## Step 3 — Prepare Loan Token
1. Verify you hold enough loan token: \`get_token_balance\` with token symbol.
2. Approve the liquidator contract: \`approve_liquidator_token\` with the loan token details.

## Step 4 — Execute Liquidation
Call \`moolah_liquidate\` with:
- marketId: from Step 1
- borrower: the address of the position to liquidate
- seizedAssets: your chosen amount (from Step 2), OR
- repaidShares: borrow shares to repay instead

**Important**: Provide EITHER seizedAssets OR repaidShares — not both.

## Step 5 — Verify Outcome
After the transaction confirms:
1. Check your collateral token balance increased: \`get_token_balance\`
2. Check historical records: \`get_moolah_liquidation_records\` with type='public'

## Safety Notes
- Liquidations are competitive — frontrunning is common. Consider gas optimization.
- Partial liquidations are allowed — you don't need to close the full position.
- If the transaction reverts, the position may have already been liquidated by another liquidator.`,
        },
      }],
    }),
  );

  // ============================================================================
  // MOOLAH V2 — PORTFOLIO OVERVIEW
  // ============================================================================
  server.registerPrompt(
    "moolah_portfolio",
    {
      description: "Overview of the user's full JustLend V2 (Moolah) portfolio: vaults, markets, risk assessment",
      argsSchema: {
        address: z.string().optional().describe("Address to inspect. Default: configured wallet"),
        network: z.string().optional().describe("Network (default: mainnet)"),
      },
    },
    ({ address, network = "mainnet" }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `# JustLend V2 Portfolio Overview

**Objective**: Give a complete picture of ${address ? `address ${address}'s` : "the user's"} Moolah V2 positions on ${network} and highlight any risk.

## Step 1 — Aggregated Summary
Call \`get_moolah_dashboard\`${address ? ` with address='${address}'` : ""} to get:
- totalSupplyUsd / totalBorrowUsd / totalCollateralUsd
- netEarnApy / netBorrowRate / dailyRevenue
- collateralCount

## Step 2 — Vault Positions
From the dashboard response, inspect \`userPosition.vaults\`:
For each vault entry (fields: vaultAddress / assetSymbol / depositAmount / depositUsd / apy):
- Vault name and underlying asset
- Deposit amount and USD value
- Current APY

If no vault positions exist, note that the user has no V2 vault deposits.

## Step 3 — Market Positions
From the dashboard response, inspect \`userPosition.markets\`:
For each market entry (fields: marketId / borrowAmount / borrowUsd / collateralAmount / collateralUsd / risk):
- Loan token and collateral token
- Borrow amount and collateral amount (with USD values)
- **risk** ratio (0-1, where 1.0 = at liquidation threshold)

### Risk Assessment
| risk | Recommendation |
|---|---|
| < 0.70 | ✅ Healthy — no action needed |
| 0.70 – 0.85 | ⚠️ Consider reducing borrow or adding collateral |
| > 0.85 | 🔴 Immediate action required — liquidation risk |

For any market with risk > 0.80, suggest:
1. Repay borrow: \`moolah_repay\` with marketId and amount='max'
2. Add collateral: \`moolah_supply_collateral\`

## Step 4 — Historical Trend (optional)
Call \`get_moolah_history\`${address ? ` with address='${address}'` : ""} with timeFilter='ONE_WEEK' to show whether the position has been growing or shrinking.

## Summary Report
Provide a concise summary:
- Total V2 net worth
- List of vault positions with yield
- List of market positions with risk level (color-coded)
- Any immediate actions recommended`,
        },
      }],
    }),
  );
}
