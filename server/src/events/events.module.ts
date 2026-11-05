import { Controller, Get, Inject, Injectable, Logger, Module, type OnModuleDestroy } from '@nestjs/common'
import type { EventName, EventRecord, Handoff, Owner, WebhookPayload } from '@growth-os/contracts'
import { CONFIG, type AppConfig } from '../config'
import { DuplicateIdError, Store } from '../db/store'

const RETRIES = 3
const TIMEOUT_MS = 10_000

/** Which event a handoff type raises when an agent writes it. Internal handoffs pass their event explicitly. */
export const EVENT_FOR_TYPE: Partial<Record<Handoff['type'], EventName>> = {
  analysis: 'analysis_created',
  brief: 'brief_created',
  result: 'experiment_logged',
}

/**
 * Webhook outbox. Every event is stored first (id `<event>:<handoffId>:<to>`), then delivered to the
 * recipient's webhook with 3 retries and exponential backoff. The handoff id is sent as the idempotency key,
 * and a repeated event for the same handoff is never stored or sent twice. Recipients without a webhook
 * (the creator, or an agent that reads the API) get status `no_listener` and read it from the API.
 * This service only POSTs to configured listener URLs. It never calls a social platform.
 */
@Injectable()
export class EventsService implements OnModuleDestroy {
  private readonly log = new Logger('events')
  private readonly inflight = new Set<Promise<void>>()

  constructor(
    private readonly store: Store,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private get repo() {
    return this.store.collection<EventRecord>('events')
  }

  list() {
    return this.repo.list()
  }

  async emit(event: EventName, handoff: Handoff): Promise<EventRecord | null> {
    const to: Owner = handoff.to
    const payload: WebhookPayload = { event, contentItemId: handoff.contentItemId, handoffId: handoff.id, from: handoff.from, at: new Date().toISOString() }
    const hook = this.config.webhooks[to]
    const record: EventRecord = { id: `${event}:${handoff.id}:${to}`, to, payload, status: hook ? 'pending' : 'no_listener', attempts: 0 }
    try {
      await this.repo.insert(record)
    } catch (e) {
      if (e instanceof DuplicateIdError) return null // already sent for this handoff
      throw e
    }
    if (hook) this.track(this.deliver(record, hook.url, hook.key))
    return record
  }

  private track(p: Promise<void>) {
    this.inflight.add(p)
    void p.finally(() => this.inflight.delete(p))
  }

  private async deliver(record: EventRecord, url: string, key: string) {
    let lastError = ''
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, this.config.webhookRetryBaseMs * 4 ** (attempt - 1)))
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(key ? { authorization: `Bearer ${key}`, 'x-webhook-key': key } : {}),
            'idempotency-key': record.payload.handoffId,
            'x-growth-event': record.payload.event,
          },
          body: JSON.stringify(record.payload),
          signal: AbortSignal.timeout(TIMEOUT_MS),
          redirect: 'error',
        })
        if (res.ok) {
          await this.repo.replace({ ...record, status: 'delivered', attempts: attempt + 1, deliveredAt: new Date().toISOString() })
          return
        }
        lastError = `HTTP ${res.status}`
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
      }
      await this.repo.replace({ ...record, status: 'pending', attempts: attempt + 1, lastError })
    }
    this.log.warn(`Webhook ${record.id} failed after ${RETRIES + 1} attempts: ${lastError}`)
    await this.repo.replace({ ...record, status: 'failed', attempts: RETRIES + 1, lastError })
  }

  /** Waits for deliveries in flight (tests, shutdown). */
  async idle() {
    while (this.inflight.size) await Promise.allSettled([...this.inflight])
  }

  async onModuleDestroy() {
    await this.idle()
  }
}

@Controller('api/events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list() {
    return this.events.list()
  }
}

@Module({ controllers: [EventsController], providers: [EventsService], exports: [EventsService] })
export class EventsModule {}
