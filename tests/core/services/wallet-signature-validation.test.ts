import { beforeEach, describe, expect, it, vi } from "vitest";

const agentSignMock = vi.fn<any>();
const getAddressMock = vi.fn(async () => "TAgentWallet1234567890123456789012345");

vi.mock("../../../src/core/browser-signer.js", () => {
  class TronWalletSigner {
    async start() { return 0; }
    getConnectedAddress() { return null; }
    async signTransaction() { throw new Error("not used in this test"); }
    async signMessage() { throw new Error("not used in this test"); }
    async signTypedData() { throw new Error("not used in this test"); }
    async shutdown() {}
  }
  return { TronWalletSigner };
});

vi.mock("@bankofai/agent-wallet", () => {
  return {
    resolveWallet: async () => ({
      signTransaction: agentSignMock,
      getAddress: getAddressMock,
      signMessage: async () => "0xmock",
    }),
    resolveWalletProvider: () => {
      throw new Error("no existing wallet");
    },
    ConfigWalletProvider: class {
      constructor() {}
      ensureStorage() {}
      saveRuntimeSecrets() {}
      listWallets() { return []; }
      addWallet() {}
      async getActiveWallet() { return { getAddress: getAddressMock }; }
      getActiveId() { return null; }
      hasRuntimeSecrets() { return false; }
      loadRuntimeSecretsPassword() { return null; }
      isInitialized() { return false; }
      setActive() {}
      async getWallet() { return { getAddress: getAddressMock }; }
    },
    SecureKVStore: class {
      constructor() {}
      initMaster() {}
      generateSecret() {}
      saveSecret() {}
    },
  };
});

import { signTransactionWithWallet } from "../../../src/core/services/wallet.js";
import { createSessionState, runWithSessionState, setWalletMode } from "../../../src/core/services/global.js";

describe("signTransactionWithWallet — malformed signer response", () => {
  beforeEach(() => {
    agentSignMock.mockReset();
    // These tests exercise the auto-init wallet path without a password env var.
    process.env.ALLOW_INSECURE_RUNTIME_SECRETS = "true";
  });

  it("throws a typed error when the signer returns null", async () => {
    agentSignMock.mockResolvedValueOnce(null);
    const session = createSessionState("wallet-malformed-null");
    const tx = { txID: "tx-1" };

    await expect(
      runWithSessionState(session, async () => {
        setWalletMode("agent");
        return signTransactionWithWallet(tx, "test-null", "mainnet");
      }),
    ).rejects.toThrow(/Signer returned malformed/i);
  });

  it("throws a typed error when the signer returns a non-hex string that is not JSON", async () => {
    agentSignMock.mockResolvedValueOnce("not-a-signature");
    const session = createSessionState("wallet-malformed-junk");
    const tx = { txID: "tx-2" };

    await expect(
      runWithSessionState(session, async () => {
        setWalletMode("agent");
        return signTransactionWithWallet(tx, "test-junk", "mainnet");
      }),
    ).rejects.toThrow(/Signer returned malformed hex signature/i);
  });

  it("accepts a hex signature string", async () => {
    agentSignMock.mockResolvedValueOnce(
      "1c" + "a".repeat(128),
    );
    const session = createSessionState("wallet-good-hex");
    const tx = { txID: "tx-3" };

    const result = await runWithSessionState(session, async () => {
      setWalletMode("agent");
      return signTransactionWithWallet(tx, "test-hex", "mainnet");
    });

    expect(result.signature).toEqual([
      "1c" + "a".repeat(128),
    ]);
  });

  it("accepts a JSON-stringified signed transaction with a signature array", async () => {
    agentSignMock.mockResolvedValueOnce(
      JSON.stringify({ signature: ["0xdeadbeef"], txID: "tx-4" }),
    );
    const session = createSessionState("wallet-good-json");
    const tx = { txID: "tx-4" };

    const result = await runWithSessionState(session, async () => {
      setWalletMode("agent");
      return signTransactionWithWallet(tx, "test-json", "mainnet");
    });

    expect(result.signature).toEqual(["0xdeadbeef"]);
  });
});
