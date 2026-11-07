/**
 * Request DTOs for every route, validated by class-validator in the API (whitelist + forbidNonWhitelisted:
 * unknown fields are rejected). The OpenAPI spec is generated from these classes.
 */
import 'reflect-metadata'
import { PartialType } from '@nestjs/mapped-types'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateBy,
  ValidateNested,
  type ValidationOptions,
} from 'class-validator'
import { JSONSchema } from 'class-validator-jsonschema'
import {
  APPROVALS,
  COMMENT_CATEGORIES,
  CONTENT_STATUSES,
  DECISIONS,
  DRAFT_STATUSES,
  ENGAGEMENT_PLATFORMS,
  EXPERIMENT_STATUSES,
  HANDOFF_TYPES,
  HOOK_KINDS,
  LEAD_STATUSES,
  LEAD_TYPES,
  MODES,
  OWNERS,
  PILLARS,
  PLATFORMS,
  REPLY_STATUSES,
  SNAPSHOT_SOURCE_TYPES,
  type AudienceSnapshot,
  type CheckIn,
  type ContentItem,
  type Decision,
  type DraftStatus,
  type Engagement,
  type Experiment,
  type HandoffType,
  type Lead,
  type Owner,
  type Platform,
  type Task,
} from './domain'
import { UNKNOWN } from './unknown'
import { ID_PATTERN, ISO_DATE, OptionalText, RequiredText } from './validation'

// ---------- shared ----------

/** A non-negative number or the literal "UNKNOWN". null is accepted and stored as UNKNOWN. Never 0 as a stand-in. */
export const IsMetric = (options?: ValidationOptions) => (target: object, key: string) => {
  ValidateBy(
    {
      name: 'isMetric',
      validator: {
        validate: (v: unknown) => v === UNKNOWN || v === null || v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= 0),
        defaultMessage: (a) => `${a?.property} must be a non-negative number or "UNKNOWN".`,
      },
    },
    options,
  )(target, key)
  JSONSchema(() => ({ oneOf: [{ type: 'number', minimum: 0 }, { type: 'string', enum: [UNKNOWN] }] }))(target, key)
}

export class RefDto {
  @RequiredText(64) collection: string
  @Matches(ID_PATTERN) id: string
}

// ---------- content ----------

export class PostMetricsDto {
  @IsOptional() @IsNumber() views?: number
  @IsOptional() @IsNumber() avgWatchSec?: number
  @IsOptional() @IsNumber() completionPct?: number
  @IsOptional() @IsNumber() shares?: number
  @IsOptional() @IsNumber() saves?: number
  @IsOptional() @IsNumber() comments?: number
  @IsOptional() @IsNumber() profileVisits?: number
  @IsOptional() @IsNumber() follows?: number
  @IsOptional() @IsBoolean() sameCohort?: boolean
  @IsOptional() @IsNumber() ageHours?: number
  @IsOptional() @IsString() measuredAt?: string
  @IsOptional() @IsString() source?: string
}

export class CreateContentDto {
  @IsOptional() @Matches(ID_PATTERN) id?: string
  @OptionalText() title?: string
  @IsOptional() @IsIn(OWNERS) owner?: ContentItem['owner']
  @IsOptional() @IsIn(CONTENT_STATUSES) status?: ContentItem['status']
  @IsOptional() @IsIn(PLATFORMS) platform?: ContentItem['platform']
  @IsOptional() @Matches(ISO_DATE) plannedDate?: string
  @IsOptional() @IsIn(PILLARS) pillar?: ContentItem['pillar']
  @OptionalText() format?: string
  @IsOptional() @IsIn(MODES) mode?: ContentItem['mode']
  @OptionalText() objective?: string
  @OptionalText() audience?: string
  @OptionalText() hookCuriosity?: string
  @OptionalText() hookOpinion?: string
  @OptionalText() hookOutcome?: string
  @OptionalText(20_000) talkingPoints?: string
  @OptionalText() visuals?: string
  @OptionalText() caption?: string
  @OptionalText() hashtags?: string
  @OptionalText() cta?: string
  @OptionalText() xAdaptation?: string
  @OptionalText() claimSource?: string
  @IsOptional() @IsIn(APPROVALS) approval?: ContentItem['approval']
  @OptionalText() experimentId?: string
  @IsOptional() @IsString() @MaxLength(2000) url?: string
  @OptionalText() publishedAt?: string
  @IsOptional() @IsObject() @ValidateNested() @Type(() => PostMetricsDto) metrics?: PostMetricsDto
  @IsOptional() @IsBoolean() demo?: boolean
}
export class UpdateContentDto extends PartialType(CreateContentDto) {}

export class DecisionDto {
  @IsIn(DECISIONS) decision: Decision
  @OptionalText() note?: string
}

// ---------- handoffs ----------

export class CreateHandoffDto {
  @IsOptional() @Matches(ID_PATTERN) id?: string
  /** A content item id, or AUDIT-YYYY-MM-DD for a daily audit. */
  @Matches(ID_PATTERN) contentItemId: string
  /** Defaults to the caller's role. Agents can only send as themselves. */
  @IsOptional() @IsIn(OWNERS) from?: Owner
  @IsIn(OWNERS) to: Owner
  @IsIn(HANDOFF_TYPES) type: HandoffType
  @RequiredText(100_000) body: string
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => RefDto) refs?: RefDto[]
  @IsOptional() @IsISO8601() createdAt?: string
  @IsOptional() @IsBoolean() demo?: boolean
}

export class HandoffQuery {
  @IsOptional() @IsIn(['true', 'false']) acknowledged?: 'true' | 'false'
  @IsOptional() @IsIn(OWNERS) to?: Owner
  @IsOptional() @Matches(ID_PATTERN) contentItemId?: string
}

// ---------- creative collections (creative agent writes) ----------

export class CreateCreativeBriefDto {
  @IsOptional() @Matches(ID_PATTERN) id?: string
  @Matches(ID_PATTERN) contentItemId: string
  /** The analysis handoff this brief is based on. Required: no brief without a cited source. */
  @Matches(ID_PATTERN) sourceHandoffId: string
  @IsOptional() @IsIn(DRAFT_STATUSES) status?: DraftStatus
  @OptionalText() objective?: string
  @OptionalText() audience?: string
  @OptionalText(20_000) talkingPoints?: string
  @OptionalText() cta?: string
  @OptionalText() xAdaptation?: string
  @OptionalText() claimSource?: string
  @OptionalText(50_000) body?: string
}
export class UpdateCreativeBriefDto extends PartialType(CreateCreativeBriefDto) {}

export class CreateHookDto {
  @IsOptional() @Matches(ID_PATTERN) id?: string
  @Matches(ID_PATTERN) contentItemId: string
  @IsOptional() @IsIn(DRAFT_STATUSES) status?: DraftStatus
  @IsIn(HOOK_KINDS) kind: (typeof HOOK_KINDS)[number]
  @RequiredText(1000) text: string
}
export class UpdateHookDto extends PartialType(CreateHookDto) {}

export class CreateScriptDto {
  @IsOptional() @Matches(ID_PATTERN) id?: string
  @Matches(ID_PATTERN) contentItemId: string
  @IsOptional() @IsIn(DRAFT_STATUSES) status?: DraftStatus
  @RequiredText(50_000) body: string
}
export class UpdateScriptDto extends PartialType(CreateScriptDto) {}

export class CreateCaptionDto {
  @IsOptional() @Matches(ID_PATTERN) id?: string
  @Matches(ID_PATTERN) contentItemId: string
  @IsOptional() @IsIn(DRAFT_STATUSES) status?: DraftStatus
  @IsIn(PLATFORMS) platform: Platform
  @RequiredText(5000) text: string
  @OptionalText(1000) hashtags?: string
}
export class UpdateCaptionDto extends PartialType(CreateCaptionDto) {}

// ---------- analyst collections ----------

export class CreateExperimentDto {
  @IsOptional() @Matches(ID_PATTERN) id?: string
  @OptionalText() hypothesis?: string
  @OptionalText() change?: string
  @OptionalText() audiencePillar?: string
  @OptionalText() posts?: string
  @OptionalText() primaryMetric?: string
  @OptionalText() baseline?: string
  @OptionalText() window?: string
  @OptionalText() result?: string
  @OptionalText() confidence?: string
  @OptionalText() nextAction?: string
  @IsOptional() @IsIn(EXPERIMENT_STATUSES) status?: Experiment['status']
  @IsOptional() @Matches(ID_PATTERN) contentItemId?: string
  @IsOptional() @IsBoolean() demo?: boolean
}
export class UpdateExperimentDto extends PartialType(CreateExperimentDto) {}

export class CreateEngagementDto {
  @IsOptional() @Matches(ID_PATTERN) id?: string
  @IsOptional() @IsIn(ENGAGEMENT_PLATFORMS) platform?: Engagement['platform']
  @OptionalText(100) account?: string
  @OptionalText() sourcePost?: string
  @OptionalText() author?: string
  @OptionalText() comment?: string
  @OptionalText() keyword?: string
  @IsOptional() @IsIn(COMMENT_CATEGORIES) category?: Engagement['category']
  @OptionalText() draftReply?: string
  @IsOptional() @IsIn(REPLY_STATUSES) status?: Engagement['status']
  @OptionalText() leadId?: string
  @OptionalText() note?: string
  @OptionalText() createdAt?: string
  @OptionalText() updatedAt?: string
  @IsOptional() @IsBoolean() demo?: boolean
}
export class UpdateEngagementDto extends PartialType(CreateEngagementDto) {}

export class CreateLeadDto {
  @IsOptional() @Matches(ID_PATTERN) id?: string
  @OptionalText() handle?: string
  @IsOptional() @IsIn([...ENGAGEMENT_PLATFORMS, 'other']) platform?: Lead['platform']
  @IsOptional() @IsIn(LEAD_TYPES) type?: Lead['type']
  @IsOptional() @IsIn(LEAD_STATUSES) status?: Lead['status']
  @OptionalText() summary?: string
  @OptionalText() nextStep?: string
  @OptionalText() source?: string
  @IsOptional() @IsNumber() @Min(0) attributedRevenue?: number
  @OptionalText() revenueEvidence?: string
  @OptionalText() createdAt?: string
  @IsOptional() @IsBoolean() demo?: boolean
}
export class UpdateLeadDto extends PartialType(CreateLeadDto) {}

// ---------- audience and analytics ----------

export class MetricsDto {
  @IsOptional() @IsMetric() followers?: number | 'UNKNOWN'
  @IsOptional() @IsMetric() following?: number | 'UNKNOWN'
  @IsOptional() @IsMetric() posts?: number | 'UNKNOWN'
  @IsOptional() @IsMetric() views7d?: number | 'UNKNOWN'
  @IsOptional() @IsMetric() views14d?: number | 'UNKNOWN'
  @IsOptional() @IsMetric() views28d?: number | 'UNKNOWN'
  /** Percent, e.g. 5.8 for 5.8%. */
  @IsOptional() @IsMetric() engagementRate?: number | 'UNKNOWN'
}

export class CreateSnapshotDto {
  @IsOptional() @Matches(ID_PATTERN) id?: string
  @IsIn(PLATFORMS) platform: Platform
  @Matches(ISO_DATE) date: string
  @RequiredText(300) source: string
  @IsOptional() @IsIn(SNAPSHOT_SOURCE_TYPES) sourceType?: AudienceSnapshot['sourceType']
  @IsObject() @ValidateNested() @Type(() => MetricsDto) metrics: MetricsDto
  @IsOptional() @IsBoolean() verified?: boolean
  @IsOptional() @IsBoolean() demo?: boolean
}

export class LatestQuery {
  @IsIn(PLATFORMS, { message: 'platform must be tiktok, x or threads. Platforms are reported separately and never combined.' }) platform: Platform
}

export class SnapshotQuery {
  @IsOptional() @IsIn(PLATFORMS) platform?: Platform
  /** Only snapshots on or after this date, e.g. the last four weeks. */
  @IsOptional() @Matches(ISO_DATE) since?: string
}

export class TikTokVaultDto {
  @IsNumber() version: number
  @IsString() @MaxLength(200) handle: string
  @IsString() generatedAt: string
  @IsArray() exports: unknown[]
  @IsArray() daily: unknown[]
  @IsArray() viewers: unknown[]
  @IsArray() followers: unknown[]
  @IsArray() videos: unknown[]
  @IsObject() audience: Record<string, unknown>
}

export const METRICS = ['followers', 'following', 'posts', 'views7d', 'views14d', 'views28d', 'engagementRate'] as const
export type MetricName = (typeof METRICS)[number]

export class SeriesQuery {
  @IsIn(PLATFORMS, { message: 'platform must be tiktok, x or threads. Platforms are never combined.' }) platform: Platform
  @IsIn(METRICS) metric: MetricName
}

export class SummaryQuery {
  @IsIn(PLATFORMS, { message: 'platform must be tiktok, x or threads. Platforms are never combined.' }) platform: Platform
  @IsOptional() @Matches(ISO_DATE) from?: string
  @IsOptional() @Matches(ISO_DATE) to?: string
}

// ---------- profile, brief, workspace ----------

export class AgentProfileDto {
  @RequiredText(200) name: string
  @RequiredText(500) role: string
}

export class AgentsDto {
  @ValidateNested() @Type(() => AgentProfileDto) analyst: AgentProfileDto
  @ValidateNested() @Type(() => AgentProfileDto) creative: AgentProfileDto
}

export class ProfileDto {
  @RequiredText(200) creatorName: string
  @RequiredText(200) brandName: string
  @RequiredText(200) company: string
  @RequiredText(200) projectName: string
  @IsObject() handles: Record<string, string>
  @ValidateNested() @Type(() => AgentsDto) agents: AgentsDto
  @IsBoolean() sample: boolean
  @IsOptional() @IsString() @MaxLength(200_000) masterPrompt?: string
}

export const BRIEF_KEYS = [
  'tiktokHandle',
  'xHandle',
  'timezone',
  'availability',
  'goals',
  'idealAudience',
  'projectEvent',
  'projectCapabilities',
  'projectPrize',
  'offers',
  'landingPage',
  'contactRoute',
  'publicResources',
  'approvedClaims',
  'boundaries',
  'analyticsAccess',
  'approvalPolicy',
  'disclosure',
] as const
export type BriefKey = (typeof BRIEF_KEYS)[number]

export class BriefFieldDto {
  @IsIn(BRIEF_KEYS) key: BriefKey
  @OptionalText() value?: string
  @IsOptional() @IsBoolean() verified?: boolean
  @OptionalText(300) source?: string
}

export class PatchBriefDto {
  @IsArray() @ArrayMaxSize(BRIEF_KEYS.length) @ValidateNested({ each: true }) @Type(() => BriefFieldDto) fields: BriefFieldDto[]
}

export class CreateKeywordDto {
  @IsOptional() @Matches(ID_PATTERN) id?: string
  @OptionalText(200) keyword?: string
  @OptionalText() approvedResource?: string
  @OptionalText() deliveryMethod?: string
  @OptionalText() cta?: string
  @OptionalText() replyTemplate?: string
  @IsOptional() @IsBoolean() active?: boolean
  /** A resource id, or empty for none (the dashboard clears it with ''). */
  @IsOptional() @Matches(/^(|[A-Za-z0-9][A-Za-z0-9_.:-]{0,63})$/) resourceId?: string
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @Matches(/^https?:\/\/\S+$/, { each: true, message: 'postUrls must be links' }) @MaxLength(500, { each: true }) postUrls?: string[]
  @IsOptional() @IsBoolean() demo?: boolean
}
export class UpdateKeywordDto extends PartialType(CreateKeywordDto) {}

export class CreateResourceDto {
  @IsOptional() @Matches(ID_PATTERN) id?: string
  @RequiredText(200) name: string
  @Matches(/^https:\/\/\S+$/, { message: 'url must be an https link' }) @MaxLength(1000) url: string
  @OptionalText(1000) description?: string
  @IsOptional() @IsBoolean() demo?: boolean
}
export class UpdateResourceDto extends PartialType(CreateResourceDto) {}

export class CreateTaskDto {
  @IsOptional() @Matches(ID_PATTERN) id?: string
  @OptionalText(500) title?: string
  @IsOptional() @IsIn(OWNERS) owner?: Task['owner']
  @IsOptional() @Matches(ISO_DATE) date?: string
  @IsOptional() @IsBoolean() done?: boolean
  @OptionalText(500) nextSmallestAction?: string
  @IsOptional() @IsBoolean() demo?: boolean
}
export class UpdateTaskDto extends PartialType(CreateTaskDto) {}

export class CreateCheckInDto {
  @IsOptional() @Matches(ID_PATTERN) id?: string
  @IsOptional() @Matches(ISO_DATE) date?: string
  @IsOptional() @IsIn(['morning', 'evening']) kind?: CheckIn['kind']
  @IsOptional() @IsObject() fields?: Record<string, string>
}
export class UpdateCheckInDto extends PartialType(CreateCheckInDto) {}

export class CreateReportDto {
  @IsOptional() @Matches(ID_PATTERN) id?: string
  @IsOptional() @Matches(ISO_DATE) weekOf?: string
  @OptionalText() repeatedQuestions?: string
  @OptionalText() evidence?: string
  @OptionalText() objections?: string
  @OptionalText() requestedTopics?: string
  @OptionalText() businessSignals?: string
  @OptionalText() opportunities?: string
  @OptionalText() limitations?: string
  @IsOptional() @IsBoolean() demo?: boolean
}
export class UpdateReportDto extends PartialType(CreateReportDto) {}

export class SettingsDto {
  @Matches(ISO_DATE) campaignStart: string
  @IsNumber() tiktokGoal: number
  @IsNumber() weeklyTikTokTarget: number
  @IsObject() planChecks: Record<string, boolean>
}

/** A dashboard backup (Settings → Export backup) or a private workspace file, plus optional extras. */
export class ImportDto {
  @IsOptional() @IsObject() profile?: ProfileDto
  @IsOptional() @IsObject() brief?: Record<string, { value?: string; verified?: boolean; source?: string }>
  @IsOptional() @IsObject() settings?: SettingsDto
  @IsOptional() @IsArray() content?: object[]
  @IsOptional() @IsArray() engagements?: object[]
  @IsOptional() @IsArray() keywords?: object[]
  @IsOptional() @IsArray() resources?: object[]
  @IsOptional() @IsArray() snapshots?: object[]
  @IsOptional() @IsArray() experiments?: object[]
  @IsOptional() @IsArray() reports?: object[]
  @IsOptional() @IsArray() leads?: object[]
  @IsOptional() @IsArray() tasks?: object[]
  @IsOptional() @IsArray() checkins?: object[]
  @IsOptional() @IsArray() handoffs?: object[]
  @IsOptional() @IsObject() tiktokVault?: object
  @IsOptional() @IsString() @MaxLength(200_000) masterPrompt?: string
  @IsOptional() @IsString() @MaxLength(300) label?: string
}
