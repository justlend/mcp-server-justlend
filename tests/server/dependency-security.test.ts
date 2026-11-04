import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const proxyAddr = require("proxy-addr");
const qs = require("qs");

describe("patched HTTP dependency boundaries", () => {
  // GHSA-jqcg-44mw-7w3h: short IPv6 prefixes must not trust arbitrary IPv4 hops.
  it.each(["::ffff:10.0.0.0/8", "::/1"])("%s does not trust an external IPv4 client", (subnet) => {
    const trust = proxyAddr.compile(subnet);
    expect(trust("203.0.113.9", 0)).toBe(false);
    const req = {
      socket: { remoteAddress: "203.0.113.9" },
      headers: { "x-forwarded-for": "10.1.2.3" },
    };
    expect(proxyAddr(req, trust)).toBe("203.0.113.9");
  });

  it("preserves correctly scoped IPv4 and IPv4-mapped IPv6 trust", () => {
    for (const subnet of ["10.0.0.0/8", "::ffff:10.0.0.0/104"]) {
      const trust = proxyAddr.compile(subnet);
      expect(trust("10.1.2.3", 0)).toBe(true);
      expect(trust("203.0.113.9", 0)).toBe(false);
    }
  });

  // GHSA-x5fp-wj9c-mxmx: bracket keys must not bypass comma-array limits.
  it.each(["a=1,2,3,4", "a[]=1,2,3,4"])("rejects oversized comma arrays in %s", (input) => {
    expect(() => qs.parse(input, {
      comma: true, arrayLimit: 3, throwOnLimitExceeded: true,
    })).toThrow(RangeError);
  });

  it("still parses a comma array within its configured limit", () => {
    expect(qs.parse("a=1,2,3", {
      comma: true, arrayLimit: 3, throwOnLimitExceeded: true,
    })).toEqual({ a: ["1", "2", "3"] });
  });
});
