import { Module, ValidationPipe, type DynamicModule } from '@nestjs/common'
import { APP_PIPE } from '@nestjs/core'
import { AnalyticsModule } from './analytics/analytics.module'
import { AudienceModule } from './audience/audience.module'
import { AuthModule } from './auth/auth.module'
import { BriefModule } from './brief/brief.module'
import { VALIDATION } from './common/validation'
import { CONFIG, type AppConfig } from './config'
import { ContentModule } from './content/content.module'
import { CreativeModule } from './creative/creative.module'
import { EventsModule } from './events/events.module'
import { McpModule } from './mcp/mcp.module'
import { OpenApiModule } from './openapi/openapi.module'
import { DbModule } from './db/db.module'
import type { Store } from './db/store'
import { EngagementModule } from './engagement/engagement.module'
import { ExperimentsModule } from './experiments/experiments.module'
import { HandoffsModule } from './handoffs/handoffs.module'
import { HealthModule } from './health/health.module'
import { LeadsModule } from './leads/leads.module'
import { ProfilesModule } from './profiles/profiles.module'
import { StateModule } from './state/state.module'
import { WorkspaceModule } from './workspace/workspace.module'

@Module({})
export class AppModule {
  static create(config: AppConfig, store: Store): DynamicModule {
    return {
      module: AppModule,
      imports: [
        { module: ConfigHolder, global: true, providers: [{ provide: CONFIG, useValue: config }], exports: [CONFIG] },
        DbModule.forStore(store),
        AuthModule,
        HealthModule,
        ProfilesModule,
        BriefModule,
        AudienceModule,
        AnalyticsModule,
        EventsModule,
        ContentModule,
        CreativeModule,
        HandoffsModule,
        ExperimentsModule,
        EngagementModule,
        LeadsModule,
        WorkspaceModule,
        StateModule,
        OpenApiModule,
        McpModule,
      ],
      providers: [{ provide: APP_PIPE, useValue: new ValidationPipe(VALIDATION) }],
    }
  }
}

@Module({})
class ConfigHolder {}
