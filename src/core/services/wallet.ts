import {
  resolveWallet,
  resolveWalletProvider,
  ConfigWalletProvider,
  SecureKVStore,
  type Wallet,
  type WalletConfig,
} from "@bankofai/agent-wallet";
import { randomBytes } from "crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, unlinkSync, writeSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { TronWeb } from "tronweb";
import { getNetworkConfig } from "../chains.js";
import { getGlobalNetwork, getSessionState, getWalletMode, setActiveWalletId, type SessionState } from "./global.js";
import { TronWalletSigner } from "../browser-signer.js";

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

interface SessionWalletCache {
  walletPromise?: Promise<Wallet>;
  addressPromise?: Promise<string>;
}

// Wallet objects and addresses are security context, so cache them by the
// AsyncLocalStorage session object instead of in process-global variables.
const sessionWalletCaches = new WeakMap<SessionState, SessionWalletCache>();

function getSessionWalletCache(): SessionWalletCache {
  const session = getSessionState();
  let cache = sessionWalletCaches.get(session);
  if (!cache) {
    cache = {};
    sessionWalletCaches.set(session, cache);
  }
  return cache;
}

function selectedWalletId(provider: ConfigWalletProvider, persistDefault = true): string | null {
  const session = getSessionState();
  const wallets = provider.listWallets();
  if (wallets.length === 0) return null;

  if (session.activeWalletId) {
    if (!wallets.some(([id]) => id === session.activeWalletId)) {
      throw new Error(`Wallet '${session.activeWalletId}' is not configured.`);
    }
    return session.activeWalletId;
  }

  const defaultId = provider.getActiveId() || wallets[0][0];
  if (persistDefault) session.activeWalletId = defaultId;
  return defaultId;
}

async function resolveSessionWallet(): Promise<Wallet> {
  let provider: ReturnType<typeof resolveWalletProvider>;
  try {
    provider = resolveWalletProvider({ network: "tron" });
  } catch {
    // Keep the legacy auto-init fallback for resolver implementations that
    // throw before a provider can be returned (and for older agent-wallet
    // adapters used by downstream integrations).
    const created = await autoInitWallet();
    setActiveWalletId(created.walletId);
    return resolveWallet({ network: "tron" });
  }

  if (!(provider instanceof ConfigWalletProvider)) {
    try {
      return await provider.getActiveWallet("tron");
    } catch {
      // Preserve the existing first-use auto-init behavior when no env wallet
      // is configured, then resolve the newly created wallet for this session.
      const created = await autoInitWallet();
      setActiveWalletId(created.walletId);
      try {
        provider = resolveWalletProvider({ network: "tron" });
      } catch {
        return resolveWallet({ network: "tron" });
      }
      if (!(provider instanceof ConfigWalletProvider)) return provider.getActiveWallet("tron");
    }
  }

  if (provider.listWallets().length === 0) {
    const created = await autoInitWallet();
    setActiveWalletId(created.walletId);
    try {
      provider = resolveWalletProvider({ network: "tron" });
    } catch {
      return resolveWallet({ network: "tron" });
    }
    if (!(provider instanceof ConfigWalletProvider)) {
      return provider.getActiveWallet("tron");
    }
  }

  const walletId = selectedWalletId(provider);
  if (!walletId) throw new Error("No configured agent wallet is available.");
  return provider.getWallet(walletId, "tron");
}

function clearSessionWalletCache(): void {
  sessionWalletCaches.delete(getSessionState());
}

export function getBrowserSigner(): TronWalletSigner {
  const session = getSessionState();
  if (session.browserSigner instanceof TronWalletSigner) {
    return session.browserSigner;
  }
  const signer = new TronWalletSigner();
  session.browserSigner = signer;
  return signer;
}

export async function shutdownBrowserSignerForSession(session: SessionState): Promise<void> {
  if (!(session.browserSigner instanceof TronWalletSigner)) return;
  const signer = session.browserSigner;
  session.browserSigner = undefined;
  await signer.shutdown();
}

/** Resolve the agent-wallet config directory. */
function getConfigDir(): string {
  return process.env.AGENT_WALLET_DIR || join(homedir(), ".agent-wallet");
}

/**
 * Resolve a local_secure secret for providers created by this module.
 *
 * `ConfigWalletProvider` intentionally does not install a default secret
 * loader when instantiated directly (the resolver supplies one).  Auto-init
 * and import create providers directly, so they must wire the same verified
 * loader or every subsequent getWallet() call fails closed.
 */
function loadLocalSecret(configDir: string, password: string, secretRef: string): Uint8Array {
  const kvStore = new SecureKVStore(configDir, password);
  kvStore.verifyPassword();
  return kvStore.loadSecret(secretRef);
}

const WALLET_INIT_LOCK_TIMEOUT_MS = 30_000;
const WALLET_INIT_LOCK_RETRY_MS = 25;

/**
 * Serialize first-use wallet creation across MCP worker processes.
 *
 * Wallet material and the `default` record are shared files, so an in-process
 * promise is insufficient when the HTTP/MCP server is scaled to multiple
 * workers.  An atomic `open(..., "wx")` lock keeps the check-and-create
 * sequence together; a stale lock fails closed after the bounded wait rather
 * than silently generating another account.
 */
async function withWalletInitLock<T>(configDir: string, operation: () => Promise<T>): Promise<T> {
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
    try { chmodSync(configDir, 0o700); } catch { /* Windows / best-effort */ }
  }

  const lockPath = join(configDir, ".auto-init.lock");
  const deadline = Date.now() + WALLET_INIT_LOCK_TIMEOUT_MS;
  let lockFd: number | undefined;
  while (lockFd === undefined) {
    try {
      lockFd = openSync(lockPath, "wx", 0o600);
      writeSync(lockFd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n");
    } catch (error: any) {
      if (lockFd !== undefined) {
        try { closeSync(lockFd); } catch { /* best-effort */ }
        lockFd = undefined;
      }
      if (error?.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new Error("Wallet initialization is already in progress or left a stale lock; refusing to create another wallet.");
      }
      await new Promise((resolve) => setTimeout(resolve, WALLET_INIT_LOCK_RETRY_MS));
    }
  }

  try {
    return await operation();
  } finally {
    try { closeSync(lockFd); } catch { /* best-effort */ }
    try { unlinkSync(lockPath); } catch { /* best-effort */ }
  }
}

/**
 * Guard the insecure auto-init mode that persists a random encryption password
 * to `runtime_secrets.json` next to the ciphertext. Refuse unless the operator
 * explicitly opts in via ALLOW_INSECURE_RUNTIME_SECRETS=true.
 */
function assertInsecureRuntimeSecretsAllowed(): void {
  if (process.env.ALLOW_INSECURE_RUNTIME_SECRETS === "true") return;
  throw new Error(
    "Refusing to auto-generate a wallet encryption password and write it to " +
    "runtime_secrets.json next to the encrypted store: this reduces at-rest " +
    "encryption to obfuscation. Set AGENT_WALLET_PASSWORD (held only in memory) " +
    "instead. To explicitly accept the insecure legacy " +
    "behavior, set ALLOW_INSECURE_RUNTIME_SECRETS=true.",
  );
}

/**
 * Restrict the runtime_secrets.json file itself to owner-only (0o600).
 * The parent directory is already chmod 0o700, but the file holding the
 * plaintext password must not be readable by other users either.
 */
function secureRuntimeSecretsFile(configDir: string): void {
  try {
    chmodSync(join(configDir, "runtime_secrets.json"), 0o600);
  } catch { /* Windows / best-effort */ }
}

/**
 * Auto-generate an encrypted wallet if none exists.
 * Creates ~/.agent-wallet/ directory, initializes the encrypted store, generates
 * a private key, and registers it as the active wallet.
 *
 * Password source order:
 *   1. AGENT_WALLET_PASSWORD env var (preferred — password never touches disk)
 *   2. Random 32-byte password saved to runtime_secrets.json (legacy auto-init).
 *      In this mode the at-rest encryption is effectively obfuscation because
 *      the key sits next to the ciphertext. A loud warning is emitted so the
 *      operator knows to set AGENT_WALLET_PASSWORD
 *      before holding any meaningful balance.
 *
 * @returns The new wallet address, or null if wallets already exist.
 */
export async function autoInitWallet(): Promise<{ address: string; walletId: string; created: boolean }> {
  const configDir = getConfigDir();

  // Try to resolve an existing wallet first. Only the provider lookup and the
  // "no wallet yet" case fall through to creation; a selected session wallet
  // that disappeared must fail rather than silently creating another account.
  let existingProvider: ReturnType<typeof resolveWalletProvider> | undefined;
  try {
    existingProvider = resolveWalletProvider({ network: "tron" });
  } catch {
    existingProvider = undefined;
  }
  if (existingProvider instanceof ConfigWalletProvider) {
    const wallets = existingProvider.listWallets();
    if (wallets.length > 0) {
      const walletId = selectedWalletId(existingProvider);
      if (!walletId) throw new Error("No configured agent wallet is available.");
      const wallet = await existingProvider.getWallet(walletId, "tron");
      const address = await wallet.getAddress();
      return { address, walletId, created: false };
    }
  } else if (existingProvider) {
    try {
      const wallet = await existingProvider.getActiveWallet("tron");
      const address = await wallet.getAddress();
      return { address, walletId: "env", created: false };
    } catch {
      // No env wallet — proceed to create one.
    }
  }

  // ── Create a new encrypted wallet ──
  return withWalletInitLock(configDir, async () => {
    // Re-check after taking the cross-process lock. Another worker may have
    // completed initialization while this request was waiting.
    let providerAfterLock: ReturnType<typeof resolveWalletProvider> | undefined;
    try {
      providerAfterLock = resolveWalletProvider({ network: "tron" });
    } catch {
      providerAfterLock = undefined;
    }
    if (providerAfterLock instanceof ConfigWalletProvider) {
      const wallets = providerAfterLock.listWallets();
      if (wallets.length > 0) {
        const walletId = selectedWalletId(providerAfterLock);
        if (!walletId) throw new Error("No configured agent wallet is available.");
        const wallet = await providerAfterLock.getWallet(walletId, "tron");
        const address = await wallet.getAddress();
        return { address, walletId, created: false };
      }
    } else if (providerAfterLock) {
      try {
        const wallet = await providerAfterLock.getActiveWallet("tron");
        const address = await wallet.getAddress();
        return { address, walletId: "env", created: false };
      } catch {
        // No env wallet — continue with local creation while holding the lock.
      }
    }

    // 1. Resolve the encryption password.
    const envPassword = process.env.AGENT_WALLET_PASSWORD?.trim() || null;
    if (!envPassword) {
      // Refuse the insecure auto-init mode by default: writing the encryption
      // password next to the ciphertext reduces at-rest encryption to obfuscation.
      // Require explicit, conscious opt-in via ALLOW_INSECURE_RUNTIME_SECRETS=true.
      assertInsecureRuntimeSecretsAllowed();
    }
    const password = envPassword ?? randomBytes(32).toString("hex");
    const provider = new ConfigWalletProvider(configDir, password, {
      network: "tron",
      secretLoader: loadLocalSecret,
    });
    provider.ensureStorage();
    if (envPassword) {
      console.error(
        `[agent-wallet] AGENT_WALLET_PASSWORD provided; encryption key is NOT written to disk. ` +
        `Keep the env var safe — losing it makes the wallet unrecoverable.`,
      );
    } else {
      provider.saveRuntimeSecrets(password);
      secureRuntimeSecretsFile(configDir);
      console.error(
        `[agent-wallet] WARNING: auto-generated encryption password was written to ` +
        `${join(configDir, "runtime_secrets.json")} alongside the encrypted store. ` +
        `At-rest encryption is effectively obfuscation in this mode. ` +
        `For any meaningful balance, set AGENT_WALLET_PASSWORD before first run ` +
        `so the password is held only in memory.`,
      );
    }

    // 2. Initialize encrypted store (master.json) and generate private key.
    const kvStore = new SecureKVStore(configDir, password);
    kvStore.initMaster();

    const walletId = "default";
    kvStore.generateSecret(walletId, { length: 32 });

    // 3. Register the wallet as local_secure type.
    provider.addWallet(walletId, {
      type: "local_secure",
      params: { secret_ref: walletId },
    } as WalletConfig, { setActiveIfMissing: true });

    // 4. Resolve the new wallet and get its address.
    const wallet = await provider.getWallet(walletId, "tron");
    const address = await wallet.getAddress();

    // Bind the newly created wallet only to the current session.
    setActiveWalletId(walletId);
    clearSessionWalletCache();

    return { address, walletId, created: true };
  });
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
  let password = process.env.AGENT_WALLET_PASSWORD?.trim() || null;
  let passwordIsRuntimeGenerated = false;
  try {
    const existingProvider = resolveWalletProvider({ network: "tron" });
    if (!password && existingProvider instanceof ConfigWalletProvider) {
      password = existingProvider.loadRuntimeSecretsPassword() || password;
    }
  } catch { /* no existing provider */ }

  if (!password) {
    // No env password and no pre-existing runtime secret: we would have to
    // generate a random password and persist it next to the ciphertext, which
    // degrades at-rest encryption to obfuscation. Require explicit opt-in.
    assertInsecureRuntimeSecretsAllowed();
    password = randomBytes(32).toString("hex");
    passwordIsRuntimeGenerated = true;
  }

  const provider = new ConfigWalletProvider(configDir, password, {
    network: "tron",
    secretLoader: loadLocalSecret,
  });
  provider.ensureStorage();
  // Only the explicitly opted-in, generated fallback may write a plaintext
  // password. An operator-supplied env password must remain memory-only, even
  // when no runtime_secrets.json exists or the legacy opt-in is also set.
  if (passwordIsRuntimeGenerated && !provider.hasRuntimeSecrets()) {
    provider.saveRuntimeSecrets(password);
    secureRuntimeSecretsFile(configDir);
    console.error(
      `[agent-wallet] WARNING: auto-generated encryption password was written to ` +
      `${join(configDir, "runtime_secrets.json")} alongside the encrypted store. ` +
      `At-rest encryption is effectively obfuscation in this mode. ` +
      `Set AGENT_WALLET_PASSWORD instead of persisting the encryption key beside the wallet.`,
    );
  }

  // Initialize master if needed
  const masterPath = join(configDir, "master.json");
  const kvStore = new SecureKVStore(configDir, password);
  if (!existsSync(masterPath)) {
    kvStore.initMaster();
  }

  // Make wallet ID unique if it already exists
  let finalId = walletId;
  const existing = provider.listWallets().map(([id]) => id);
  if (existing.includes(finalId)) {
    let counter = 1;
    while (existing.includes(`${walletId}-${counter}`)) counter++;
    finalId = `${walletId}-${counter}`;
  }

  // Save the private key encrypted under the final unique wallet ID so the
  // wallet record and secret reference cannot drift apart.
  const keyBytes = Buffer.from(privateKeyHex.replace(/^0x/, ""), "hex");
  if (keyBytes.length !== 32) {
    keyBytes.fill(0);
    throw new Error("Invalid private key: must be 32 bytes (64 hex characters)");
  }
  try {
    kvStore.saveSecret(finalId, keyBytes);
  } finally {
    keyBytes.fill(0);
  }

  provider.addWallet(finalId, {
    type: "local_secure",
    params: { secret_ref: finalId },
  } as WalletConfig, { setActiveIfMissing: true });

  const wallet = await provider.getWallet(finalId, "tron");
  const address = await wallet.getAddress();

  // The importing session should use the wallet it just imported. Other HTTP
  // sessions retain their own selection/cache.
  setActiveWalletId(finalId);
  clearSessionWalletCache();

  return { address, walletId: finalId };
}

/**
 * Read the current agent-wallet address without creating a new wallet.
 * Returns null if no agent wallet is configured yet.
 */
export async function getExistingAgentWalletAddress(): Promise<string | null> {
  try {
    const provider = resolveWalletProvider({ network: "tron" });
    if (provider instanceof ConfigWalletProvider) {
      const wallets = provider.listWallets();
      if (wallets.length === 0) return null;
      const walletId = selectedWalletId(provider);
      if (!walletId) return null;
      const wallet = await provider.getWallet(walletId, "tron");
      return wallet.getAddress();
    }

    const wallet = await provider.getActiveWallet("tron");
    return wallet.getAddress();
  } catch (err: any) {
    console.warn(`[getExistingAgentWalletAddress] failed: ${err?.message ?? err}`);
    return null;
  }
}

/**
 * Get the agent-wallet Wallet instance for signing.
 * Uses @bankofai/agent-wallet for secure key storage — private keys never
 * appear in environment variables or application memory.
 */
export function getAgentWallet(): Promise<Wallet> {
  const cache = getSessionWalletCache();
  if (!cache.walletPromise) {
    cache.walletPromise = resolveSessionWallet().catch((error) => {
      cache.walletPromise = undefined;
      throw error;
    });
  }
  return cache.walletPromise;
}

/**
 * Get the configured wallet address.
 * Browser mode is retained only as a fail-closed compatibility value; agent
 * mode returns the configured agent-wallet address.
 */
export async function getWalletAddress(): Promise<string> {
  const mode = getWalletMode();

  if (mode === "browser") {
    throw new Error(
      "Browser wallet mode is disabled because its legacy loopback bridge lacks request-level authentication. " +
      "Switch to agent mode.",
    );
  }

  if (mode === "unset") {
    throw new Error(
      "Wallet mode not selected. Use set_wallet_mode with mode='agent' and configure AGENT_WALLET_PASSWORD.",
    );
  }

  const cache = getSessionWalletCache();
  if (!cache.addressPromise) {
    cache.addressPromise = getAgentWallet().then((wallet) => wallet.getAddress()).catch((error) => {
      cache.addressPromise = undefined;
      throw error;
    });
  }
  return cache.addressPromise;
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
 * Sign a transaction and return the signed transaction object ready for broadcasting.
 * Routes supported requests to agent-wallet. Browser mode fails closed.
 *
 * NOTE on `description`: `@bankofai/agent-wallet` does not expose a metadata
 * channel to the underlying signing UI, so we surface the
 * description to the MCP server's stderr log (the standard MCP log channel)
 * just before signing. Operators running stdio-mode see it directly; HTTP-mode
 * operators see it in server logs.
 */
function isSignatureHex(value: unknown): value is string {
  return typeof value === "string" && /^(0x)?[0-9a-fA-F]+$/.test(value) && value.length >= 64;
}

interface SignedTxShape {
  signature: string[];
  txID?: string;
}

function extractSignature(resolved: unknown): string[] {
  if (resolved && typeof resolved === "object" && Array.isArray((resolved as SignedTxShape).signature)) {
    return (resolved as SignedTxShape).signature;
  }
  if (isSignatureHex(resolved)) {
    return [resolved];
  }
  throw new Error(
    `Signer returned malformed response: expected a hex signature or { signature: string[] }, got ${JSON.stringify(resolved)}`,
  );
}

export async function signTransactionWithWallet(
  unsignedTx: any,
  description?: string,
  network = getGlobalNetwork(),
): Promise<any> {
  if (description) {
    console.error(`[sign] ${description}`);
  }

  if (getWalletMode() === "browser") {
    throw new Error("Browser wallet signing is disabled because the legacy loopback bridge is unauthenticated.");
  }

  const wallet = await getAgentWallet();
  const signed = await wallet.signTransaction(unsignedTx);

  // wallet.signTransaction may return:
  // 1. A JSON string of the full signed transaction → parse and extract signature
  // 2. A full signed transaction object (with signature[] already embedded)
  // 3. Just the signature hex string
  let resolved: unknown = signed;
  if (typeof signed === "string") {
    try {
      resolved = JSON.parse(signed);
    } catch {
      if (!isSignatureHex(signed)) {
        throw new Error(`Signer returned malformed hex signature: ${signed}`);
      }
      return { ...unsignedTx, signature: [signed] };
    }
  }
  return { ...unsignedTx, signature: extractSignature(resolved) };
}

/**
 * Sign an arbitrary message.
 * Routes supported requests to agent-wallet; browser mode fails closed.
 * @returns Signature as a hex string.
 */
export async function signMessage(message: string): Promise<string> {
  if (getWalletMode() === "browser") {
    throw new Error("Browser wallet signing is disabled because the legacy loopback bridge is unauthenticated.");
  }

  const wallet = await getAgentWallet();
  const msgBytes = new TextEncoder().encode(message);
  return wallet.signMessage(msgBytes);
}

/**
 * Sign typed data (EIP-712 / TRON-712).
 * Routes supported requests to agent-wallet; browser mode fails closed.
 */
export async function signTypedData(
  domain: object,
  types: object,
  value: object,
): Promise<string> {
  if (getWalletMode() === "browser") {
    throw new Error("Browser wallet signing is disabled because the legacy loopback bridge is unauthenticated.");
  }

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
      const activeId = selectedWalletId(provider);
      const wallets: WalletInfo[] = [];

      for (const [id, config] of walletList) {
        const info: WalletInfo = { id, type: config.type, isActive: id === activeId };
        try {
          const w = await provider.getWallet(id, "tron");
          info.address = await w.getAddress();
        } catch (err: any) {
          console.warn(`[checkWalletStatus] cannot resolve wallet "${id}": ${err?.message ?? err}`);
        }
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
    // Validate existence without mutating the provider-global durable active
    // wallet. The selection belongs to the current HTTP/SSE session.
    provider.getWalletConfig(walletId);
    setActiveWalletId(walletId);
    clearSessionWalletCache();
    return { success: true, message: `Active wallet set to "${walletId}".` };
  } catch (error: any) {
    return { success: false, message: `Failed to set active wallet: ${error.message}` };
  }
}
