# Growth OS

A draft-only growth dashboard for creators on TikTok and X. Plan a 30-day content calendar, draft replies to comments, track real analytics from platform exports, and coordinate two AI agents: an analyst and a creative. Nothing in the app posts, publishes or sends. You approve and publish everything yourself.

![Overview: mission control for a fictional sample creator](docs/screenshots/overview.png)

## Try it

```
git clone https://github.com/daylorza/growth-os-app.git
cd growth-os-app/app
pnpm install
pnpm dev
```

Open the URL it prints. The app starts on **Nova**, a fictional sample creator with generated data. Choose **Make it yours** to swap the sample for your own empty workspace: your name, brand, agent names and handles. Your data stays in your browser.

Requires Node 22.18+ and [pnpm](https://pnpm.io).

## What's inside

| Module | What it does |
|---|---|
| Overview | Followers, growth target, weekly cadence, campaign week, today's priorities, what's waiting on you |
| Audience Growth | TikTok and X follower history, 7/14/28-day views and engagement, audience signals, per-video table |
| Content Studio | 30-day calendar and creative briefs: three hooks, script, visuals, caption, CTA, native X version |
| Engagement Hub | Comment queue with categories, keyword campaigns and reply drafts that warn on prices, DM promises and repeats |
| Agent Control | Copyable system prompts for the analyst and creative agents, handoff chain, weekly loop, handoff log |
| Content Intelligence | Content mix vs targets, experiment log, weekly audience report, auto-drafted weekly report |
| Brand & Revenue | Lead pipeline. Revenue only counts with evidence |
| Goals & Accountability | 30-day plan, morning and evening check-ins, tasks with "smallest next action" for anything overdue |
| Settings & Integrations | Workspace profile, account connectors, approved brief, draft-only permissions, backup and restore |

![Audience Growth: TikTok export analytics](docs/screenshots/audience.png)

## Principles

- **Draft-only.** Approval gates are built into the flow. A post can't be logged as published without your approval and a live URL. Sensitive comments can only be escalated, never auto-answered. Keyword campaigns stay off until there's a real resource to deliver.
- **No invented numbers.** Unknown values stay `UNKNOWN`. Metrics show "Unavailable" rather than guessing. TikTok views and X impressions are never added together.
- **Private by default.** Everything lives in your browser's local storage. There are no accounts, no tracking and no server.

## Connect your accounts

All connectors are read-only. Set them up in **Settings → Accounts and connectors**.

- **Export files (works today for TikTok).** Download the Overview, Content, Viewers and Followers CSVs from TikTok Studio and import them. The parser fills in the year TikTok leaves out of its dates, takes post years from the video ID, and drops the occasional "0 followers" glitch day.
- **X, Instagram, YouTube, LinkedIn.** Connector slots are in place. Each parser is built from a real sample export, so the format is never guessed.
- **OAuth "Connect" buttons.** The client side is ready. Set `VITE_CONNECTOR_SERVER` to a server that implements the contract in [`app/src/lib/oauth.ts`](app/src/lib/oauth.ts). The server runs OAuth and keeps tokens; the browser only receives read-only, normalised data.

## Your own workspace on disk

For a permanent personal setup, create a `private/` folder at the repo root. It's gitignored.

```
private/
  workspace.json              # your profile and starting data (Settings → Export backup)
  vault/tiktok/inbox/         # drop TikTok Studio exports here
  brand/MASTER_AGENT_PROMPT.md  # optional: your own agent system prompt
```

Then run `cd app && pnpm tiktok:ingest`. New exports are copied into an immutable `raw/` folder with SHA-256 receipts, and the app's snapshot is regenerated. Re-running skips files it has already seen.

A test fails if any tracked file contains a name or handle from `private/workspace.json`. Never deploy a build made while `private/` exists, because it bundles that data. Build from a clean clone, or set `VITE_IGNORE_PRIVATE=1`.

## Development

```
cd app
pnpm test     # formulas, guards, parsers, privacy guard
pnpm lint
pnpm build
```

Vite, React 19, TypeScript and Tailwind CSS v4. Code layout and project rules are in [AGENTS.md](AGENTS.md). Changes go through a branch and a pull request.
