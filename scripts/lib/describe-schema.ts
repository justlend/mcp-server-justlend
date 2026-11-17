import { z } from "zod";

/** Describe tool inputs through Zod's public API, including wrapper metadata. */
export function describeField(zt: z.ZodType): {
  type: string;
  required: boolean;
  def?: string;
  description: string;
} {
  let required = true;
  let def: string | undefined;
  let description = zt.description ?? "";
  let t = zt;

  while (t instanceof z.ZodOptional || t instanceof z.ZodNullable || t instanceof z.ZodDefault) {
    required = false;
    if (t instanceof z.ZodDefault) def = JSON.stringify(t.parse(undefined));
    t = t.unwrap() as z.ZodType;
    description ||= t.description ?? "";
  }

  const schema = z.toJSONSchema(t, { io: "input" });
  let type: string = schema.type === "integer" ? "number" : String(schema.type ?? "unknown");
  if (Array.isArray(schema.enum)) type = `enum(${schema.enum.join(" | ")})`;
  if (t instanceof z.ZodLiteral) type = "literal";
  if (t instanceof z.ZodUnion) type = "union";
  if (t instanceof z.ZodArray) {
    const item = z.toJSONSchema(t.element, { io: "input" });
    type = `${item.type === "integer" ? "number" : item.type ?? "any"}[]`;
  }
  if (t instanceof z.ZodNumber) {
    const bounds = [
      schema.minimum != null ? `min ${schema.minimum}` : null,
      schema.exclusiveMinimum != null ? `> ${schema.exclusiveMinimum}` : null,
      schema.maximum != null ? `max ${schema.maximum}` : null,
      schema.exclusiveMaximum != null ? `< ${schema.exclusiveMaximum}` : null,
    ].filter(Boolean);
    if (bounds.length) type = `number (${bounds.join(", ")})`;
  }
  if (t instanceof z.ZodString) {
    const parts = [
      schema.pattern != null ? `pattern ${String(new RegExp(schema.pattern))}` : null,
      schema.minLength != null && schema.minLength === schema.maxLength
        ? `len ${schema.minLength}`
        : [
            schema.minLength != null ? `min len ${schema.minLength}` : null,
            schema.maxLength != null ? `max len ${schema.maxLength}` : null,
          ].filter(Boolean).join(", "),
    ].filter(Boolean);
    if (parts.length) type = `string (${parts.join(", ")})`;
  }
  return { type, required, def, description: description.replace(/\s*\n\s*/g, " ").trim() };
}
