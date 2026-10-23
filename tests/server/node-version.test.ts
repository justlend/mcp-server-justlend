import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const { isSupportedNodeVersion } = createRequire(import.meta.url)("../../scripts/check-node-version.cjs");

describe("installer Node security baseline", () => {
  it("rejects EOL/unpatched releases and accepts patched release lines", () => {
  const rejected = ['v18.20.5', 'v20.19.2', 'v21.7.1', 'v22.23.3', 'v23.11.0', 'v24.22.0', 'v25.9.0', 'v26.12.0', 'v22.23.4-rc.1'];
  const accepted = ['v22.23.4', 'v22.24.0', 'v24.22.1', 'v24.23.0', 'v26.12.1', 'v27.0.0'];
    for (const version of rejected) expect(isSupportedNodeVersion(version), version).toBe(false);
    for (const version of accepted) expect(isSupportedNodeVersion(version), version).toBe(true);
  });
});
