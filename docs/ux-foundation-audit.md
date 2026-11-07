# UX foundation audit

This is a source-based heuristic audit, not a user study. The first change focuses on Overview and shared visual foundations; further journeys and states require browser and keyboard verification.

| Priority | Finding and impact | Correction and acceptance | Effort |
| --- | --- | --- | --- |
| High | Shared faint text is used for metric provenance and field hints; the original grey on dark surfaces is difficult to read. | Raise supporting-text contrast on the existing dark surfaces; provenance remains visible alongside values. | Small |
| High | Overview's four summary cards occupy two rows even on a wide desktop, pushing priorities below them. | Show four cards in one row when space permits and retain a two- or one-column layout on narrower screens. | Small |
| Medium | Mobile menu icon buttons have no explicit touch target size. | Provide 44px controls while preserving their accessible names and behavior. | Small |
| Medium | Navigation selection differs primarily by a dark background, making location easy to miss. | Add a restrained violet outline while retaining the current-page semantic and icon. | Small |
| Medium | The follower progress bar displays zero when no baseline is available, despite adjacent explanatory text. | In a follow-up, represent unknown progress without a zero-valued progress bar; verify both missing and real zero cases. | Small |
| Medium | Drawers declare a modal but do not visibly manage focus. | Audit focus placement, containment and return across drawers and verify with keyboard. | Medium |
| Medium | Several screens use small text, dense controls and custom chart presentations. | Audit each route at desktop and mobile sizes, including data provenance, keyboard access and missing-data states. | Large |

## Design foundations

The existing Tailwind tokens remain the source of truth. Midnight Graphite uses a near-black canvas (`ink-950`), darker sidebar/input surface (`ink-900`), panel (`ink-800`), elevated selection (`ink-700`), and discernible border (`ink-600`). Primary and supporting text use `fg`, `muted` and `faint`; lavender `accent` identifies selection, focus and important actions. Existing status colors retain their meanings. Cards use the existing radius and spacing; reduced-motion behavior remains global. Metric values use tabular figures, while notes remain readable and retain their source context.

## Validation (2026-11-07)

- `pnpm test`: 49 contract, 75 server and 60 app tests passed. Existing app tests cover calendar selection and publishing guards, engagement approval workflows, reporting-period trends, and drawer and mobile-menu keyboard behavior.
- `pnpm lint`: passed, including the platform-write guard.
- `pnpm build`: passed using the default Turbopack production build; the OpenAPI check passed. Earlier local port-permission failures did not recur in this run.
- GitHub PR check passed at the time of this validation.
- A production server started with `GROWTH_OS_IGNORE_PRIVATE=1`; Overview, Audience, Studio, Engagement, Agents, Intelligence, Revenue, Goals and Settings returned HTTP 200. This confirms route availability, not client-side behavior or appearance.
- Browser automation was unavailable. No visual inspection, screenshots, manual keyboard walkthrough, device-width checks, reduced-motion check, or complete journey validation was performed. Automated tests do not replace these checks.

## Next passes

1. Validate Overview and navigation in a running browser at the widths in the handoff, including keyboard and reduced motion.
2. Audit engagement and content approval journeys, then address the highest-impact findings without changing their safeguards.
3. Review analytics charts, freshness and unknown states, followed by agent handoffs, settings, goals and revenue screens.
