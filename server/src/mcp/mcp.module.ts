import { Controller, Delete, Get, HttpException, Injectable, Module, Post, Req, Res } from '@nestjs/common'
import {
  buildOpenApi,
  CreateEngagementDto,
  CreateExperimentDto,
  CreateHandoffDto,
  CreateLeadDto,
  CreateReportDto,
  CreateSnapshotDto,
  dtoSchema,
  SnapshotQuery,
  type Engagement,
  type Handoff,
  type JsonSchema,
} from '@growth-os/contracts'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import type { Response } from 'express'
import { AudienceModule, AudienceService } from '../audience/audience.module'
import { Writer, type AuthedRequest, type WriteContext } from '../common/actor'
import { EngagementModule, EngagementService } from '../engagement/engagement.module'
import { ExperimentsModule, ExperimentsService } from '../experiments/experiments.module'
import { HandoffsModule, HandoffsService } from '../handoffs/handoffs.module'
import { LeadsModule, LeadsService } from '../leads/leads.module'
import { ReportsService, WorkspaceModule } from '../workspace/workspace.module'

type Args = Record<string, unknown>

interface Tool {
  name: string
  description: string
  inputSchema: JsonSchema
  run: (ctx: WriteContext, args: Args) => Promise<unknown>
}

/** Validates tool arguments against the same DTO the REST route uses. Fields the tool does not offer are rejected. */
function parse<T extends object>(cls: new () => T, args: Args, omit: readonly string[] = []): T {
  const extra = omit.filter((k) => k in args)
  if (extra.length) throw new ToolError(`Not allowed in this tool: ${extra.join(', ')}.`)
  const inst = plainToInstance(cls, args)
  const errors = validateSync(inst, { whitelist: true, forbidNonWhitelisted: true })
  if (errors.length) throw new ToolError(errors.map((e) => Object.values(e.constraints ?? { nested: `${e.property} is invalid` }).join(', ')).join('; '))
  return inst
}

class ToolError extends Error {}

const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false })
const ID = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$' }

const SNAPSHOT_OMIT = ['id', 'verified', 'demo'] as const
const ENGAGEMENT_OMIT = ['id', 'status', 'createdAt', 'updatedAt', 'demo'] as const
const EXPERIMENT_OMIT = ['id', 'demo'] as const
const REPORT_OMIT = ['id', 'demo'] as const
const LEAD_OMIT = ['id', 'demo', 'attributedRevenue'] as const
const HANDOFF_OMIT = ['id', 'from', 'createdAt', 'demo'] as const

/**
 * MCP tools for the analyst. Each tool is a thin wrapper over an existing service with the same DTO and the
 * caller's own credential, so ownership, draft-only and UNKNOWN rules are exactly those of the REST API.
 * None of these tools posts, replies, likes, follows or messages anywhere.
 */
@Injectable()
export class McpTools {
  readonly tools: Tool[]

  constructor(
    audience: AudienceService,
    experiments: ExperimentsService,
    engagement: EngagementService,
    reports: ReportsService,
    leads: LeadsService,
    handoffs: HandoffsService,
  ) {
    this.tools = [
      {
        name: 'get_snapshots',
        description: 'Audience snapshots, one platform each (never summed). Read the last four weeks before an analysis: pass since=YYYY-MM-DD. Missing metrics are "UNKNOWN".',
        inputSchema: dtoSchema(SnapshotQuery),
        run: (_, a) => audience.query(parse(SnapshotQuery, a)),
      },
      {
        name: 'get_experiments',
        description: 'The experiment log, optionally for one content item.',
        inputSchema: obj({ contentItemId: ID }),
        run: async (_, a) => {
          const { contentItemId } = a as { contentItemId?: string }
          return experiments.list(contentItemId ? { contentItemId } : undefined)
        },
      },
      {
        name: 'get_openapi',
        description: 'The Growth OS field contract (OpenAPI 3.1). Source of truth for field names.',
        inputSchema: obj({}),
        run: async () => buildOpenApi(),
      },
      {
        name: 'create_snapshot',
        description: 'Record one platform on one date. Metrics are a non-negative number or "UNKNOWN"; omitted metrics are stored as "UNKNOWN", never 0. Saved unverified until the creator verifies it.',
        inputSchema: dtoSchema(CreateSnapshotDto, SNAPSHOT_OMIT),
        run: (ctx, a) => audience.createSnapshot(ctx, parse(CreateSnapshotDto, a, SNAPSHOT_OMIT)),
      },
      {
        name: 'create_engagement_items',
        description: 'Add comments to the engagement queue with draft replies. Always saved as drafts (status drafted, or new without a reply; sensitive items are escalated with no reply). Nothing is sent.',
        inputSchema: obj({ items: { type: 'array', minItems: 1, maxItems: 50, items: dtoSchema(CreateEngagementDto, ENGAGEMENT_OMIT) } }, ['items']),
        run: async (ctx, a) => {
          const items = Array.isArray(a.items) ? (a.items as Args[]) : []
          if (!items.length || items.length > 50) throw new ToolError('items must have 1 to 50 entries.')
          const parsed = items.map((i) => parse(CreateEngagementDto, i, ENGAGEMENT_OMIT))
          const out: Engagement[] = []
          for (const i of parsed) {
            const sensitive = i.category === 'sensitive'
            out.push(await engagement.create(ctx, { ...i, draftReply: sensitive ? '' : (i.draftReply ?? ''), status: sensitive ? 'escalated' : i.draftReply?.trim() ? 'drafted' : 'new' }))
          }
          return out
        },
      },
      {
        name: 'create_experiment',
        description: 'Log a measured result for a content item. Wakes the creative agent (experiment_logged).',
        inputSchema: { ...dtoSchema(CreateExperimentDto, EXPERIMENT_OMIT), required: ['contentItemId'] },
        run: (ctx, a) => experiments.create(ctx, parse(CreateExperimentDto, a, EXPERIMENT_OMIT)),
      },
      {
        name: 'create_report',
        description: 'Weekly "what my audience is telling us" report.',
        inputSchema: dtoSchema(CreateReportDto, REPORT_OMIT),
        run: (ctx, a) => reports.create(ctx, parse(CreateReportDto, a, REPORT_OMIT)),
      },
      {
        name: 'create_lead',
        description: 'Flag a lead for the creator to review. Revenue is attributed only by the creator, with evidence.',
        inputSchema: dtoSchema(CreateLeadDto, LEAD_OMIT),
        run: (ctx, a) => leads.create(ctx, parse(CreateLeadDto, a, LEAD_OMIT)),
      },
      {
        name: 'create_handoff',
        description: 'Send a handoff as the analyst. An analysis must cite the snapshots or experiments it used in refs, or it is rejected. Wakes the recipient.',
        inputSchema: dtoSchema(CreateHandoffDto, HANDOFF_OMIT),
        run: (ctx, a) => handoffs.send(ctx, parse(CreateHandoffDto, a, HANDOFF_OMIT) as Partial<Handoff>),
      },
      {
        name: 'list_inbox',
        description: 'Handoffs to the analyst that are not acknowledged yet, newest first.',
        inputSchema: obj({}),
        run: (ctx) => handoffs.query({ acknowledged: 'false', to: ctx.actor.role === 'worker' ? 'analyst' : ctx.actor.role }),
      },
      {
        name: 'ack_handoff',
        description: 'Mark a handoff addressed to the analyst as read.',
        inputSchema: obj({ id: ID }, ['id']),
        run: (ctx, a) => {
          if (typeof a.id !== 'string') throw new ToolError('id is required.')
          return handoffs.ack(ctx, a.id)
        },
      },
    ]
  }

  async call(ctx: WriteContext, name: string, args: Args = {}): Promise<CallToolResult> {
    const tool = this.tools.find((t) => t.name === name)
    if (!tool) return { isError: true, content: [{ type: 'text', text: `Unknown tool ${name}. This server only offers the analyst's tools.` }] }
    try {
      const result = await tool.run(ctx, args)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: { result } as Record<string, unknown> }
    } catch (e) {
      const status = e instanceof HttpException ? e.getStatus() : e instanceof ToolError ? 400 : 500
      const raw = e instanceof HttpException ? (e.getResponse() as { message?: string | string[] }).message : e instanceof Error ? e.message : String(e)
      const message = status === 500 ? 'Internal error.' : Array.isArray(raw) ? raw.join('; ') : raw
      return { isError: true, content: [{ type: 'text', text: `${status}: ${message}` }] }
    }
  }

  /** One MCP server per request (stateless): the caller's credential decides every write. */
  server(ctx: WriteContext): Server {
    const server = new Server({ name: 'growth-os-analyst', version: '1.0.0' }, { capabilities: { tools: {} }, instructions: 'Growth OS analyst tools. Draft-only: nothing here posts, replies, likes, follows or messages. Cite snapshot or experiment ids in every analysis.' })
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: this.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema: inputSchema as { type: 'object' } })) }))
    server.setRequestHandler(CallToolRequestSchema, (req) => this.call(ctx, req.params.name, req.params.arguments as Args | undefined))
    return server
  }
}

/** Streamable HTTP endpoint (stateless, JSON responses). Auth and role come from the global guard: analyst key only. */
@Controller('mcp')
export class McpController {
  constructor(private readonly mcp: McpTools) {}

  @Post()
  async post(@Writer() w: WriteContext, @Req() req: AuthedRequest, @Res() res: Response) {
    const server = this.mcp.server({ ...w, source: w.source === 'api' ? 'mcp' : w.source })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  }

  @Get()
  stream(@Res() res: Response) {
    res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Stateless server: use POST.' }, id: null })
  }

  @Delete()
  end(@Res() res: Response) {
    res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Stateless server: no sessions.' }, id: null })
  }
}

@Module({
  imports: [AudienceModule, ExperimentsModule, EngagementModule, WorkspaceModule, LeadsModule, HandoffsModule],
  controllers: [McpController],
  providers: [McpTools],
})
export class McpModule {}
