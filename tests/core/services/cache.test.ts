import { describe, it, expect, beforeEach, vi } from "vitest";
import { cacheGet, cacheSet, cacheInvalidate, cacheInvalidatePrefix } from "../../../src/core/services/cache.js";

describe("cache", () => {
  beforeEach(() => {
    // Clear all cache entries by invalidating common prefixes
    cacheInvalidatePrefix("");
  });

  describe("cacheGet / cacheSet", () => {
    it("should return undefined for missing key", () => {
      expect(cacheGet("nonexistent")).toBeUndefined();
    });

    it("should store and retrieve a value", () => {
      cacheSet("key1", 42, 10_000);
      expect(cacheGet("key1")).toBe(42);
    });

    it("should store objects", () => {
      const obj = { price: 1.23, symbol: "USDT" };
      cacheSet("obj1", obj, 10_000);
      expect(cacheGet("obj1")).toEqual(obj);
    });

    it("should return undefined after TTL expires", () => {
      vi.useFakeTimers();
      try {
        cacheSet("expire", "value", 1000);
        expect(cacheGet("expire")).toBe("value");

        vi.advanceTimersByTime(1001);
        expect(cacheGet("expire")).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it("should return value before TTL expires", () => {
      vi.useFakeTimers();
      try {
        cacheSet("alive", "value", 5000);
        vi.advanceTimersByTime(4999);
        expect(cacheGet("alive")).toBe("value");
      } finally {
        vi.useRealTimers();
      }
    });

    it("should overwrite existing entry", () => {
      cacheSet("key", "old", 10_000);
      cacheSet("key", "new", 10_000);
      expect(cacheGet("key")).toBe("new");
    });
  });

  describe("cacheInvalidate", () => {
    it("should remove a specific key", () => {
      cacheSet("a", 1, 10_000);
      cacheSet("b", 2, 10_000);
      cacheInvalidate("a");
      expect(cacheGet("a")).toBeUndefined();
      expect(cacheGet("b")).toBe(2);
    });

    it("should be a no-op for missing key", () => {
      cacheInvalidate("nope"); // should not throw
    });
  });

  describe("cacheInvalidatePrefix", () => {
    it("should remove all keys with matching prefix", () => {
      cacheSet("markets:mainnet", "data1", 10_000);
      cacheSet("markets:nile", "data2", 10_000);
      cacheSet("price:mainnet:USDT", "data3", 10_000);

      cacheInvalidatePrefix("markets:");
      expect(cacheGet("markets:mainnet")).toBeUndefined();
      expect(cacheGet("markets:nile")).toBeUndefined();
      expect(cacheGet("price:mainnet:USDT")).toBe("data3");
    });

    it("should remove all entries with empty prefix", () => {
      cacheSet("a", 1, 10_000);
      cacheSet("b", 2, 10_000);
      cacheInvalidatePrefix("");
      expect(cacheGet("a")).toBeUndefined();
      expect(cacheGet("b")).toBeUndefined();
    });
  });
});
