import { describe, expect, it } from "vitest";
import { z } from "zod";
import { describeField } from "../../scripts/lib/schema-description.js";

describe("catalog field descriptions from Zod's public JSON Schema", () => {
  it("keeps a required nullable amount required", () => {
    expect(describeField(z.number().nonnegative().nullable().describe("TRX\namount"))).toEqual({
      type: "number (min 0) | null", required: true, def: undefined, description: "TRX amount",
    });
  });

  it("distinguishes optional from nullable", () => {
    expect(describeField(z.string().optional())).toMatchObject({ type: "string", required: false });
    expect(describeField(z.string().nullable())).toMatchObject({ type: "string | null", required: true });
    expect(describeField(z.string().nullable().optional())).toMatchObject({ type: "string | null", required: false });
  });

  it("shows the default and enum without requiring the input", () => {
    expect(describeField(z.enum(["mainnet", "nile"]).default("mainnet"))).toMatchObject({
      type: "enum(mainnet | nile)", required: false, def: '"mainnet"',
    });
  });

  it("retains patterns and string length constraints", () => {
    expect(describeField(z.string().regex(/^\d+$/).min(1).max(12)).type)
      .toBe("string (pattern /^\\d+$/, min len 1, max len 12)");
  });

  it("retains both number bounds", () => {
    expect(describeField(z.number().min(1).max(3)).type).toBe("number (min 1, max 3)");
    expect(describeField(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)).type)
      .toBe("integer (max 9007199254740991, exclusive min 0)");
  });

  it("does not describe explicit payment consent as an arbitrary boolean", () => {
    expect(describeField(z.literal(true))).toMatchObject({ type: "literal(true)", required: true });
  });

  it("retains array element types and required objects", () => {
    expect(describeField(z.array(z.string()))).toMatchObject({ type: "string[]", required: true });
    expect(describeField(z.object({ name: z.string() }))).toMatchObject({ type: "object", required: true });
  });

  it("retains a wrapped inner description", () => {
    expect(describeField(z.string().describe("inner note").optional()).description).toBe("inner note");
  });
});
