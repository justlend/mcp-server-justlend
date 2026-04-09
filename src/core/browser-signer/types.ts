/**
 * TRON Browser Wallet Signer — Type Definitions
 *
 * Adapted from the EVM browser-evm-signer types for TRON-specific signing.
 * Key differences:
 * - sign_transaction carries the full unsigned tx object (sign-only, server broadcasts)
 * - No chainId switching (TRON uses network: mainnet/nile)
 * - No sign_typed_data (TRON has no widespread EIP-712 equivalent)
 */

export type RequestType = "connect" | "sign_transaction" | "sign_message";

export interface BaseRequest {
  id: string;
  type: RequestType;
  /** Informational network label for the browser UI */
  network?: string;
  createdAt: number;
}

export interface ConnectRequest extends BaseRequest {
  type: "connect";
  /** If set, the user must connect this exact TRON address (T...) */
  address?: string;
}

export interface SignTransactionRequest extends BaseRequest {
  type: "sign_transaction";
  /** Full unsigned transaction object built by TronWeb on the server */
  unsignedTransaction: unknown;
  /** Human-readable summary for the approval UI (e.g. "Supply 100 USDT to JustLend") */
  description?: string;
}

export interface SignMessageRequest extends BaseRequest {
  type: "sign_message";
  message: string;
  address?: string;
}

export type PendingRequest = ConnectRequest | SignTransactionRequest | SignMessageRequest;

// Response types
export interface SuccessResult {
  success: true;
  /** address, signed transaction JSON, or signature hex */
  result: string;
}

export interface ErrorResult {
  success: false;
  error: string;
}

export type RequestResult = SuccessResult | ErrorResult;

// Pending store entry
export interface PendingEntry<T extends PendingRequest = PendingRequest> {
  request: T;
  resolve: (result: RequestResult) => void;
  reject: (error: Error) => void;
  authToken: string;
}

// HTTP API types
export interface PendingApiResponse {
  request: PendingRequest;
}

export interface CompleteApiRequest {
  success: boolean;
  result?: string;
  error?: string;
}
