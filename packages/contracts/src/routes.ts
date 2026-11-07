import * as dto from './dto'
import type { Role } from './domain'

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
type Dto = new () => object

export interface RouteSpec {
  method: Method
  /** OpenAPI-style path, e.g. /api/content/{id}. */
  path: string
  tag: string
  summary: string
  body?: Dto
  query?: Dto
  /** Roles allowed to call it. Collection ownership rules apply on top for writes. */
  roles?: readonly Role[]
  public?: true
}

const AUTHORS: readonly Role[] = ['creator', 'analyst', 'creative']
const DISPATCH: readonly Role[] = ['creator', 'worker']

const crud = (tag: string, base: string, create: Dto, update: Dto, opts: { remove?: boolean; patch?: boolean } = { remove: true, patch: true }): RouteSpec[] => [
  { method: 'GET', path: base, tag, summary: `List ${tag}` },
  { method: 'POST', path: base, tag, summary: `Create a ${tag} item`, body: create },
  ...(opts.patch ? [{ method: 'PATCH' as const, path: `${base}/{id}`, tag, summary: `Update a ${tag} item`, body: update }] : []),
  ...(opts.remove ? [{ method: 'DELETE' as const, path: `${base}/{id}`, tag, summary: `Delete a ${tag} item (creator only)` }] : []),
]

/**
 * Every route the API serves. The server's route list must equal this table (tested), and the OpenAPI
 * spec is generated from it. None of these routes posts, publishes, replies or messages on any platform.
 */
export const ROUTES: RouteSpec[] = [
  { method: 'GET', path: '/health', tag: 'health', summary: 'Status only, no data', public: true },
  { method: 'GET', path: '/api/openapi.json', tag: 'meta', summary: 'This OpenAPI spec', roles: [...AUTHORS, 'worker'] },
  { method: 'GET', path: '/api/session', tag: 'meta', summary: 'Who is calling', roles: [...AUTHORS, 'worker'] },
  { method: 'GET', path: '/api/state', tag: 'meta', summary: 'Everything the dashboard needs in one read' },

  { method: 'GET', path: '/api/profile', tag: 'profile', summary: 'Workspace profile' },
  { method: 'PUT', path: '/api/profile', tag: 'profile', summary: 'Replace the profile (creator only)', body: dto.ProfileDto },
  { method: 'GET', path: '/api/brief', tag: 'brief', summary: 'Approved brief fields: value, verified, source' },
  { method: 'PATCH', path: '/api/brief', tag: 'brief', summary: 'Update brief fields (creator only)', body: dto.PatchBriefDto },

  { method: 'GET', path: '/api/audience/latest', tag: 'audience', summary: 'Latest snapshot for exactly one platform', query: dto.LatestQuery },
  { method: 'GET', path: '/api/audience/snapshots', tag: 'audience', summary: 'Snapshots, optionally for one platform and since a date', query: dto.SnapshotQuery },
  { method: 'POST', path: '/api/audience/snapshots', tag: 'audience', summary: 'Record a snapshot (analyst or creator)', body: dto.CreateSnapshotDto },
  { method: 'DELETE', path: '/api/audience/snapshots/{id}', tag: 'audience', summary: 'Delete a snapshot (creator only; analytics keeps a retraction)' },
  { method: 'GET', path: '/api/audience/tiktok-vault', tag: 'audience', summary: 'Normalised TikTok Studio export data' },
  { method: 'PUT', path: '/api/audience/tiktok-vault', tag: 'audience', summary: 'Upload export data (creator only)', body: dto.TikTokVaultDto },
  { method: 'GET', path: '/api/analytics/catalog', tag: 'analytics', summary: 'Governed table definitions' },
  { method: 'GET', path: '/api/analytics/series', tag: 'analytics', summary: 'One metric over time for one platform', query: dto.SeriesQuery },
  { method: 'GET', path: '/api/analytics/summary', tag: 'analytics', summary: 'Start, end and net per metric for one platform', query: dto.SummaryQuery },

  ...crud('content', '/api/content', dto.CreateContentDto, dto.UpdateContentDto),
  { method: 'GET', path: '/api/content/{id}', tag: 'content', summary: 'One content item' },
  { method: 'GET', path: '/api/content-items', tag: 'content-items', summary: 'Content items: the shared id everything hangs off' },
  { method: 'POST', path: '/api/content-items', tag: 'content-items', summary: 'Create a content item (the API assigns the id)', body: dto.CreateContentDto },
  { method: 'GET', path: '/api/content-items/{id}', tag: 'content-items', summary: 'One content item' },
  { method: 'GET', path: '/api/content-items/{id}/handoffs', tag: 'content-items', summary: 'The handoff thread for an item, oldest first' },
  { method: 'GET', path: '/api/content-items/{id}/next-step', tag: 'content-items', summary: 'Latest analysis, brief, open approvals and one recommended next action' },
  { method: 'POST', path: '/api/content-items/{id}/decision', tag: 'content-items', summary: 'Approve, request changes or kill (creator only)', body: dto.DecisionDto, roles: ['creator'] },

  { method: 'GET', path: '/api/handoffs', tag: 'handoffs', summary: 'Handoffs, e.g. ?acknowledged=false', query: dto.HandoffQuery },
  { method: 'POST', path: '/api/handoffs', tag: 'handoffs', summary: 'Send a handoff as yourself', body: dto.CreateHandoffDto },
  { method: 'POST', path: '/api/handoffs/{id}/ack', tag: 'handoffs', summary: 'Mark read by its recipient' },

  ...crud('briefs', '/api/briefs', dto.CreateCreativeBriefDto, dto.UpdateCreativeBriefDto),
  ...crud('hooks', '/api/hooks', dto.CreateHookDto, dto.UpdateHookDto),
  ...crud('scripts', '/api/scripts', dto.CreateScriptDto, dto.UpdateScriptDto),
  ...crud('captions', '/api/captions', dto.CreateCaptionDto, dto.UpdateCaptionDto),

  ...crud('experiments', '/api/experiments', dto.CreateExperimentDto, dto.UpdateExperimentDto),
  ...crud('engagement-queue', '/api/engagement-queue', dto.CreateEngagementDto, dto.UpdateEngagementDto, { patch: true }),
  ...crud('leads', '/api/leads', dto.CreateLeadDto, dto.UpdateLeadDto),
  ...crud('keywords', '/api/keywords', dto.CreateKeywordDto, dto.UpdateKeywordDto),
  ...crud('resources', '/api/resources', dto.CreateResourceDto, dto.UpdateResourceDto),
  ...crud('tasks', '/api/tasks', dto.CreateTaskDto, dto.UpdateTaskDto),
  ...crud('checkins', '/api/checkins', dto.CreateCheckInDto, dto.UpdateCheckInDto),
  ...crud('reports', '/api/reports', dto.CreateReportDto, dto.UpdateReportDto),
  { method: 'GET', path: '/api/settings', tag: 'settings', summary: 'Dashboard settings' },
  { method: 'PUT', path: '/api/settings', tag: 'settings', summary: 'Replace settings (creator only)', body: dto.SettingsDto },

  { method: 'GET', path: '/api/events', tag: 'events', summary: 'Webhook outbox: every event, its recipient and delivery status' },
  { method: 'POST', path: '/api/dispatch/daily-audit', tag: 'events', summary: "Send today's daily_audit to the analyst (scheduler)", roles: DISPATCH },
  { method: 'POST', path: '/api/dispatch/measure-requests', tag: 'events', summary: 'Send measure_request for posts published 24h or 72h ago (scheduler)', roles: DISPATCH },
  { method: 'POST', path: '/api/dispatch/weekly-refresh', tag: 'events', summary: 'Send weekly_refresh to the creative agent: TikTok and Threads snapshots for the week (scheduler)', roles: DISPATCH },
  { method: 'POST', path: '/api/dispatch/engagement-sweep', tag: 'events', summary: 'Send engagement_sweep to the creative agent: new TikTok, Threads and Instagram engagement into the queue, one per 4-hour UTC window (scheduler)', roles: DISPATCH },
  { method: 'POST', path: '/api/dispatch/x-refresh', tag: 'events', summary: 'Send x_refresh to the analyst: one X snapshot per 4-hour UTC window (scheduler)', roles: DISPATCH },

  { method: 'POST', path: '/mcp', tag: 'mcp', summary: 'MCP server for the analyst (streamable HTTP, stateless). Tools wrap the routes above', roles: ['analyst'] },
  { method: 'GET', path: '/mcp', tag: 'mcp', summary: 'MCP: no server-sent stream in stateless mode (405)', roles: ['analyst'] },
  { method: 'DELETE', path: '/mcp', tag: 'mcp', summary: 'MCP: no sessions to end in stateless mode (405)', roles: ['analyst'] },

  { method: 'POST', path: '/api/migrations/import', tag: 'migrations', summary: 'One-time import with a receipt (creator only)', body: dto.ImportDto, roles: ['creator'] },
  { method: 'GET', path: '/api/migrations', tag: 'migrations', summary: 'Migration receipts' },
]

export const rolesFor = (r: RouteSpec): readonly Role[] => r.roles ?? AUTHORS
