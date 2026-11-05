// @ts-expect-error: class-transformer ships no types for its storage entry point
import { defaultMetadataStorage } from 'class-transformer/cjs/storage'
import { validationMetadatasToSchemas } from 'class-validator-jsonschema'
import { ROUTES, rolesFor } from './routes'

type Schema = Record<string, unknown>

/** Builds the OpenAPI 3.1 document from the route table and the class-validator DTOs. Deterministic. */
export function buildOpenApi(): Schema {
  const schemas = validationMetadatasToSchemas({ refPointerPrefix: '#/components/schemas/', classTransformerMetadataStorage: defaultMetadataStorage }) as Record<string, Schema>
  const paths: Record<string, Record<string, Schema>> = {}
  // Update DTOs extend a generated Partial class that carries the validation metadata.
  const nameOf = (cls: Function): string => (schemas[cls.name] || !Object.getPrototypeOf(cls)?.name ? cls.name : nameOf(Object.getPrototypeOf(cls)))
  for (const r of ROUTES) {
    const params: Schema[] = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }))
    if (r.query) {
      const q = schemas[nameOf(r.query)] as { properties?: Record<string, Schema>; required?: string[] }
      for (const [name, schema] of Object.entries(q?.properties ?? {})) params.push({ name, in: 'query', required: !!q.required?.includes(name), schema })
    }
    const op: Schema = {
      tags: [r.tag],
      summary: r.summary,
      operationId: `${r.method.toLowerCase()}${r.path.replace(/[{}]/g, '').replace(/[^a-zA-Z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))}`,
      'x-roles': r.public ? [] : rolesFor(r),
      ...(r.public ? { security: [] } : {}),
      ...(params.length ? { parameters: params } : {}),
      ...(r.body ? { requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${nameOf(r.body)}` } } } } } : {}),
      responses: {
        '200': { description: 'OK. Stored documents include `id` and `_meta` (who wrote it, when, from where).' },
        ...(r.public ? {} : { '401': { description: 'Missing or invalid credential' }, '403': { description: 'Role or collection ownership does not allow this' } }),
        ...(r.body ? { '400': { description: 'Validation failed or a draft-only rule was broken' } } : {}),
      },
    }
    ;(paths[r.path] ??= {})[r.method.toLowerCase()] = op
  }
  const sorted = Object.fromEntries(Object.entries(schemas).sort(([a], [b]) => a.localeCompare(b)))
  return {
    openapi: '3.1.0',
    info: {
      title: 'Growth OS API',
      version: '1.0.0',
      description:
        'Draft-only. No route posts, publishes, replies, likes, follows or messages on any platform. Metrics are a number or "UNKNOWN", never an estimate. TikTok and X are never combined.',
    },
    security: [{ basic: [] }, { bearer: [] }],
    components: {
      securitySchemes: { basic: { type: 'http', scheme: 'basic', description: 'Creator login' }, bearer: { type: 'http', scheme: 'bearer', description: 'Per-agent key (analyst, creative) or scheduler key' } },
      schemas: sorted,
    },
    paths,
  }
}
