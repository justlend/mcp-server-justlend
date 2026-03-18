import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Register JustLend task-oriented prompts.
 *
 * Each prompt guides the AI through a multi-step workflow with safety checks.
 */
export function registerJustLendPrompts(server: McpServer) {

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
1. **Wallet**: Call the \`get_wallet_address\` tool to confirm the active wallet.
2. **Balance Check**:
   - If ${market} is jTRX: Call the \`get_trx_balance\` tool to verify sufficient TRX.
   - If TRC20 (jUSDT, jSUN, etc.): Call the \`get_token_balance\` tool with the underlying token address to verify balance.
3. **Market Status**: Call the \`get_market_data\` tool for ${market} to check:
   - Is \`mintPaused\` false? (supply must be enabled)
   - What is the current \`supplyAPY\`?
   - What is the \`collateralFactor\`?

## Approval (TRC20 only, skip for jTRX)
4. Call the \`check_allowance\` tool for ${market} passing amount='${amount}' to explicitly check sufficiency.
5. If the returned \`isSufficient\` is false, call the \`approve_underlying\` tool for ${market} with amount='max'.

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
4. If the returned \`isSufficient\` is false, call the \`approve_underlying\` tool for ${market}.

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
1. **Wallet**: Call the \`get_wallet_address\` tool to confirm the active wallet.
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
1. **Wallet**: Call the \`get_wallet_address\` tool to confirm the active wallet.
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
4. Call the \`get_wallet_address\` tool to get the active wallet.
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
1. **Wallet**: Call the \`get_wallet_address\` tool to confirm the active wallet.
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
}