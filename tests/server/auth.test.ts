import { describe, it, expect } from "vitest";
import { authHeaderMatches } from "../../src/server/auth.js";

describe("authHeaderMatches", () => {
  const expected = "Bearer s3cret-token-xyz";

  it("returns true for the exact expected value", () => {
    expect(authHeaderMatches(expected, expected)).toBe(true);
  });

  it("returns false for undefined / empty headers", () => {
    expect(authHeaderMatches(undefined, expected)).toBe(false);
    expect(authHeaderMatches("", expected)).toBe(false);
  });

  it("returns false for a header of a different length (would throw in raw timingSafeEqual)", () => {
    expect(authHeaderMatches("Bearer short", expected)).toBe(false);
    expect(authHeaderMatches("Bearer s3cret-token-xyz-extra", expected)).toBe(false);
  });

  it("returns false for an equal-length but different value", () => {
    const sameLenDifferent = "Bearer s3cret-token-XYZ"; // differs in last 3 chars
    expect(sameLenDifferent.length).toBe(expected.length);
    expect(authHeaderMatches(sameLenDifferent, expected)).toBe(false);
  });

  it("returns false for a header missing the Bearer prefix", () => {
    expect(authHeaderMatches("s3cret-token-xyz", expected)).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(authHeaderMatches("bearer s3cret-token-xyz", expected)).toBe(false);
  });
});
