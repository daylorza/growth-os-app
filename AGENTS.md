# Growth OS

A draft-only growth dashboard for creators: content planning, engagement drafts, analytics from platform exports, and two AI agent roles (analyst and creative). If `private/AGENTS.md` exists, read it too: it holds the workspace owner's personal rules.

## Hard rules
- Draft-only. The app never posts, publishes, messages or auto-acts. The creator approves and publishes.
- Never invent numbers. Unknown values stay `UNKNOWN`; example records carry `demo: true`.
- No passwords or two-factor codes anywhere.
- **Privacy:** personal data lives only in `private/` (gitignored): profile, handles, brief, analytics exports, brand docs. Never commit it, never copy names, handles or numbers from it into tracked files. `pnpm test` fails if a tracked file contains an identifier from `private/workspace.json`.
- One branch per change, open a PR. Never merge or push to `main`.

## App (`app/`)
Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4. State lives in `src/lib/store.ts`: browser localStorage in local mode, the NestJS endpoint when `GROWTH_OS_API` is set (localStorage is then only a read-only offline cache).

Use **pnpm** (npm 10 crashes with an arborist `edgesOut` error on this dependency tree).

```
cd app
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # vitest: formulas, guards, privacy guard, parsers, sync diff
pnpm lint       # oxlint
pnpm build      # tsc --noEmit && next build
```

Layout: `src/app/` (App Router: one route per module, `api/[...path]` pass-through to the endpoint), `src/proxy.ts` (page auth via the endpoint), `src/lib/` (types, store, remote sync, seeds, metrics, rules/guards, connectors, TikTok parsing; `*.server.ts` is server-only), `src/components/` (`ui.tsx`, `Shell.tsx`, `server/` Server Components), `src/modules/` (one client component per nav module).

## API (`server/`)
NestJS 12 + MongoDB driver. One module per domain, logic in services, DTOs from `@growth-os/contracts`, global auth guard driven by the contract route table. Services use the `Repository` interface (`src/db/store.ts`), never the driver. Tests run on the in-memory store. Roles in code are `creator`, `analyst`, `creative` (plus `worker` for the scheduler); agent names come from the profile and the host environment. Never add a route or client that posts, publishes, replies, likes, follows or messages on any platform.

pnpm workspace: run `pnpm install` once at the repo root (`app`, `server`, `packages/contracts`). From the root: `pnpm test`, `pnpm lint` (includes `ci/no-platform-writes.sh`), `pnpm build`; `ci/check.sh` is the CI pipeline (GitHub and GitLab).

## Contracts (`packages/contracts`)
DTOs, domain types, the collection ownership table and the route table. Change a DTO or route here, then `pnpm openapi` and commit `openapi.json` (tests and the build fail if it is stale). The server's routes must equal the route table.

## Workspaces
- No `private/` folder: the app shows a fictional sample creator with generated data, plus a "Make it yours" setup.
- `private/workspace.json`: the owner's profile and starting data (an exported backup from Settings works).
- `GROWTH_OS_IGNORE_PRIVATE=1 pnpm dev` previews the public sample even when `private/` exists.
- Names shown in the UI (creator, agents, brand, company, project) all come from the profile. Never hardcode them.

## Connectors (`src/lib/connectors.ts`, `src/lib/oauth.ts`)
- Export files (works now for TikTok): import CSVs in Settings, or use the vault below.
- OAuth: set `NEXT_PUBLIC_CONNECTOR_SERVER` to a server implementing the contract in `oauth.ts`. Tokens stay on that server; the browser only gets read-only normalised data.
- Adding a platform's export parser needs a real sample export first. Never guess a file format.

## TikTok vault (`private/vault/tiktok/`)
1. Download the four-role export from TikTok Studio (Overview, Content, Viewers, Followers) into `private/vault/tiktok/inbox/`.
2. `cd app && pnpm tiktok:ingest` copies new files into `raw/` (immutable, SHA-256 recorded), skips duplicates and regenerates `tiktok-snapshot.json` + `TIKTOK-STATS.md`. Re-runnable; never deletes sources.
3. `pnpm tiktok:ingest --from <folder>` imports from another folder (copied, not moved). `GROWTH_OS_VAULT` overrides the vault path.

- CSV dates have no year: inferred from the export time; video post year comes from the TikTok video ID.
- Lone `0` follower days in TikTok's FollowerHistory are export glitches and are dropped.

- Private files are read by the Next.js server at request time in local mode only; they are never bundled. Deployed dashboards run in endpoint mode with `GROWTH_OS_IGNORE_PRIVATE=1`.
- Agent names, handles and model names never go in tracked files: they come from the profile or the host environment.
