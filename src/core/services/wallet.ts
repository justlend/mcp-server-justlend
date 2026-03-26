import {
  resolveWallet,
  resolveWalletProvider,
  ConfigWalletProvider,
  SecureKVStore,
  type Wallet,
  type WalletConfig,
} from "@bankofai/agent-wallet";
import { randomBytes } from "crypto";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { TronWeb } from "tronweb";
import { getNetworkConfig } from "../chains.js";

export interface ConfiguredWallet {
  address: string;
}

export interface WalletInfo {
  id: string;
  type: string;
  isActive: boolean;
  address?: string;
}

export interface WalletStatus {
  initialized: boolean;
  hasWallets: boolean;
  activeWalletId: string | null;
  activeAddress: string | null;
  wallets: WalletInfo[];
  message: string;
}

// Cached wallet instance from agent-wallet
let _walletPromise: Promise<Wallet> | null = null;
let _addressPromise: Promise<string> | null = null;

/** Resolve the agent-wallet config directory. */
function getConfigDir(): string {
  return process.env.AGENT_WALLET_DIR || join(homedir(), ".agent-wallet");
}

/**
 * Auto-generate an encrypted wallet if none exists.
 * Creates ~/.agent-wallet/ directory, generates a random password (saved to runtime_secrets.json),
 * initializes the encrypted store, generates a private key, and registers it as the active wallet.
 *
 * @returns The new wallet address, or null if wallets already exist.
 */
export async function autoInitWallet(): Promise<{ address: string; walletId: string; created: boolean }> {
  const configDir = getConfigDir();

  // Try to resolve an existing wallet first
  try {
    const provider = resolveWalletProvider({ network: "tron" });
    if (provider instanceof ConfigWalletProvider) {
      const wallets = provider.listWallets();
      if (wallets.length > 0) {
        // Wallets already exist — just resolve and return active
        const wallet = await provider.getActiveWallet("tron");
        const address = await wallet.getAddress();
        const activeId = provider.getActiveId() || wallets[0][0];
        return { address, walletId: activeId, created: false };
      }
    } else {
      // EnvWalletProvider — env-based wallet exists
      const wallet = await provider.getActiveWallet("tron");
      const address = await wallet.getAddress();
      return { address, walletId: "env", created: false };
    }
  } catch {
    // No existing wallet — proceed to create one
  }

  // ── Create a new encrypted wallet ──

  // 1. Ensure config directory exists
  const { mkdirSync, chmodSync } = await import("fs");
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
    try { chmodSync(configDir, 0o700); } catch { /* Windows */ }
  }

  // 2. Generate a random password and save to runtime_secrets.json
  const password = randomBytes(32).toString("hex");
  const provider = new ConfigWalletProvider(configDir, password, { network: "tron" });
  provider.ensureStorage();
  provider.saveRuntimeSecrets(password);

  // 3. Initialize encrypted store (master.json) and generate private key
  const kvStore = new SecureKVStore(configDir, password);
  kvStore.initMaster();

  const walletId = "default";
  kvStore.generateSecret(walletId, { length: 32 });

  // 4. Register the wallet as local_secure type
  provider.addWallet(walletId, {
    type: "local_secure",
    params: { secret_ref: walletId },
  } as WalletConfig, { setActiveIfMissing: true });

  // 5. Resolve the new wallet and get its address
  const wallet = await provider.getActiveWallet("tron");
  const address = await wallet.getAddress();

  // Clear any cached state so subsequent calls use the new wallet
  _walletPromise = null;
  _addressPromise = null;

  return { address, walletId, created: true };
}

/**
 * Import a wallet from a private key (hex string).
 * Stores it encrypted in agent-wallet.
 */
export async function importWallet(
  privateKeyHex: string,
  walletId = "imported",
): Promise<{ address: string; walletId: string }> {
  const configDir = getConfigDir();

  const { mkdirSync, chmodSync } = await import("fs");
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
    try { chmodSync(configDir, 0o700); } catch { /* Windows */ }
  }

  // Resolve or create password
  let password = process.env.AGENT_WALLET_PASSWORD || null;
  try {
    const existingProvider = resolveWalletProvider({ network: "tron" });
    if (existingProvider instanceof ConfigWalletProvider) {
      password = existingProvider.loadRuntimeSecretsPassword() || password;
    }
  } catch { /* no existing provider */ }

  if (!password) {
    password = randomBytes(32).toString("hex");
  }

  const provider = new ConfigWalletProvider(configDir, password, { network: "tron" });
  provider.ensureStorage();
  if (!provider.hasRuntimeSecrets()) {
    provider.saveRuntimeSecrets(password);
  }

  // Initialize master if needed
  const masterPath = join(configDir, "master.json");
  const kvStore = new SecureKVStore(configDir, password);
  if (!existsSync(masterPath)) {
    kvStore.initMaster();
  }

  // Save the private key encrypted
  const keyBytes = Buffer.from(privateKeyHex.replace(/^0x/, ""), "hex");
  if (keyBytes.length !== 32) {
    throw new Error("Invalid private key: must be 32 bytes (64 hex characters)");
  }
  kvStore.saveSecret(walletId, keyBytes);

  // Make wallet ID unique if it already exists
  let finalId = walletId;
  const existing = provider.listWallets().map(([id]) => id);
  if (existing.includes(finalId)) {
    let counter = 1;
    while (existing.includes(`${walletId}-${counter}`)) counter++;
    finalId = `${walletId}-${counter}`;
  }

  provider.addWallet(finalId, {
    type: "local_secure",
    params: { secret_ref: walletId },
  } as WalletConfig, { setActiveIfMissing: true });

  // If this is the first wallet or user wants to activate it
  if (!provider.getActiveId() || existing.length === 0) {
    provider.setActive(finalId);
  }

  const wallet = await provider.getWallet(finalId, "tron");
  const address = await wallet.getAddress();

  // Clear cache
  _walletPromise = null;
  _addressPromise = null;

  return { address, walletId: finalId };
}

/**
 * Get the agent-wallet Wallet instance for signing.
 * Uses @bankofai/agent-wallet for secure key storage — private keys never
 * appear in environment variables or application memory.
 */
export function getAgentWallet(): Promise<Wallet> {
  if (!_walletPromise) {
    _walletPromise = resolveWallet({ network: "tron" });
  }
  return _walletPromise;
}

/**
 * Get the configured wallet address from agent-wallet.
 */
export async function getWalletAddress(): Promise<string> {
  if (!_addressPromise) {
    _addressPromise = getAgentWallet().then((w) => w.getAddress());
  }
  return _addressPromise;
}

/** Alias matching the mcp-server-tron API. */
export const getWalletAddressFromKey = getWalletAddress;

/**
 * Get a TronWeb instance configured with the agent-wallet address
 * for building and broadcasting transactions. No private key is stored
 * in the TronWeb instance — signing is handled by agent-wallet.
 */
export async function getSigningClient(network = "mainnet"): Promise<TronWeb> {
  const address = await getWalletAddress();
  const config = getNetworkConfig(network);
  const n = network.toLowerCase();
  const isMainnet = ["mainnet", "tron", "trx"].includes(n);
  const apiKey = isMainnet ? process.env.TRONGRID_API_KEY : undefined;

  const client = new TronWeb({
    fullHost: config.fullNode,
    solidityNode: config.solidityNode,
    eventServer: config.eventServer,
    headers: apiKey ? { "TRON-PRO-API-KEY": apiKey } : undefined,
  });
  client.setAddress(address);
  return client;
}

/**
 * Sign a transaction using agent-wallet and return the signed transaction
 * object ready for broadcasting.
 */
export async function signTransactionWithWallet(unsignedTx: any): Promise<any> {
  const wallet = await getAgentWallet();
  const signed = await wallet.signTransaction(unsignedTx);

  // wallet.signTransaction may return:
  // 1. A JSON string of the full signed transaction → parse and extract signature
  // 2. A full signed transaction object (with signature[] already embedded)
  // 3. Just the signature hex string
  let resolved = signed;
  if (typeof signed === "string") {
    try {
      resolved = JSON.parse(signed);
    } catch {
      // It's a plain hex signature string
      return { ...unsignedTx, signature: [signed] };
    }
  }
  if (resolved && (resolved as any).signature) {
    return { ...unsignedTx, signature: (resolved as any).signature };
  }
  return { ...unsignedTx, signature: [resolved] };
}

/**
 * Sign an arbitrary message using the agent-wallet.
 * @returns Signature as a hex string.
 */
export async function signMessage(message: string): Promise<string> {
  const wallet = await getAgentWallet();
  const msgBytes = new TextEncoder().encode(message);
  return wallet.signMessage(msgBytes);
}

/**
 * Sign typed data (EIP-712 / TRON-712) using the agent-wallet.
 */
export async function signTypedData(
  domain: object,
  types: object,
  value: object,
): Promise<string> {
  const wallet = await getAgentWallet();
  // agent-wallet Wallet supports signTypedData for EIP-712
  const w = wallet as any;
  if (typeof w.signTypedData === "function") {
    return w.signTypedData({ domain, types, message: value });
  }
  throw new Error("signTypedData not supported by the current agent-wallet configuration");
}

/**
 * Check wallet status: whether agent-wallet is initialized, list wallets, active address.
 */
export async function checkWalletStatus(): Promise<WalletStatus> {
  try {
    const provider = resolveWalletProvider({ network: "tron" });

    if (provider instanceof ConfigWalletProvider) {
      const walletList = provider.listWallets();
      const activeId = provider.getActiveId();
      const wallets: WalletInfo[] = [];

      for (const [id, config, isActive] of walletList) {
        const info: WalletInfo = { id, type: config.type, isActive };
        try {
          const w = await provider.getWallet(id, "tron");
          info.address = await w.getAddress();
        } catch { /* password required or other issue */ }
        wallets.push(info);
      }

      const activeAddress = wallets.find((w) => w.isActive)?.address ?? null;

      if (wallets.length === 0) {
        return {
          initialized: provider.isInitialized(),
          hasWallets: false,
          activeWalletId: null,
          activeAddress: null,
          wallets: [],
          message: "No wallets found. A new wallet will be auto-generated on next server restart.",
        };
      }

      return {
        initialized: true,
        hasWallets: true,
        activeWalletId: activeId,
        activeAddress,
        wallets,
        message: activeAddress
          ? `Active wallet: ${activeAddress}`
          : `${wallets.length} wallet(s) found but no active wallet set.`,
      };
    }

    // EnvWalletProvider fallback — try to get address
    const wallet = await provider.getActiveWallet("tron");
    const address = await wallet.getAddress();
    return {
      initialized: true,
      hasWallets: true,
      activeWalletId: "env",
      activeAddress: address,
      wallets: [{ id: "env", type: "env", isActive: true, address }],
      message: `Active wallet (from env): ${address}`,
    };
  } catch {
    return {
      initialized: false,
      hasWallets: false,
      activeWalletId: null,
      activeAddress: null,
      wallets: [],
      message: "No wallet configured.",
    };
  }
}

/**
 * List all wallets configured in agent-wallet.
 */
export async function listWallets(): Promise<WalletInfo[]> {
  const status = await checkWalletStatus();
  return status.wallets;
}

/**
 * Set the active wallet by ID.
 */
export function setActiveWallet(walletId: string): { success: boolean; message: string } {
  try {
    const provider = resolveWalletProvider({ network: "tron" });
    if (!(provider instanceof ConfigWalletProvider)) {
      return { success: false, message: "Cannot set active wallet: using environment-based wallet provider." };
    }
    provider.setActive(walletId);
    // Clear cached wallet/address so next call uses the new active wallet
    _walletPromise = null;
    _addressPromise = null;
    return { success: true, message: `Active wallet set to "${walletId}".` };
  } catch (error: any) {
    return { success: false, message: `Failed to set active wallet: ${error.message}` };
  }
}
