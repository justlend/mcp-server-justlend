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
1. **Wallet**: Call \`get_wallet_address\` to confirm the active wallet.
2. **Balance Check**:
   - If ${market} is jTRX: Call \`get_trx_balance\` to verify sufficient TRX.
   - If TRC20 (jUSDT, jSUN, etc.): Call \`get_token_balance\` with the underlying token address to verify balance.
3. **Market Status**: Call \`get_market_data\` for ${market} to check:
   - Is \`mintPaused\` false? (supply must be enabled)
   - What is the current \`supplyAPY\`?
   - What is the \`collateralFactor\`?

## Approval (TRC20 only, skip for jTRX)
4. Call \`check_allowance\` for ${market}.
5. If allowance is insufficient, call \`approve_underlying\` for ${market} with amount='max'.

## Execute Supply
6. Call \`supply\` with market='${market}', amount='${amount}'.

## Post-Supply Verification
7. Call \`get_account_summary\` to verify:
   - New supply balance in ${market}
   - Updated health factor

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
1. Call \`get_account_summary\` to check current position:
   - Current collateral value (totalSupplyUSD)
   - Current borrows (totalBorrowUSD)
   - Health factor — must be > 1.0
   - Liquidity available
2. Call \`get_market_data\` for ${market} to check:
   - Is \`borrowPaused\` false?
   - Current \`borrowAPY\` (cost of borrowing)
   - Available liquidity (can the market fulfill this borrow?)

## Collateral Verification
3. Ensure at least one market is entered as collateral.
   - Check \`collateralMarkets\` from account summary.
   - If none: guide user to \`enter_market\` first.
4. Calculate projected health factor after borrow:
   - New borrow = current borrow + ${amount} * price
   - New health = collateral / new borrow
   - **WARN if health factor would drop below 1.25** (liquidation risk)
   - **REFUSE if health factor would drop below 1.05** (too dangerous)

## Execute Borrow
5. Call \`borrow\` with market='${market}', amount='${amount}'.

## Post-Borrow Verification
6. Call \`get_account_summary\` to confirm:
   - New borrow balance
   - Updated health factor
   - Remaining borrowing capacity

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
1. Call \`get_account_summary\` to see current borrow balance in ${market}.
2. Verify wallet has enough tokens to repay:
   - jTRX: Call \`get_trx_balance\`
   - TRC20: Call \`get_token_balance\` for the underlying

## Approval (TRC20 only, skip for jTRX)
3. Call \`check_allowance\` for ${market}.
4. If insufficient, call \`approve_underlying\` for ${market}.

## Execute Repay
5. Call \`repay\` with market='${market}', amount='${amount}'.

## Verification
6. Call \`get_account_summary\` to confirm:
   - Reduced borrow balance
   - Improved health factor

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
1. Call \`get_account_summary\`${address ? ` with address='${address}'` : ""} to get all positions.
2. Call \`get_all_markets\` to get current market conditions.
3. Call \`get_protocol_summary\` for protocol parameters.

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
1. Call \`get_all_markets\` to get all market data.

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
}
