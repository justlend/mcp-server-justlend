import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const { isSupportedNodeVersion } = createRequire(import.meta.url)("../../scripts/check-node-version.cjs");

describe("exact installer Node.js version", () => {
  it("accepts v24.22.3", () => expect(isSupportedNodeVersion("v24.22.3")).toBe(true));
  it("accepts 24.22.3", () => expect(isSupportedNodeVersion("24.22.3")).toBe(true));
  it("rejects v24.22.0", () => expect(isSupportedNodeVersion("v24.22.0")).toBe(false));
  it("rejects v24.22.2", () => expect(isSupportedNodeVersion("v24.22.2")).toBe(false));
  it("rejects v24.22.1", () => expect(isSupportedNodeVersion("v24.22.1")).toBe(false));
  it("rejects 24.22.1", () => expect(isSupportedNodeVersion("24.22.1")).toBe(false));
  it("rejects 24.22.2", () => expect(isSupportedNodeVersion("24.22.2")).toBe(false));
  it("rejects v24.22.4", () => expect(isSupportedNodeVersion("v24.22.4")).toBe(false));
  it("rejects 24.22.4", () => expect(isSupportedNodeVersion("24.22.4")).toBe(false));
  it("rejects v24.21.1", () => expect(isSupportedNodeVersion("v24.21.1")).toBe(false));
  it("rejects v24.23.1", () => expect(isSupportedNodeVersion("v24.23.1")).toBe(false));
  it("rejects v23.22.1", () => expect(isSupportedNodeVersion("v23.22.1")).toBe(false));
  it("rejects v25.22.1", () => expect(isSupportedNodeVersion("v25.22.1")).toBe(false));
  it("rejects v22.23.4", () => expect(isSupportedNodeVersion("v22.23.4")).toBe(false));
  it("rejects v26.12.1", () => expect(isSupportedNodeVersion("v26.12.1")).toBe(false));
  it("rejects v27.0.0", () => expect(isSupportedNodeVersion("v27.0.0")).toBe(false));
  it("rejects v24.22.3-rc.1", () => expect(isSupportedNodeVersion("v24.22.3-rc.1")).toBe(false));
  it("rejects v24.22.3+build", () => expect(isSupportedNodeVersion("v24.22.3+build")).toBe(false));
  it("rejects an empty version", () => expect(isSupportedNodeVersion("")).toBe(false));
  it("rejects v24.22", () => expect(isSupportedNodeVersion("v24.22")).toBe(false));
  it("rejects invalid", () => expect(isSupportedNodeVersion("invalid")).toBe(false));
  it("rejects v024.22.3", () => expect(isSupportedNodeVersion("v024.22.3")).toBe(false));
});
