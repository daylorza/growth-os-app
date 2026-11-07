# Remaining dashboard validation handoff

Continue the work on draft PR [#18](https://github.com/daylorza/growth-os-app/pull/18), branch `design/midnight-graphite-foundation`. The redesign is an incremental pass, not a completed audit of every screen. Read the repository and private workspace instructions before continuing. Keep personal data out of tracked files and screenshots.

## Current state

- The shared graphite palette, Overview, navigation, cards, audience trends, content calendar, engagement filters and shared drawer have received initial refinements.
- The user requested that the Overview gradient be removed. Keep the surface solid unless the user requests a change.
- `pnpm test` passed: 49 contract, 75 server and 60 app tests. `pnpm lint` and `pnpm build` passed. The PR check passed for the tested code revision.
- A production server with fictional sample data returned HTTP 200 for all nine dashboard routes. HTTP status and automated tests do not establish visual or complete workflow correctness.
- Browser automation was unavailable during validation. No screenshots, manual keyboard walkthrough, responsive viewport inspection, reduced-motion inspection or full end-to-end journey review was completed.

## Remaining work

1. Run the public sample (`GROWTH_OS_IGNORE_PRIVATE=1 pnpm dev` from `app/`) and visually inspect Overview, Audience Growth, Content Studio, Engagement Hub, Agent Control, Content Intelligence, Brand & Revenue, Goals and Settings at 1440, 1280, 1024, 768, 390 and 320 CSS pixels where feasible. Check overflow, clipped text, table and calendar scrolling, navigation, touch targets and the selected state. Capture sample-only screenshots if useful.
2. Walk through the daily review, content planning and approval, engagement review and permitted approval, agent handoff, and data freshness journeys. Check empty, missing, stale, partial, disconnected and error states where supported. Never send, post or publish on an external platform during validation.
3. Check keyboard-only navigation, focus visibility and order, drawer focus containment and return, mobile menu behavior, accessible names, reduced motion and actual color contrast in the rendered interface. Verify with assistive technology where available. Record what was actually tested.
4. Review charts and tables for dates, units, provenance, honest scales and accessible alternatives. Investigate the known Overview issue where an absent follower baseline is rendered as a zero-valued progress bar; preserve the distinction between unknown and a real zero, with a regression test.
5. Record prioritized findings and fix confirmed regressions in reviewable changes. Run `pnpm test`, `pnpm lint` and `pnpm build` again after changes, and recheck the PR. Update `docs/ux-foundation-audit.md` with evidence, remaining limitations and follow-up work. Do not claim visual or accessibility compliance without the corresponding inspection.

Preserve existing calculations, data provenance, approval gates, permissions and draft-only rules. Never add invented metrics or copy private identifiers into tracked files.
