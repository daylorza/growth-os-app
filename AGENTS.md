# Growth OS

A draft-only growth dashboard for creators: content planning, engagement drafts, analytics from platform exports, and two AI agent roles (analyst and creative). If `private/AGENTS.md` exists, read it too: it holds the workspace owner's personal rules.

## Hard rules
- Draft-only. The app never posts, publishes, messages or auto-acts. The creator approves and publishes.
- Never invent numbers. Unknown values stay `UNKNOWN`; example records carry `demo: true`.
- No passwords or two-factor codes anywhere.
- **Privacy:** personal data lives only in `private/` (gitignored): profile, handles, brief, analytics exports, brand docs. Never commit it, never copy names, handles or numbers from it into tracked files. `pnpm test` fails if a tracked file contains an identifier from `private/workspace.json`.
- One branch per change, open a PR. Never merge or push to `main`.

## App (`app/`)
Vite + React 19 + TypeScript + Tailwind v4. State lives in browser localStorage (`src/lib/store.ts`).

Use **pnpm** (npm 10 crashes with an arborist `edgesOut` error on this dependency tree).

```
cd app
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # vitest: formulas, guards, privacy guard, parsers
pnpm lint       # oxlint
pnpm build      # tsc -b && vite build
```

Layout: `src/lib/` (types, store, seeds, metrics, rules/guards, connectors, TikTok parsing), `src/components/ui.tsx`, `src/modules/` (one file per nav module).

## Workspaces
- No `private/` folder: the app shows a fictional sample creator with generated data, plus a "Make it yours" setup.
- `private/workspace.json`: the owner's profile and starting data (an exported backup from Settings works).
- `VITE_IGNORE_PRIVATE=1 pnpm dev` previews the public sample even when `private/` exists.
- Names shown in the UI (creator, agents, brand, company, project) all come from the profile. Never hardcode them.

## Connectors (`src/lib/connectors.ts`, `src/lib/oauth.ts`)
- Export files (works now for TikTok): import CSVs in Settings, or use the vault below.
- OAuth: set `VITE_CONNECTOR_SERVER` to a server implementing the contract in `oauth.ts`. Tokens stay on that server; the browser only gets read-only normalised data.
- Adding a platform's export parser needs a real sample export first. Never guess a file format.

## TikTok vault (`private/vault/tiktok/`)
1. Download the four-role export from TikTok Studio (Overview, Content, Viewers, Followers) into `private/vault/tiktok/inbox/`.
2. `cd app && pnpm tiktok:ingest` copies new files into `raw/` (immutable, SHA-256 recorded), skips duplicates and regenerates `tiktok-snapshot.json` + `TIKTOK-STATS.md`. Re-runnable; never deletes sources.
3. `pnpm tiktok:ingest --from <folder>` imports from another folder (copied, not moved). `GROWTH_OS_VAULT` overrides the vault path.

- CSV dates have no year: inferred from the export time; video post year comes from the TikTok video ID.
- Lone `0` follower days in TikTok's FollowerHistory are export glitches and are dropped.

- Never deploy a build made while `private/` exists: Vite bundles private data into it. Public builds come from a clean clone, or set `VITE_IGNORE_PRIVATE=1` (private files are stubbed at build time).
