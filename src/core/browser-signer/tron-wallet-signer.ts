/**
 * TRON Browser Wallet Signer — Orchestrator
 *
 * Bridges Node.js ↔ browser for TRON wallet signing via a localhost HTTP server.
 * Each signing/connect request opens a browser window, blocks until the user
 * approves or rejects in TronLink (or similar), then returns the result.
 */

import { PendingStore } from "./pending-store.js";
import { createHttpServer } from "./http-server.js";
import { buildConnectUrl, buildSignUrl, openBrowser } from "./browser.js";

const DEFAULT_PORT = 13847;

export interface TronWalletSignerOptions {
  port?: number;
  /** Control browser opening: true (default) = auto-open, false = suppress, function = custom */
  openBrowser?: boolean | ((url: string) => void | Promise<void>);
}

export interface ConnectResult {
  address: string;
  approvalUrl: string;
}

export interface SignTransactionResult {
  /** The full signed transaction object (with signature[] populated), ready for broadcast */
  signedTransaction: any;
  approvalUrl: string;
}

export interface SignMessageResult {
  signature: string;
  approvalUrl: string;
}

export class TronWalletSigner {
  private _port: number;
  private _pendingStore: PendingStore;
  private _openBrowser: (url: string) => void | Promise<void>;
  private _httpServer: { port: number; stop: () => Promise<void> } | null = null;
  private _connectedAddress: string | null = null;

  constructor(options?: TronWalletSignerOptions) {
    this._port = options?.port ?? parseInt(process.env.TRON_BROWSER_SIGNER_PORT || String(DEFAULT_PORT));
    this._pendingStore = new PendingStore();

    const ob = options?.openBrowser ?? true;
    if (typeof ob === "function") {
      this._openBrowser = ob;
    } else if (ob) {
      this._openBrowser = openBrowser;
    } else {
      this._openBrowser = () => {};
    }
  }

  get pendingStore(): PendingStore {
    return this._pendingStore;
  }

  get port(): number | null {
    return this._httpServer?.port ?? null;
  }

  getConnectedAddress(): string | null {
    return this._connectedAddress;
  }

  /** Start HTTP server explicitly. Called automatically on first request. */
  async start(): Promise<number> {
    if (this._httpServer) return this._httpServer.port;
    this._httpServer = await createHttpServer(this._pendingStore, this._port);
    console.error(`[tron-browser-signer] HTTP server listening on http://127.0.0.1:${this._httpServer.port}`);
    return this._httpServer.port;
  }

  /**
   * Connect to a browser wallet. Opens a browser window for user approval.
   * Stores the connected address for subsequent operations.
   */
  async connectWallet(options?: { address?: string; network?: string }): Promise<ConnectResult> {
    const port = await this.start();

    const { id, promise } = this._pendingStore.createConnectRequest({
      address: options?.address,
      network: options?.network,
    });

    const approvalUrl = buildConnectUrl(port, id);
    await this._openBrowser(approvalUrl);

    const result = await promise;
    if (!result.success) throw new Error(result.error);

    this._connectedAddress = result.result;
    return { address: result.result, approvalUrl };
  }

  /**
   * Sign an unsigned transaction via the browser wallet.
   * The browser calls tronWeb.trx.sign(unsignedTx) and returns the signed tx.
   * The caller is responsible for broadcasting.
   */
  async signTransaction(unsignedTx: unknown, description?: string, network?: string): Promise<SignTransactionResult> {
    const port = await this.start();

    const { id, promise } = this._pendingStore.createSignTransactionRequest({
      unsignedTransaction: unsignedTx,
      description,
      network,
    });

    const approvalUrl = buildSignUrl(port, id);
    await this._openBrowser(approvalUrl);

    const result = await promise;
    if (!result.success) throw new Error(result.error);

    // Parse the signed transaction — browser returns JSON string
    let signedTransaction: any;
    try {
      signedTransaction = JSON.parse(result.result);
    } catch {
      // If it's not JSON, it might be a hex signature string
      signedTransaction = result.result;
    }

    return { signedTransaction, approvalUrl };
  }

  /**
   * Sign a message via the browser wallet (tronWeb.trx.signMessageV2).
   */
  async signMessage(params: { message: string; address?: string; network?: string }): Promise<SignMessageResult> {
    const port = await this.start();

    const { id, promise } = this._pendingStore.createSignMessageRequest({
      message: params.message,
      address: params.address,
      network: params.network,
    });

    const approvalUrl = buildSignUrl(port, id);
    await this._openBrowser(approvalUrl);

    const result = await promise;
    if (!result.success) throw new Error(result.error);

    return { signature: result.result, approvalUrl };
  }

  /** Shut down HTTP server and cancel all pending requests. */
  async shutdown(): Promise<void> {
    if (this._httpServer) {
      await this._httpServer.stop();
      this._httpServer = null;
    }
    for (const id of this._pendingStore.getPendingIds()) {
      this._pendingStore.cancel(id, "Wallet signer shutting down");
    }
    this._connectedAddress = null;
  }
}
