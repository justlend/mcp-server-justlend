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
  poly: string; // Poly helper contract (getVoteInfo, getBalance, etc.)
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
    market: string; // sTRX market proxy (energy rental)
  };
  /** Energy rate model contract for rental rate calculations */
  energyRateModel: string;
  /** Multicall3 contract address (optional — absent on testnets triggers sequential fallback) */
  multicall3?: string;
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
    priceOracle: "TGnYnSn4G9PgWFj7QQemh4YMZKp3fkympJ",
    lens: "TFTBTMrrMDBbAGrFQzsSiMdoTSMvkung8V",
    maximillion: "T9gCxZ3YpmGftPmGPUNTFfMX7pJNPob4s1",
    governorAlpha: "TEqiF5JbhDPD77yjEfnEMncGRZNDt2uogD",
    jst: "TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9",
    wjst: "TXk9LnTnLN7oH96H3sKxJayMxLxR9M4ZD6",
    poly: "TXTXGyhNLhELNZPDXsn5fCnGYLZoLwJvRC",
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
    energyRateModel: "TXA2WjFc5f86deJcZZCdbdpkpUTKTA3VDM",
    multicall3: "TX56WKxtja91Dybf2FdN4hZbDLyKVxxhAu",
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
    poly: "TFbotxCdaph4U4YheVg2tmCyNGheFEGw4N",
    merkleDistributors: {
      main: "TUQb328PQfbredVY3qUD9NZ6DipFxSRZ84",
      usdd: "TMoWFKhkyKUNtxm7P2pMyM7TsVkX9zB7sm",
      strx: "TZETgfTfiPdGm1HkoBktAnpWNjNx4c4did",
      multi: "TQvh3Q94PchENyF2iM7uJH338CcWUfHxMG",
    },
    strx: {
      proxy: "TZ8du1HkatTWDbS6FLZei4dQfjfpSm9mxp",
      market: "TSos1xxjqMrGKBxycVmtgrnFvv9M6FDFUX",
    },
    energyRateModel: "TFHzFfBCS8hWV19v1psMZPg4TcWNc1W5LB",
    jTokens: {
      // ====================================================================
      // 活跃市场 (isValid=1, mintPaused=0)
      // ====================================================================
      jTRX: {
        address: "TKM7w4qFmkXQLEF2MgrQroBYpd5TY7i1pq",
        underlying: "",
        symbol: "jTRX",
        underlyingSymbol: "TRX",
        decimals: 8,
        underlyingDecimals: 6,
      },
      jUSDT: {
        address: "TT6Qk1qrBM4MgyskYZx5pjeJjvv3fdL2ih",
        underlying: "TPYwAC9Y4uUcT2QH3WPPjqxzJSJWymMoMS",  // 🔧 修复：原为 TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf
        symbol: "jUSDT",
        underlyingSymbol: "USDT",
        decimals: 8,
        underlyingDecimals: 6,
      },
      jUSDD: {
        address: "TBqtwZhjP49heKsoTHeX5MhKBJMmyuP88b",
        underlying: "TZ78R2E6ejfFhxq8hxrmuqT6hGBxjHQbo4",
        symbol: "jUSDD",
        underlyingSymbol: "USDD",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jwstUSDT: {                                            // 🆕 新增市场
        address: "TLxZWG4C9AmTjw5KTF24pDwD8DBt6o7gpP",
        underlying: "TQuaRvcTVquWNKWGiA4zVgcy1ChXNX7p54",
        symbol: "jwstUSDT",
        underlyingSymbol: "wstUSDT",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jsTRX: {
        address: "TBUYv5QnyVV4uV2RYjoouHhmsHMGqr8vj7",
        underlying: "TZ8du1HkatTWDbS6FLZei4dQfjfpSm9mxp",
        symbol: "jsTRX",
        underlyingSymbol: "sTRX",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jSUN: {
        address: "TYf16sZLR9uXpm63bXsRCNQMQFvqqvXQ2t",
        underlying: "TESJCkrX1rrNgJNb69b4vUJzSNBn1B8iZC",  // 🔧 修复：原为 TDqjTkZ63yHB19w2n7vPm2qAkLHwn9fKKk
        symbol: "jSUN",
        underlyingSymbol: "SUN",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jBTT: {
        address: "TPovsintcLMh9udvXgt45jvb1RYQ86imnL",
        underlying: "TBagxx57zx73VJJ61o12VfxzQ2EG3KHYJp",  // 🔧 修复：原为 TVSvjZdyDSNocHm7dP3jvCmMNsCnMTPa5W
        symbol: "jBTT",
        underlyingSymbol: "BTT",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jNFT: {
        address: "TMBRbGrkx2d3m8nAZWezFzSyJG6KrEGjj1",
        underlying: "TWZ7nrMxQiGQ499D1BXpB42S7EtRa926nN",
        symbol: "jNFT",
        underlyingSymbol: "NFT",
        decimals: 8,
        underlyingDecimals: 6,
      },
      jJST: {
        address: "TXNg6MoDTDEZKwPzTAdnzdQwfTF4LdU1QW",
        underlying: "TJqk3ChKSjmpoNm3gaqSEatNsueD37NGDK",
        symbol: "jJST",
        underlyingSymbol: "JST",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jWIN: {
        address: "TZ51C31Zh3qBSRBnTmbcuRX1rqyhzoCe8Q",
        underlying: "TLdhbJkAxt3UxUyY7DpnkDt6uiDTyHeRNd",
        symbol: "jWIN",
        underlyingSymbol: "WIN",
        decimals: 8,
        underlyingDecimals: 6,
      },
      jUSD1: {                                               // 🆕 新增市场
        address: "TNPnMcpU5VuYREYnLh86tGzRGBkAyeo6Yh",
        underlying: "TM3H36y6i8U6ju3xjo6vipsLM1pw5yT8Qs",
        symbol: "jUSD1",
        underlyingSymbol: "USD1",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jTUSD: {
        address: "TXFDQpnXxNSEsxo8R3brAaTMWk4Nv6uGji",
        underlying: "THpYaJaY3wcGbkhEjQH6mW8uhNncP1CJYz",
        symbol: "jTUSD",
        underlyingSymbol: "TUSD",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jWBTC: {                                               // 🆕 新增市场
        address: "TAhR7YtYGeVJK3rE2nocnBjPpgZtFJbAXX",
        underlying: "TW714k8Ni3g7yiHUUckXXuSdCPqFmNXZis",
        symbol: "jWBTC",
        underlyingSymbol: "WBTC",
        decimals: 8,
        underlyingDecimals: 8,
      },
      jBTC: {
        address: "TBGCExAC3iRk5EXAVXEer3bwhTi9EN9rht",
        underlying: "TSkW3KiyHNbS9ozn99PHZz6rz1V2DMBFVa",
        symbol: "jBTC",
        underlyingSymbol: "BTC",
        decimals: 8,
        underlyingDecimals: 8,
      },
      jETH: {
        address: "TYVr8QECrDkf6EAiKehok5FF3ckWV5Ds7k",
        underlying: "TTynJcuXkXUMBBU6ReC437eG4qafq9qU98",
        symbol: "jETH",
        underlyingSymbol: "ETH",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jETHB: {
        address: "TCfbfFMTGopUsVEonZFN8MXqp736bjs6R6",
        underlying: "TShDNG1PqRat9DEWDFYahrrBE4Hs7GxYQy",
        symbol: "jETHB",
        underlyingSymbol: "ETHB",
        decimals: 8,
        underlyingDecimals: 18,                              // 🔧 修复：原为 6，API 显示 collateralDecimal=18
      },
      jHTX: {                                                // 🆕 新增市场
        address: "TD6FMHLmG4uGq9JqVuSX1NgvBeS2HbuRAt",
        underlying: "TC9wyHyAQqnvz6oQBfoLMu4kJpfqdp9nMY",
        symbol: "jHTX",
        underlyingSymbol: "HTX",
        decimals: 8,
        underlyingDecimals: 18,
      },

      // ====================================================================
      // 已暂停/遗留市场 (mintPaused=1 或 QA 测试市场)
      // ====================================================================
      jUSDD_OLD: {
        address: "TRM3faiTDB9D4Vq4mwezUeo5rQLzCDqGSE",
        underlying: "THfS8gUDH5Cx1FnwvdQ2QfBdCHyeNDaKzs",
        symbol: "jUSDD_OLD",
        underlyingSymbol: "USDDOLD",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jUSDJ: {
        address: "TLBoPBNAfrBPxq3rTQzSKzTXrRjjAqaiJ6",
        underlying: "TMTqj3nkT9jFfGniT8Fw8qSmfiZ42Yhqjb",
        symbol: "jUSDJ",
        underlyingSymbol: "USDJ",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jWBTT: {
        address: "TAj5XxJtkrEDvTT7mTsS3uqMcvSCp82cnR",
        underlying: "TSrZn7QRYdZdn8MiK3QY7JurQe8EHbxNdS",
        symbol: "jWBTT",
        underlyingSymbol: "WBTT",
        decimals: 8,
        underlyingDecimals: 6,
      },
      jSUNOLD: {
        address: "TQ7JUeFHWAxNru1Yp8YjPP3c7guZSe4e2E",
        underlying: "TD3Q1BmkxNGCz5VkzyL4S6gqw5YwHQZHNL",
        symbol: "jSUNOLD",
        underlyingSymbol: "SUNOLD",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jUSDCOLD: {                                            // 🔧 重命名：原为 jUSDC，与 API 的 USDCOLD 对齐
        address: "TMsoCkr2yhukcGnvjhVk8Gj541BCQPEHwm",
        underlying: "TM1Xq1HHd5RTcR4VAiQ8oV6CQvfVdn3F1f",  // 🔧 修复：原为 TWMCMCoJPqCGw5RR7eChF2HoY3a9B8eYA3
        symbol: "jUSDCOLD",
        underlyingSymbol: "USDCOLD",
        decimals: 8,
        underlyingDecimals: 6,
      },
      jBUSDOLD: {                                            // 🆕 新增市场
        address: "TTNcbZWxaeUSq81HJ4uY1SpyVsKykUX97W",
        underlying: "TBEzkiB2JUevVNLUnnD8NtCYnnaE9XeviM",
        symbol: "jBUSDOLD",
        underlyingSymbol: "BUSDOLD",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jsTRX2: {                                              // 🆕 新增：第二个 sTRX 市场 (id=21)
        address: "TSdoXvEqv68xhsvjbDyaMJPNYRhfhnHHCS",
        underlying: "TZ8du1HkatTWDbS6FLZei4dQfjfpSm9mxp",
        symbol: "jsTRX2",
        underlyingSymbol: "sTRX",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jwstUSDTqa: {                                          // 🆕 新增 QA 测试市场
        address: "TCC5apD2j49ENCFoNg1J2ewiaGaB8N6rzX",
        underlying: "TKgoZCgeempgYabfzmM2oFYzAsYVyfDT3H",
        symbol: "jwstUSDTqa",
        underlyingSymbol: "wstUSDTqa",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jUSD1test: {                                           // 🆕 新增 QA 测试市场
        address: "TK3NzBmtrVbZkUDsnGimz3X2KuUdi5eVf6",
        underlying: "TPwHeKVsR6AHf7HvoMefWqa79CQ2vTmCES",
        symbol: "jUSD1test",
        underlyingSymbol: "USD1-test",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jETHQA: {                                              // 🆕 新增 QA 测试市场
        address: "TKL3bPaPu9UoJcQHuvcC2jLqNnVgCere68",
        underlying: "TWCKXq9T3ujpdRMahXndBGmWWhV3WumSMy",
        symbol: "jETHQA",
        underlyingSymbol: "ETHQA",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jBUSDqa1: {                                            // 🆕 新增 QA 测试市场
        address: "TH9QTJEastYJqeuQnABCyo9Gce7dNuA9wj",
        underlying: "TBEzkiB2JUevVNLUnnD8NtCYnnaE9XeviM",
        symbol: "jBUSDqa1",
        underlyingSymbol: "BUSDqa1",
        decimals: 8,
        underlyingDecimals: 18,
      },
      jBUSDqa2: {                                            // 🆕 新增 QA 测试市场
        address: "TK8WHNA8mAaT8YYcmChMREPsqBGE5aCBLJ",
        underlying: "TBEzkiB2JUevVNLUnnD8NtCYnnaE9XeviM",
        symbol: "jBUSDqa2",
        underlyingSymbol: "BUSDqa2",
        decimals: 8,
        underlyingDecimals: 18,
      },
    },
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

/**
 * JustLend API host per network. Centralised to avoid duplication across services.
 */
const JUSTLEND_API_HOSTS: Record<string, string> = {
  mainnet: "https://labc.ablesdxd.link",
  nile: "https://nileapi.justlend.org",
};

export function getApiHost(network: string = DEFAULT_NETWORK): string {
  const n = network.toLowerCase();
  if (n === "mainnet" || n === "tron" || n === "trx") return JUSTLEND_API_HOSTS.mainnet;
  if (n === "nile" || n === "testnet") return JUSTLEND_API_HOSTS.nile;
  return JUSTLEND_API_HOSTS.mainnet;
}
