// @ts-expect-error: class-transformer ships no types for its storage entry point
import { defaultMetadataStorage } from 'class-transformer/cjs/storage'
import { validationMetadatasToSchemas } from 'class-validator-jsonschema'

export type JsonSchema = Record<string, unknown>

let cache: Record<string, JsonSchema> | null = null

/** JSON Schemas for every DTO, generated from the class-validator decorators. */
export const allSchemas = (): Record<string, JsonSchema> =>
  (cache ??= validationMetadatasToSchemas({ refPointerPrefix: '#/components/schemas/', classTransformerMetadataStorage: defaultMetadataStorage }) as Record<string, JsonSchema>)

/** Update DTOs extend a generated Partial class that carries the validation metadata. */
export const schemaName = (cls: Function): string => {
  const schemas = allSchemas()
  return schemas[cls.name] || !Object.getPrototypeOf(cls)?.name ? cls.name : schemaName(Object.getPrototypeOf(cls))
}

const inline = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(inline)
  if (!node || typeof node !== 'object') return node
  const ref = (node as { $ref?: string }).$ref
  if (ref) return inline(allSchemas()[ref.split('/').at(-1)!])
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, inline(v)]))
}

/** A self-contained schema for one DTO (refs inlined), optionally without some fields. Used for MCP tool inputs. */
export function dtoSchema(cls: Function, omit: readonly string[] = []): JsonSchema {
  const s = inline(allSchemas()[schemaName(cls)]) as { properties?: Record<string, JsonSchema>; required?: string[] }
  const properties = Object.fromEntries(Object.entries(s.properties ?? {}).filter(([k]) => !omit.includes(k)))
  const required = (s.required ?? []).filter((k) => !omit.includes(k))
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false }
}
