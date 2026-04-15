import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@bankofai/agent-wallet", () => {
  class MockConfigWalletProvider {
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
    resolveWalletProvider: vi.fn(() => {
      throw new Error("no existing provider");
    }),
    ConfigWalletProvider: MockConfigWalletProvider,
    SecureKVStore: MockSecureKVStore,
  };
});

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
  };
});

describe("importWallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listWalletsMock.mockReturnValue([["imported", { type: "local_secure" }, true]]);
    hasRuntimeSecretsMock.mockReturnValue(true);
    getActiveIdMock.mockReturnValue("existing");
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
});
