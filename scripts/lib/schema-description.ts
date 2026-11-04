import { z } from "zod";

type JsonSchema = Record<string, any>;

function describeType(schema: JsonSchema): string {
  if ("const" in schema) return `literal(${JSON.stringify(schema.const)})`;
  if (Array.isArray(schema.type)) {
    return schema.type.map((type: string) => describeType({ ...schema, type })).join(" | ");
  }
  if (schema.anyOf) {
    const nonNull = schema.anyOf.filter((part: JsonSchema) => part.type !== "null");
    const type = nonNull.length === 1 ? describeType(nonNull[0]) : "union";
    return nonNull.length < schema.anyOf.length ? `${type} | null` : type;
  }
  if (Array.isArray(schema.enum)) return `enum(${schema.enum.join(" | ")})`;
  if (schema.type === "array") {
    const item = schema.items ?? {};
    return `${item.enum ? "enum" : item.type ?? "any"}[]`;
  }
  if (schema.type === "number" || schema.type === "integer") {
    const bounds: string[] = [];
    if (schema.minimum !== undefined) bounds.push(`min ${schema.minimum}`);
    if (schema.maximum !== undefined) bounds.push(`max ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined) bounds.push(`exclusive min ${schema.exclusiveMinimum}`);
    if (schema.exclusiveMaximum !== undefined) bounds.push(`exclusive max ${schema.exclusiveMaximum}`);
    return bounds.length ? `${schema.type} (${bounds.join(", ")})` : schema.type;
  }
  if (schema.type === "string") {
    const constraints: string[] = [];
    if (schema.pattern !== undefined) constraints.push(`pattern /${schema.pattern}/`);
    if (schema.minLength !== undefined && schema.minLength === schema.maxLength) {
      constraints.push(`len ${schema.minLength}`);
    } else {
      if (schema.minLength !== undefined) constraints.push(`min len ${schema.minLength}`);
      if (schema.maxLength !== undefined) constraints.push(`max len ${schema.maxLength}`);
    }
    return constraints.length ? `string (${constraints.join(", ")})` : "string";
  }
  return schema.type ?? "unknown";
}

/** Use the public Zod 4 contract, not Zod 3's private _def/typeName layout. */
export function describeField(schema: z.ZodType): {
  type: string;
  required: boolean;
  def?: string;
  description: string;
} {
  const object = z.toJSONSchema(z.object({ value: schema }), { io: "input", unrepresentable: "any" });
  const definition = object.properties?.value;
  const field: JsonSchema = typeof definition === "object" && definition !== null ? definition : {};
  return {
    type: describeType(field),
    required: object.required?.includes("value") ?? false,
    def: "default" in field ? JSON.stringify(field.default) : undefined,
    description: (field.description ?? schema.description ?? "").replace(/\s*\n\s*/g, " ").trim(),
  };
}
