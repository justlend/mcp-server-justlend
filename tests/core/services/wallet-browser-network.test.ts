import { beforeEach, describe, expect, it, vi } from "vitest";

const signTransactionMock = vi.fn(async () => ({
  signedTransaction: { signature: ["0xmock-signature"] },
}));
const signMessageMock = vi.fn(async () => ({
  signature: "0xmock-message-signature",
}));
const signTypedDataMock = vi.fn(async () => ({
  signature: "0xmock-typed-data-signature",
}));

vi.mock("../../../src/core/browser-signer.js", () => {
  class TronWalletSigner {
    async start() {
      return 3386;
    }

    getConnectedAddress() {
      return "TBrowserWallet1234567890123456789012";
    }

    async signTransaction(unsignedTx: unknown, description?: string, network?: string) {
      return signTransactionMock(unsignedTx, description, network);
    }

    async signMessage(params: { message: string; network?: string }) {
      return signMessageMock(params);
    }

    async signTypedData(typedData: Record<string, unknown>, network?: string) {
      return signTypedDataMock(typedData, network);
    }

    async shutdown() {}
  }

  return { TronWalletSigner };
});

import {
  signMessage,
  signTransactionWithWallet,
  signTypedData,
} from "../../../src/core/services/wallet.js";
import {
  createSessionState,
  runWithSessionState,
  setGlobalNetwork,
  setWalletMode,
} from "../../../src/core/services/global.js";

describe("browser signer network forwarding", () => {
  beforeEach(() => {
    signTransactionMock.mockClear();
    signMessageMock.mockClear();
    signTypedDataMock.mockClear();
  });

  it("passes the active network to browser message signing", async () => {
    const session = createSessionState("wallet-browser-sign-message");

    await runWithSessionState(session, async () => {
      setWalletMode("browser");
      setGlobalNetwork("nile");
      await signMessage("hello nile");
    });

    expect(signMessageMock).toHaveBeenCalledWith({
      message: "hello nile",
      network: "nile",
    });
  });

  it("passes the active network to browser typed-data signing", async () => {
    const session = createSessionState("wallet-browser-sign-typed-data");

    await runWithSessionState(session, async () => {
      setWalletMode("browser");
      setGlobalNetwork("nile");
      await signTypedData(
        { name: "JustLend", version: "1", chainId: 3448148188 },
        { Greeting: [{ name: "contents", type: "string" }] },
        { contents: "hello nile" },
      );
    });

    expect(signTypedDataMock).toHaveBeenCalledWith(
      {
        domain: { name: "JustLend", version: "1", chainId: 3448148188 },
        types: { Greeting: [{ name: "contents", type: "string" }] },
        message: { contents: "hello nile" },
      },
      "nile",
    );
  });

  it("passes the explicit network to browser transaction signing", async () => {
    const session = createSessionState("wallet-browser-sign-transaction");
    const unsignedTx = { txID: "mock-tx-id" };

    await runWithSessionState(session, async () => {
      setWalletMode("browser");
      setGlobalNetwork("mainnet");
      await signTransactionWithWallet(unsignedTx, "browser test tx", "nile");
    });

    expect(signTransactionMock).toHaveBeenCalledWith(
      unsignedTx,
      "browser test tx",
      "nile",
    );
  });
});
