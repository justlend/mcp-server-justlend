/**
 * JustLend Contract ABIs (Compound V2 fork)
 *
 * Only the function signatures used by this MCP server are included.
 * Full ABIs can be fetched on-chain via TronWeb for verified contracts.
 */

// ============================================================================
// jToken (CErc20 / CTRX) ABI — shared by all jToken markets
// ============================================================================
export const JTOKEN_ABI = [
  // --- Read (view/pure) ---
  { type: "function", name: "name", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "symbol", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  { type: "function", name: "totalSupply", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "totalBorrows", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "totalReserves", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "reserveFactorMantissa", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "exchangeRateStored", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "exchangeRateCurrent", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "supplyRatePerBlock", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "borrowRatePerBlock", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "getCash", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "underlying", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "comptroller", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "interestRateModel", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "balanceOf", inputs: [{ type: "address", name: "owner" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    type: "function", name: "getAccountSnapshot",
    inputs: [{ type: "address", name: "account" }],
    outputs: [
      { type: "uint256", name: "err" },
      { type: "uint256", name: "jTokenBalance" },
      { type: "uint256", name: "borrowBalance" },
      { type: "uint256", name: "exchangeRateMantissa" },
    ],
    stateMutability: "view",
  },
  { type: "function", name: "borrowBalanceStored", inputs: [{ type: "address", name: "account" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "balanceOfUnderlying", inputs: [{ type: "address", name: "owner" }], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "allowance", inputs: [{ type: "address", name: "owner" }, { type: "address", name: "spender" }], outputs: [{ type: "uint256" }], stateMutability: "view" },

  // --- Write (state-changing) ---
  // CErc20: mint requires prior ERC20 approval of underlying
  { type: "function", name: "mint", inputs: [{ type: "uint256", name: "mintAmount" }], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  // CTRX (jTRX): mint is payable, amount is msg.value
  // { type: "function", name: "mint", inputs: [], outputs: [], stateMutability: "payable" },
  { type: "function", name: "redeem", inputs: [{ type: "uint256", name: "redeemTokens" }], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "redeemUnderlying", inputs: [{ type: "uint256", name: "redeemAmount" }], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "borrow", inputs: [{ type: "uint256", name: "borrowAmount" }], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "repayBorrow", inputs: [{ type: "uint256", name: "repayAmount" }], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "repayBorrowBehalf", inputs: [{ type: "address", name: "borrower" }, { type: "uint256", name: "repayAmount" }], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  {
    type: "function", name: "liquidateBorrow",
    inputs: [
      { type: "address", name: "borrower" },
      { type: "uint256", name: "repayAmount" },
      { type: "address", name: "jTokenCollateral" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "nonpayable",
  },
  { type: "function", name: "approve", inputs: [{ type: "address", name: "spender" }, { type: "uint256", name: "amount" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
];

/**
 * jTRX-specific mint (payable, no params — callValue carries TRX amount)
 */
export const JTRX_MINT_ABI = [
  { type: "function", name: "mint", inputs: [], outputs: [], stateMutability: "payable" },
];

// ============================================================================
// Comptroller ABI
// ============================================================================
export const COMPTROLLER_ABI = [
  // --- Read ---
  { type: "function", name: "oracle", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "closeFactorMantissa", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "liquidationIncentiveMantissa", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "getAllMarkets", inputs: [], outputs: [{ type: "address[]" }], stateMutability: "view" },
  { type: "function", name: "getAssetsIn", inputs: [{ type: "address", name: "account" }], outputs: [{ type: "address[]" }], stateMutability: "view" },
  {
    type: "function", name: "markets",
    inputs: [{ type: "address", name: "jToken" }],
    outputs: [
      { type: "bool", name: "isListed" },
      { type: "uint256", name: "collateralFactorMantissa" },
    ],
    stateMutability: "view",
  },
  {
    type: "function", name: "getAccountLiquidity",
    inputs: [{ type: "address", name: "account" }],
    outputs: [
      { type: "uint256", name: "err" },
      { type: "uint256", name: "liquidity" },
      { type: "uint256", name: "shortfall" },
    ],
    stateMutability: "view",
  },
  { type: "function", name: "checkMembership", inputs: [{ type: "address", name: "account" }, { type: "address", name: "jToken" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "mintGuardianPaused", inputs: [{ type: "address", name: "jToken" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "borrowGuardianPaused", inputs: [{ type: "address", name: "jToken" }], outputs: [{ type: "bool" }], stateMutability: "view" },

  // --- Write ---
  { type: "function", name: "enterMarkets", inputs: [{ type: "address[]", name: "jTokens" }], outputs: [{ type: "uint256[]" }], stateMutability: "nonpayable" },
  { type: "function", name: "exitMarket", inputs: [{ type: "address", name: "jToken" }], outputs: [{ type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "claimReward", inputs: [{ type: "address", name: "holder" }], outputs: [], stateMutability: "nonpayable" },
];

// ============================================================================
// Price Oracle ABI
// ============================================================================
export const PRICE_ORACLE_ABI = [
  {
    type: "function", name: "getUnderlyingPrice",
    inputs: [{ type: "address", name: "jToken" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
];

// ============================================================================
// TRC20 Token ABI (for approvals before supplying)
// ============================================================================
export const TRC20_ABI = [
  { type: "function", name: "name", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "symbol", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  { type: "function", name: "totalSupply", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "balanceOf", inputs: [{ type: "address", name: "account" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "allowance", inputs: [{ type: "address", name: "owner" }, { type: "address", name: "spender" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "approve", inputs: [{ type: "address", name: "spender" }, { type: "uint256", name: "amount" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  { type: "function", name: "transfer", inputs: [{ type: "address", name: "to" }, { type: "uint256", name: "amount" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
];

// ============================================================================
// GovernorAlpha ABI (JST Voting / Governance)
// ============================================================================
export const GOVERNOR_ALPHA_ABI = [
  // --- Read ---
  {
    type: "function", name: "castVote",
    inputs: [
      { type: "uint256", name: "proposalId" },
      { type: "uint256", name: "votes" },
      { type: "uint8", name: "support" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function", name: "withdrawVotes",
    inputs: [{ type: "uint256", name: "proposalId" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
];

// ============================================================================
// WJST (Wrapped JST for governance voting) ABI
// ============================================================================
export const WJST_ABI = [
  // --- Read ---
  { type: "function", name: "balanceOf", inputs: [{ type: "address", name: "account" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "allowance", inputs: [{ type: "address", name: "owner" }, { type: "address", name: "spender" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    type: "function", name: "lockTo",
    inputs: [{ type: "address", name: "user" }, { type: "uint256", name: "proposalId" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  // --- Write ---
  { type: "function", name: "deposit", inputs: [{ type: "uint256", name: "amount" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "withdraw", inputs: [{ type: "uint256", name: "amount" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "approve", inputs: [{ type: "address", name: "spender" }, { type: "uint256", name: "amount" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
];

// ============================================================================
// Poly (getVoteInfo helper) ABI
// ============================================================================
export const POLY_ABI = [
  {
    type: "function", name: "getVoteInfo",
    inputs: [
      { type: "address", name: "user" },
      { type: "address", name: "jstAddr" },
      { type: "address", name: "wjstAddr" },
    ],
    outputs: [
      { type: "uint256", name: "jstBalance" },
      { type: "uint256", name: "surplusVotes" },
      { type: "uint256", name: "totalVote" },
      { type: "uint256", name: "castVote" },
    ],
    stateMutability: "view",
  },
];

// ============================================================================
// Interest Rate Model ABI (JumpRateModelV2)
// ============================================================================
export const INTEREST_RATE_MODEL_ABI = [
  { type: "function", name: "baseRatePerBlock", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "multiplierPerBlock", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "jumpMultiplierPerBlock", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "kink", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    type: "function", name: "getBorrowRate",
    inputs: [{ type: "uint256", name: "cash" }, { type: "uint256", name: "borrows" }, { type: "uint256", name: "reserves" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function", name: "getSupplyRate",
    inputs: [{ type: "uint256", name: "cash" }, { type: "uint256", name: "borrows" }, { type: "uint256", name: "reserves" }, { type: "uint256", name: "reserveFactorMantissa" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
];
