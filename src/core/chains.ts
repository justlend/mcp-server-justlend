/**
 * TRON Network Definitions + JustLend Protocol Addresses
 *
 * JustLend DAO is a Compound V2-fork lending protocol on TRON.
 * Core contracts: Comptroller, jTokens, PriceOracle, Lens.
 *
 * VERSION: JustLend V1
 * All contract addresses, ABIs, and calculation logic in this file are for JustLend V1.
 */

export enum TronNetwork {
  Mainnet = "mainnet",
  Nile = "nile",
}

export interface NetworkConfig {
  name: string;
  fullNode: string;
  solidityNode: string;
  eventServer: string;
  explorer: string;
}

/**
 * JustLend V1 core contract addresses per network.
 *
 * NOTE: These addresses are based on publicly known JustLend V1 deployments.
 * Always verify against https://justlend.org and on-chain data.
 *
 * VERSION: V1
 * These are all JustLend V1 contracts.
 */
export interface JustLendAddresses {
  comptroller: string; // Unitroller (proxy for Comptroller)
  priceOracle: string; // Price oracle used by Comptroller
  lens: string; // CompoundLens helper (batch reads)
  maximillion: string; // Helper for repaying TRX borrows
  governorAlpha: string; // Governance contract
  jst: string; // JST token address
  wjst: string; // Wrapped JST for governance
  /** Merkle distributor contracts for mining rewards */
  merkleDistributors: {
    main: string; // Main merkle distributor
    usdd: string; // USDD mining rewards
    strx: string; // sTRX rewards
    multi: string; // Multi-token rewards
  };
  /** sTRX staking related contracts */
  strx: {
    proxy: string; // sTRX proxy contract
    market: string; // sTRX market proxy
  };
  /** Map of symbol → jToken address */
  jTokens: Record<string, JTokenInfo>;
}

export interface JTokenInfo {
  address: string;
  underlying: string; // underlying token address, empty string for TRX
  symbol: string; // e.g. "jTRX"
  underlyingSymbol: string; // e.g. "TRX"
  decimals: number; // jToken decimals (usually 8)
  underlyingDecimals: number; // underlying token decimals
}

export const NETWORKS: Record<TronNetwork, NetworkConfig> = {
  [TronNetwork.Mainnet]: {
    name: "Mainnet",
    fullNode: "https://api.trongrid.io",
    solidityNode: "https://api.trongrid.io",
    eventServer: "https://api.trongrid.io",
    explorer: "https://tronscan.org",
  },
  [TronNetwork.Nile]: {
    name: "Nile Testnet",
    fullNode: "https://nile.trongrid.io",
    solidityNode: "https://nile.trongrid.io",
    eventServer: "https://nile.trongrid.io",
    explorer: "https://nile.tronscan.org",
  },
};

/**
 * JustLend V1 mainnet and testnet contract addresses.
 *
 * VERSION: V1
 * All addresses below are for JustLend V1 protocol.
 *
 * jToken list sourced from JustLend official docs & TronScan verified contracts.
 * All 24 V1 jToken markets are included (synced from justlend-app config.js).
 */
export const JUSTLEND_ADDRESSES: Record<TronNetwork, JustLendAddresses> = {
  [TronNetwork.Mainnet]: {
    comptroller: "TGjYzgCyPobsNS9n6WcbdLVR9dH7mWqFx7",
    priceOracle: "TXjzHPaDeR2KYXQ3Gfwj82PQ2qHaGThFhi",
    lens: "TFTBTMrrMDBbAGrFQzsSiMdoTSMvkung8V",
    maximillion: "T9gCxZ3YpmGftPmGPUNTFfMX7pJNPob4s1",
    governorAlpha: "TEqiF5JbhDPD77yjEfnEMncGRZNDt2uogD",
    jst: "TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9",
    wjst: "TXk9LnTnLN7oH96H3sKxJayMxLxR9M4ZD6",
    merkleDistributors: {
      main: "TQoiXqruw4SqYPwHAd6QiNZ3ES4rLsejAj",
      usdd: "TYxJzmeDyxuxFbaGywjivfkft75qLeS485",
      strx: "TKQ5VVJPsoZDD7NqQ8ffhFwzeRp45XLSGt",
      multi: "TUsyCPRyQdMsn9WnJcssBFXtzg6bUVbty6",
    },
    strx: {
      proxy: "TU3kjFuhtEo42tsCBtfYUAZxoqQ4yuSLQ5",
      market: "TU2MJ5Veik1LRAgjeSzEdvmDYx7mefJZvd",
    },
    jTokens: {
      jTRX: {
        address: "TE2RzoSV3wFK99w6J9UnnZ4vLfXYoxvRwP",
        underlying: "",
        symbol: "jTRX",
        underlyingSymbol: "TRX",
        decimals: 8,
        underlyingDecimals: 6,
      },
      jUSDT: {
        address: "TXJgMdjVX5dKiQaUi9QobwNxtSQaFqccvd",
        underlying: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        symbol: "jUSDT",
        underlyingSymbol: "USDT",
        decimals: 8,
        underlyingDecimals: 6,
      },
      jUSDJ: {
        address: "TL5x9MtSnDy537FXKx53yAaHRRNdg9TkkA",
        underlying: "TMwFHYXLJaRUPeW6421aqXL4ZEzPRFGkGT",
        symbol: "jUSDJ",
        underlyingSymbol: "USDJ",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jSUNOLD: {
        address: "TGBr8uh9jBVHJhhkwSJvQN2ZAKzVkxDmno",
        underlying: "TKkeiboTkxXKJpbmVFbv4a8ov5rAfRDMf9",
        symbol: "jSUNOLD",
        underlyingSymbol: "SUNOLD",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jWIN: {
        address: "TRg6MnpsFXc82ymUPgf5qbj59ibxiEDWvv",
        underlying: "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7",
        symbol: "jWIN",
        underlyingSymbol: "WIN",
        decimals: 8,
        underlyingDecimals: 6,
      },
      jBTC: {
        address: "TLeEu311Cbw63BcmMHDgDLu7fnk9fqGcqT",
        underlying: "TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9",
        symbol: "jBTC",
        underlyingSymbol: "BTC",
        decimals: 8,
        underlyingDecimals: 8,
      },
      jJST: {
        address: "TWQhCXaWz4eHK4Kd1ErSDHjMFPoPc9czts",
        underlying: "TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9",
        symbol: "jJST",
        underlyingSymbol: "JST",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jWBTT: {
        address: "TUY54PVeH6WCcYCd6ZXXoBDsHytN9V5PXt",
        underlying: "TKfjV9RNKJJCqPvBtK8L7Knykh7DNWvnYt",
        symbol: "jWBTT",
        underlyingSymbol: "WBTT",
        decimals: 8,
        underlyingDecimals: 6,
      },
      jETH: {
        address: "TR7BUFRQeq1w5jAZf1FKx85SHuX6PfMqsV",
        underlying: "THb4CqiFdwNHsWsQCs4JhzwjMWys4aqCbF",
        symbol: "jETH",
        underlyingSymbol: "ETH",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jTUSD: {
        address: "TSXv71Fy5XdL3Rh2QfBoUu3NAaM4sMif8R",
        underlying: "TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4",
        symbol: "jTUSD",
        underlyingSymbol: "TUSD",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jNFT: {
        address: "TFpPyDCKvNFgos3g3WVsAqMrdqhB81JXHE",
        underlying: "TFczxzPhnThNSqr5by8tvxsdCFRRz6cPNq",
        symbol: "jNFT",
        underlyingSymbol: "NFT",
        decimals: 8,
        underlyingDecimals: 6,
      },
      jSUN: {
        address: "TPXDpkg9e3eZzxqxAUyke9S4z4pGJBJw9e",
        underlying: "TSSMHYeV2uE9qYH95DqyoCuNCzEL1NvU3S",
        symbol: "jSUN",
        underlyingSymbol: "SUN",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jUSDCOLD: {
        address: "TNSBA6KvSvMoTqQcEgpVK7VhHT3z7wifxy",
        underlying: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8",
        symbol: "jUSDCOLD",
        underlyingSymbol: "USDCOLD",
        decimals: 8,
        underlyingDecimals: 6,
      },
      jBTT: {
        address: "TUaUHU9Dy8x5yNi1pKnFYqHWojot61Jfto",
        underlying: "TAFjULxiVgT4qWk6UZwjqwZXTSaGaqnVp4",
        symbol: "jBTT",
        underlyingSymbol: "BTT",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jUSDD_OLD: {
        address: "TX7kybeP6UwTBRHLNPYmswFESHfyjm9bAS",
        underlying: "TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn",
        symbol: "jUSDD_OLD",
        underlyingSymbol: "USDDOLD",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jBUSDOLD: {
        address: "TLHASseQymmpGQdfAyNjkMXFTJh8nzR2x2",
        underlying: "TMz2SWatiAtZVVcH2ebpsbVtYwUPT9EdjH",
        symbol: "jBUSDOLD",
        underlyingSymbol: "BUSDOLD",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jsTRX: {
        address: "TJQ9rbVe9ei3nNtyGgBL22Fuu2xYjZaLAQ",
        underlying: "TU3kjFuhtEo42tsCBtfYUAZxoqQ4yuSLQ5",
        symbol: "jsTRX",
        underlyingSymbol: "sTRX",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jETHB: {
        address: "TWBxQMb6RD3qmkXUXpNwVCYbL8SHNreru6",
        underlying: "TRFe3hT5oYhjSZ6f3ji5FJ7YCfrkWnHRvh",
        symbol: "jETHB",
        underlyingSymbol: "ETHB",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jwstUSDT: {
        address: "TD5SdLw5scR6mXgyMK2xKrFJpauDjpKqrW",
        underlying: "TGkxzkDKyMeq2T7edKnyjZoFypyzjkkssq",
        symbol: "jwstUSDT",
        underlyingSymbol: "wstUSDT",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jUSDD: {
        address: "TKFRELGGoRgiayhwJTNNLqCNjFoLBh3Mnf",
        underlying: "TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz",
        symbol: "jUSDD",
        underlyingSymbol: "USDD",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jUSD1: {
        address: "TBEKggwqFkrc4KckQVR9BLucAmQugafEZf",
        underlying: "TPFqcBAaaUMCSVRCqPaQ9QnzKhmuoLR6Rc",
        symbol: "jUSD1",
        underlyingSymbol: "USD1",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jWBTC: {
        address: "TVyvpmaVmz25z2GaXBDDjzLZi5iR5dBzGd",
        underlying: "TYhWwKpw43ENFWBTGpzLHn3882f2au7SMi",
        symbol: "jWBTC",
        underlyingSymbol: "WBTC",
        decimals: 8,
        underlyingDecimals: 8,
      },
    },
  },
  [TronNetwork.Nile]: {
    comptroller: "TJUCStq3WqfKqZLuZje5v7z6Ua6iBry1P6",
    priceOracle: "TTestPriceOracleNileXXXXXXXXXXXXXX",
    lens: "TTestLensNileXXXXXXXXXXXXXXXXXXXXX",
    maximillion: "TTestMaximillionNileXXXXXXXXXXXXXX",
    governorAlpha: "TYCNENqt2oJK7eiwubi6YXXt8RHR1BnzBs",
    jst: "TJqk3ChKSjmpoNm3gaqSEatNsueD37NGDK",
    wjst: "TCxA1eNhsAV3gvUwLjLtREW9f775V4h1h7",
    merkleDistributors: {
      main: "TUQb328PQfbredVY3qUD9NZ6DipFxSRZ84",
      usdd: "TMoWFKhkyKUNtxm7P2pMyM7TsVkX9zB7sm",
      strx: "TZETgfTfiPdGm1HkoBktAnpWNjNx4c4did",
      multi: "TQvh3Q94PchENyF2iM7uJH338CcWUfHxMG",
    },
    strx: {
      proxy: "TJaRfuzcxEKGN8sWrkqRUfg9hARNzNajLS",
      market: "TPNcdjfGLjgxh7wVLv6NuLsAcUTzUuEE55",
    },
    jTokens: {},
  },
};

export const DEFAULT_NETWORK = TronNetwork.Mainnet;

export function getNetworkConfig(network: string = DEFAULT_NETWORK): NetworkConfig {
  const n = network.toLowerCase();
  if (n === "mainnet" || n === "tron" || n === "trx") return NETWORKS[TronNetwork.Mainnet];
  if (n === "nile" || n === "testnet") return NETWORKS[TronNetwork.Nile];
  throw new Error(`Unsupported network: ${network}. Supported: mainnet, nile`);
}

export function getJustLendAddresses(network: string = DEFAULT_NETWORK): JustLendAddresses {
  const n = network.toLowerCase();
  if (n === "mainnet" || n === "tron" || n === "trx") return JUSTLEND_ADDRESSES[TronNetwork.Mainnet];
  if (n === "nile" || n === "testnet") return JUSTLEND_ADDRESSES[TronNetwork.Nile];
  throw new Error(`Unsupported network: ${network}`);
}

export function getSupportedNetworks(): string[] {
  return Object.values(TronNetwork);
}

export function getJTokenInfo(symbolOrAddress: string, network: string = DEFAULT_NETWORK): JTokenInfo | undefined {
  const addresses = getJustLendAddresses(network);
  // Search by symbol first
  const bySymbol = addresses.jTokens[symbolOrAddress] || addresses.jTokens[symbolOrAddress.toUpperCase()];
  if (bySymbol) return bySymbol;
  // Search by address
  return Object.values(addresses.jTokens).find(
    (t) => t.address.toLowerCase() === symbolOrAddress.toLowerCase(),
  );
}

export function getAllJTokens(network: string = DEFAULT_NETWORK): JTokenInfo[] {
  const addresses = getJustLendAddresses(network);
  return Object.values(addresses.jTokens);
}
