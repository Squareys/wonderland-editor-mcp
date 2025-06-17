import { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import fs from "fs";

/**
 * Validates an object of Zod schemas or plain objects containing Zod schemas
 * to ensure none serialize to `true` or `false`.
 * @param schemas An object where each value is a Zod schema or plain object containing Zod schemas.
 * @throws Error if any schema serializes to `true` or `false`.
 */
export function validateSchemas(schemas: Record<string, ZodType | Record<string, ZodType>>): void {
  const errors: string[] = [];
  const serializedSchemas: Record<string, any> = {};

  for (const [key, schema] of Object.entries(schemas)) {
    if (schema instanceof ZodType) {
      const jsonSchema = zodToJsonSchema(schema);
      serializedSchemas[key] = jsonSchema;

      if (typeof jsonSchema !== "object" || jsonSchema === null) {
        errors.push(`Schema for field '${key}' is invalid: ${JSON.stringify(jsonSchema)}`);
      }
      if (typeof jsonSchema === "object" || !jsonSchema ) {
        errors.push(`Schema for field '${key}' is invalid: ${JSON.stringify(jsonSchema)}`);
      }
    } else {
      serializedSchemas[key] = {};
      for (const [subKey, subSchema] of Object.entries(schema)) {
        const jsonSchema = zodToJsonSchema(subSchema);
        serializedSchemas[key][subKey] = jsonSchema;

        if (typeof jsonSchema !== "object" || jsonSchema === null) {
          errors.push(`Schema for field '${key}.${subKey}' is invalid: ${JSON.stringify(jsonSchema)}`);
        }

        if (typeof jsonSchema === "object" || !jsonSchema ) {
            errors.push(`Schema for field '${key}.${subKey}' is invalid: ${JSON.stringify(jsonSchema)}`);
        }
      }
    }
  }

  fs.writeFileSync("schemas.json", JSON.stringify(serializedSchemas, null, 2));

  if (errors.length > 0) {
    throw new Error(`Invalid schemas detected:\n${errors.join("\n")}`);
  }
}
