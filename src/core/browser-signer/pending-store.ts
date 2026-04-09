/**
 * TRON Browser Wallet Signer — Pending Request Store
 *
 * UUID-keyed Map of Promises. Each signing/connect request creates a Promise
 * that blocks until the browser completes it (or 5-minute timeout).
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import type {
  ConnectRequest,
  PendingEntry,
  PendingRequest,
  RequestResult,
  SignTransactionRequest,
  SignMessageRequest,
} from "./types.js";

function generateId(): string {
  return crypto.randomUUID();
}

function generateApprovalToken(): string {
  return randomBytes(32).toString("hex");
}

function tokensEqual(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(actual, "utf8");
  if (expectedBytes.length !== actualBytes.length) return false;
  return timingSafeEqual(expectedBytes, actualBytes);
}

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export class PendingStore {
  private pending: Map<string, PendingEntry> = new Map();
  private timeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

  createConnectRequest(params?: {
    address?: string;
    network?: string;
  }): { id: string; promise: Promise<RequestResult>; authToken: string } {
    const request: ConnectRequest = {
      id: generateId(),
      type: "connect",
      address: params?.address,
      network: params?.network,
      createdAt: Date.now(),
    };
    return this._create(request);
  }

  createSignTransactionRequest(params: {
    unsignedTransaction: unknown;
    description?: string;
    network?: string;
  }): { id: string; promise: Promise<RequestResult>; authToken: string } {
    const request: SignTransactionRequest = {
      id: generateId(),
      type: "sign_transaction",
      createdAt: Date.now(),
      ...params,
    };
    return this._create(request);
  }

  createSignMessageRequest(params: {
    message: string;
    address?: string;
    network?: string;
  }): { id: string; promise: Promise<RequestResult>; authToken: string } {
    const request: SignMessageRequest = {
      id: generateId(),
      type: "sign_message",
      createdAt: Date.now(),
      ...params,
    };
    return this._create(request);
  }

  private _create<T extends PendingRequest>(request: T): { id: string; promise: Promise<RequestResult>; authToken: string } {
    const authToken = generateApprovalToken();
    const promise = new Promise<RequestResult>((resolve, reject) => {
      const entry: PendingEntry<T> = { request, resolve, reject, authToken };
      this.pending.set(request.id, entry);

      const timeoutId = setTimeout(() => {
        if (this.pending.has(request.id)) {
          this.pending.delete(request.id);
          this.timeouts.delete(request.id);
          reject(new Error("Request timed out after 5 minutes"));
        }
      }, REQUEST_TIMEOUT_MS);

      this.timeouts.set(request.id, timeoutId);
    });

    return { id: request.id, promise, authToken };
  }

  get(id: string): PendingRequest | undefined {
    return this.pending.get(id)?.request;
  }

  complete(id: string, result: RequestResult): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;

    const timeoutId = this.timeouts.get(id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.timeouts.delete(id);
    }

    entry.resolve(result);
    this.pending.delete(id);
    return true;
  }

  cancel(id: string, reason?: string): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;

    const timeoutId = this.timeouts.get(id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.timeouts.delete(id);
    }

    entry.reject(new Error(reason || "Request cancelled"));
    this.pending.delete(id);
    return true;
  }

  has(id: string): boolean {
    return this.pending.has(id);
  }

  isAuthorized(id: string, authToken: string | null | undefined): boolean {
    if (!authToken) return false;
    const entry = this.pending.get(id);
    if (!entry) return false;
    return tokensEqual(entry.authToken, authToken);
  }

  getPendingIds(): string[] {
    return Array.from(this.pending.keys());
  }

  get size(): number {
    return this.pending.size;
  }
}
