import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listWalletsMock = vi.fn();
const ensureStorageMock = vi.fn();
const hasRuntimeSecretsMock = vi.fn(() => true);
const saveRuntimeSecretsMock = vi.fn();
const getActiveIdMock = vi.fn(() => "existing");
const setActiveMock = vi.fn();
const addWalletMock = vi.fn();
const getWalletMock = vi.fn(async () => ({
  getAddress: vi.fn(async () => "TImportedWalletAddress12345678901234"),
}));

const saveSecretMock = vi.fn();
const initMasterMock = vi.fn();
const providerConstructorMock = vi.fn();
const loadRuntimeSecretsPasswordMock = vi.fn();
const resolveWalletProviderMock = vi.fn();

vi.mock("@bankofai/agent-wallet", () => {
  class MockConfigWalletProvider {
    constructor(...args: unknown[]) { providerConstructorMock(...args); }
    loadRuntimeSecretsPassword = loadRuntimeSecretsPasswordMock;
    ensureStorage = ensureStorageMock;
    hasRuntimeSecrets = hasRuntimeSecretsMock;
    saveRuntimeSecrets = saveRuntimeSecretsMock;
    listWallets = listWalletsMock;
    getActiveId = getActiveIdMock;
    setActive = setActiveMock;
    addWallet = addWalletMock;
    getWallet = getWalletMock;
  }

  class MockSecureKVStore {
    initMaster = initMasterMock;
    saveSecret = saveSecretMock;
  }

  return {
    resolveWallet: vi.fn(),
    resolveWalletProvider: resolveWalletProviderMock,
    ConfigWalletProvider: MockConfigWalletProvider,
    SecureKVStore: MockSecureKVStore,
  };
});

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    chmodSync: vi.fn(),
  };
});

describe("importWallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Allow the legacy auto-generated runtime-secret path exercised by these tests.
    vi.stubEnv("ALLOW_INSECURE_RUNTIME_SECRETS", "true");
    vi.stubEnv("AGENT_WALLET_PASSWORD", undefined);
    resolveWalletProviderMock.mockImplementation(() => { throw new Error("no existing provider"); });
    listWalletsMock.mockReturnValue([["imported", { type: "local_secure" }, true]]);
    hasRuntimeSecretsMock.mockReturnValue(true);
    getActiveIdMock.mockReturnValue("existing");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stores the secret and wallet config under the final unique wallet id", async () => {
    const { importWallet } = await import("../../../src/core/services/wallet.js");

    const privateKey = "11".repeat(32);
    const result = await importWallet(privateKey, "imported");

    expect(result.walletId).toBe("imported-1");
    expect(saveSecretMock).toHaveBeenCalledTimes(1);
    expect(saveSecretMock.mock.calls[0][0]).toBe("imported-1");
    expect(addWalletMock).toHaveBeenCalledTimes(1);
    expect(addWalletMock.mock.calls[0][0]).toBe("imported-1");
    expect(addWalletMock.mock.calls[0][1]).toMatchObject({
      type: "local_secure",
      params: { secret_ref: "imported-1" },
    });
  });

  it.each([undefined, "true"])("keeps an env password off disk even with legacy opt-in %s", async (optIn) => {
    vi.stubEnv("AGENT_WALLET_PASSWORD", "  audit-env-password  ");
    vi.stubEnv("ALLOW_INSECURE_RUNTIME_SECRETS", optIn);
    hasRuntimeSecretsMock.mockReturnValue(false);
    const { importWallet } = await import("../../../src/core/services/wallet.js");

    await importWallet("11".repeat(32));

    expect(providerConstructorMock).toHaveBeenLastCalledWith(expect.any(String), "audit-env-password", expect.any(Object));
    expect(saveRuntimeSecretsMock).not.toHaveBeenCalled();
    expect(saveSecretMock).toHaveBeenCalledTimes(1);
  });

  it("does not replace an explicit env password with a legacy saved password", async () => {
    vi.stubEnv("AGENT_WALLET_PASSWORD", "audit-env-password");
    const { ConfigWalletProvider } = await import("@bankofai/agent-wallet");
    const existing = new ConfigWalletProvider("unused", "legacy");
    resolveWalletProviderMock.mockReturnValue(existing);
    loadRuntimeSecretsPasswordMock.mockReturnValue("legacy-password");
    const { importWallet } = await import("../../../src/core/services/wallet.js");

    await importWallet("11".repeat(32));

    expect(loadRuntimeSecretsPasswordMock).not.toHaveBeenCalled();
    expect(providerConstructorMock).toHaveBeenLastCalledWith(expect.any(String), "audit-env-password", expect.any(Object));
    expect(saveRuntimeSecretsMock).not.toHaveBeenCalled();
  });

  it("fails before saving a key when generating a password has not been allowed", async () => {
    vi.stubEnv("ALLOW_INSECURE_RUNTIME_SECRETS", undefined);
    const { importWallet } = await import("../../../src/core/services/wallet.js");

    await expect(importWallet("11".repeat(32))).rejects.toThrow(/ALLOW_INSECURE_RUNTIME_SECRETS/);
    expect(saveRuntimeSecretsMock).not.toHaveBeenCalled();
    expect(saveSecretMock).not.toHaveBeenCalled();
  });

  it("retains explicit opt-in for a generated legacy password", async () => {
    hasRuntimeSecretsMock.mockReturnValue(false);
    const { importWallet } = await import("../../../src/core/services/wallet.js");

    await importWallet("11".repeat(32));

    expect(saveRuntimeSecretsMock).toHaveBeenCalledTimes(1);
    expect(saveRuntimeSecretsMock).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
  });
});
