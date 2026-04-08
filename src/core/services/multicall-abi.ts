export const MULTICALL2_ABI = [
  {
    inputs: [
      { internalType: "bool", name: "requireSuccess", type: "bool" },
      {
        components: [
          { internalType: "address", name: "target", type: "address" },
          { internalType: "bytes", name: "callData", type: "bytes" },
        ],
        internalType: "struct Multicall2.Call[]",
        name: "calls",
        type: "tuple[]",
      },
    ],
    name: "tryAggregate",
    outputs: [
      {
        components: [
          { internalType: "bool", name: "success", type: "bool" },
          { internalType: "bytes", name: "returnData", type: "bytes" },
        ],
        internalType: "struct Multicall2.Result[]",
        name: "returnData",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];

/** Extended balance-query methods on the deployed TRON Multicall3 contract. */
export const MULTICALL3_BALANCE_ABI = [
  {
    inputs: [
      { internalType: "address", name: "_token", type: "address" },
      { internalType: "address", name: "_wallet", type: "address" },
    ],
    name: "getBalance",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address[]", name: "_tokenAddresses", type: "address[]" },
      { internalType: "address", name: "_walletAddress", type: "address" },
    ],
    name: "walletTokensBalance",
    outputs: [
      { internalType: "uint256[]", name: "balances", type: "uint256[]" },
      { internalType: "bool[]", name: "errors", type: "bool[]" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "_tokenAddress", type: "address" },
      { internalType: "address[]", name: "_walletAddresses", type: "address[]" },
    ],
    name: "tokenWalletsBalance",
    outputs: [
      { internalType: "uint256[]", name: "balances", type: "uint256[]" },
      { internalType: "bool[]", name: "errors", type: "bool[]" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address[]", name: "_tokenAddresses", type: "address[]" },
      { internalType: "address[]", name: "_walletAddresses", type: "address[]" },
    ],
    name: "batchBalanceCheck",
    outputs: [
      { internalType: "uint256[][]", name: "balances", type: "uint256[][]" },
      { internalType: "bool[][]", name: "errors", type: "bool[][]" },
    ],
    stateMutability: "view",
    type: "function",
  },
];

export const MULTICALL3_ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: "address", name: "target", type: "address" },
          { internalType: "bool", name: "allowFailure", type: "bool" },
          { internalType: "bytes", name: "callData", type: "bytes" },
        ],
        internalType: "struct Multicall3.Call3[]",
        name: "calls",
        type: "tuple[]",
      },
    ],
    name: "aggregate3",
    outputs: [
      {
        components: [
          { internalType: "bool", name: "success", type: "bool" },
          { internalType: "bytes", name: "returnData", type: "bytes" },
        ],
        internalType: "struct Multicall3.Result[]",
        name: "returnData",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];
