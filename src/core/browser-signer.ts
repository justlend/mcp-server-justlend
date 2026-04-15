/**
 * TRON Browser Wallet Signer — Adapter for tronlink-signer SDK
 *
 * Wraps the official TronSigner from `tronlink-signer` to match the interface
 * expected by wallet.ts (connectWallet / signTransaction / signMessage / signTypedData).
 * The underlying SDK uses TIP-6963 wallet discovery, auto-unlock, and auto-network-switching.
 */

import { TronSigner, type TronNetwork } from "tronlink-signer";

export interface ConnectResult {
  address: string;
  approvalUrl: string;
}

export interface SignTransactionResult {
  signedTransaction: any;
  approvalUrl: string;
}

export interface SignMessageResult {
  signature: string;
  approvalUrl: string;
}

export interface SignTypedDataResult {
  signature: string;
}

export class TronWalletSigner {
  private _signer: TronSigner;
  private _connectedAddress: string | null = null;
  private _started = false;

  constructor() {
    this._signer = new TronSigner();
  }

  /** Start HTTP server explicitly. Called automatically on first request. */
  async start(): Promise<number> {
    if (!this._started) {
      await this._signer.start();
      this._started = true;
    }
    return this._signer.getConfig().httpPort;
  }

  getConnectedAddress(): string | null {
    return this._connectedAddress;
  }

  /**
   * Connect to a browser wallet. Opens a browser window for user approval.
   * If `options.address` is specified, verifies the connected address matches
   * and throws if it does not (TronSigner does not natively support address filtering).
   */
  async connectWallet(options?: { address?: string; network?: string }): Promise<ConnectResult> {
    await this.start();

    const network = options?.network as TronNetwork | undefined;
    const { address } = await this._signer.connectWallet(network);

    // Post-connect address verification (workaround until upstream supports address param)
    if (options?.address && address !== options.address) {
      this._connectedAddress = null;
      throw new Error(
        `Connected address ${address} does not match the required address ${options.address}. ` +
        "Please switch to the correct account in TronLink and try again.",
      );
    }

    this._connectedAddress = address;
    return { address, approvalUrl: "" };
  }

  /**
   * Sign an unsigned transaction via the browser wallet.
   * The caller is responsible for broadcasting.
   */
  async signTransaction(unsignedTx: unknown, _description?: string, network?: string): Promise<SignTransactionResult> {
    await this.start();

    const { signedTransaction } = await this._signer.signTransaction(
      unsignedTx as Record<string, unknown>,
      network as TronNetwork | undefined,
    );
    return { signedTransaction: signedTransaction as any, approvalUrl: "" };
  }

  /**
   * Sign a message via the browser wallet.
   */
  async signMessage(params: { message: string; address?: string; network?: string }): Promise<SignMessageResult> {
    await this.start();

    const { signature } = await this._signer.signMessage(
      params.message,
      params.network as TronNetwork | undefined,
    );
    return { signature, approvalUrl: "" };
  }

  /**
   * Sign typed data (EIP-712 / TRON-712) via the browser wallet.
   */
  async signTypedData(typedData: Record<string, unknown>, network?: string): Promise<SignTypedDataResult> {
    await this.start();

    const { signature } = await this._signer.signTypedData(
      typedData,
      network as TronNetwork | undefined,
    );
    return { signature };
  }

  /** Shut down HTTP server and clear state. */
  async shutdown(): Promise<void> {
    this._connectedAddress = null;
    if (this._started) {
      await this._signer.stop();
      this._started = false;
    }
  }
}
