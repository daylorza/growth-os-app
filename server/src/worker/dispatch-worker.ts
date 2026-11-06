/**
 * Scheduler for the agent loop (run by systemd timers on the host). It contains no LLM call and no
 * social-platform call: it only asks the endpoint to dispatch events, and the endpoint wakes the agents.
 *
 *   node dist/worker/dispatch-worker.js daily     daily_audit to the analyst (idempotent per day)
 *   node dist/worker/dispatch-worker.js measure   measure_request 24h and 72h after a post is published
 *
 * Env: GROWTH_OS_API (default http://127.0.0.1:8767), GROWTH_OS_WORKER_KEY (scheduler key: dispatch routes only).
 */
const ROUTES = { daily: '/api/dispatch/daily-audit', measure: '/api/dispatch/measure-requests' } as const

async function main() {
  const mode = process.argv[2] as keyof typeof ROUTES
  if (!ROUTES[mode]) throw new Error('Usage: dispatch-worker daily|measure')
  const key = process.env.GROWTH_OS_WORKER_KEY
  if (!key) throw new Error('GROWTH_OS_WORKER_KEY is required.')
  const api = (process.env.GROWTH_OS_API ?? 'http://127.0.0.1:8767').replace(/\/$/, '')
  const res = await fetch(`${api}${ROUTES[mode]}`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'x-growth-source': 'scheduler' } })
  const text = await res.text()
  if (!res.ok) throw new Error(`${ROUTES[mode]} → ${res.status} ${text}`)
  console.log(text)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
