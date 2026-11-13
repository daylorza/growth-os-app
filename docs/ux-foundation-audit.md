# UX foundation audit

This is a source-based heuristic audit, not a user study. The first change focuses on Overview and shared visual foundations; further journeys and states require browser and keyboard verification.

| Priority | Finding and impact | Correction and acceptance | Effort |
| --- | --- | --- | --- |
| High | Shared faint text is used for metric provenance and field hints; the original grey on dark surfaces is difficult to read. | Raise supporting-text contrast on the existing dark surfaces; provenance remains visible alongside values. | Small |
| High | Overview's four summary cards occupy two rows even on a wide desktop, pushing priorities below them. | Show four cards in one row when space permits and retain a two- or one-column layout on narrower screens. | Small |
| Medium | Mobile menu icon buttons have no explicit touch target size. | Provide 44px controls while preserving their accessible names and behavior. | Small |
| Medium | Navigation selection differs primarily by a dark background, making location easy to miss. | Add a restrained violet outline while retaining the current-page semantic and icon. | Small |
| Medium | The follower progress bar displays zero when no baseline is available, despite adjacent explanatory text. | Fixed: an unknown baseline renders an empty dashed track (`role="img"`, "unknown"), a real zero still renders a 0% progressbar. Regression test in `ui.test.tsx`. | Small |
| Medium | Drawers declare a modal but do not visibly manage focus. | Verified in a browser: focus moves into the drawer, stays inside over 60 Tab presses, and returns to the trigger on Escape. | Medium |
| Medium | Several screens use small text, dense controls and custom chart presentations. | Audited in a browser; findings and fixes below. | Large |

## Browser validation findings (2026-11-07)

| Priority | Finding | Status |
| --- | --- | --- |
| High | Page headers with actions (Content Studio, Brand & Revenue, Audience) squeezed the title to one word per line at 320–390px. | Fixed: the title column keeps a 20rem basis and the actions wrap below it. See `screenshots/studio-320.png`. |
| High | Audience at 1024px: "UNKNOWN" follower values overflowed their cards and the snapshot form's Record button was cut off past the card edge. | Fixed: values use `text-3xl` below 1280px; the form uses two columns until 1280px. See `screenshots/audience-snapshot-form-1024.png`. |
| Medium | No skip link: keyboard users tab through nine navigation links on every page. | Fixed: "Skip to content" is the first focusable element and targets `<main>`. Test in `Shell.test.tsx`. |
| Medium | Calendar "New brief on …" and "Delete task" icon buttons were 14×14px, below the 24px WCAG 2.2 minimum. | Fixed: 24×24px targets. |
| Medium | Content mix bars were about 16px wide on phones, so actual vs target could not be read. | Fixed: on small screens the bar spans the full row under its label; values announce "Actual …, target …" to screen readers. See `screenshots/intelligence-mix-390.png`. |
| Medium | Settings connector rows truncated the handle to a few characters at 390px. | Fixed: the handle keeps at least 8rem; data age and status wrap to the next line. |
| Low (axe serious) | The "Content Studio" link in the Post performance empty state was distinguished from text only by colour (1.2:1). | Fixed: underlined. |
| Low | Handoff chain arrows point right when steps stack vertically on phones. | Fixed (2026-11-10): below 640px the steps stack full width with downward arrows; wider screens keep the row with right arrows. |
| Low | Text links in "Waiting on you" and card headers are 16–20px tall. | Accepted: inline/spaced targets meet the WCAG 2.5.8 spacing exception. |

## Design foundations

The existing Tailwind tokens remain the source of truth. Midnight Graphite uses a near-black canvas (`ink-950`), darker sidebar/input surface (`ink-900`), panel (`ink-800`), elevated selection (`ink-700`), and discernible border (`ink-600`). Primary and supporting text use `fg`, `muted` and `faint`; lavender `accent` identifies selection, focus and important actions. Existing status colors retain their meanings. Cards use the existing radius and spacing; reduced-motion behavior remains global. Metric values use tabular figures, while notes remain readable and retain their source context.

## Validation (2026-11-07)

- `pnpm test`: 49 contract, 75 server and 60 app tests passed. Existing app tests cover calendar selection and publishing guards, engagement approval workflows, reporting-period trends, and drawer and mobile-menu keyboard behavior.
- `pnpm lint`: passed, including the platform-write guard.
- `pnpm build`: passed using the default Turbopack production build; the OpenAPI check passed. Earlier local port-permission failures did not recur in this run.
- GitHub PR check passed at the time of this validation.
- A production server started with `GROWTH_OS_IGNORE_PRIVATE=1`; Overview, Audience, Studio, Engagement, Agents, Intelligence, Revenue, Goals and Settings returned HTTP 200. This confirms route availability, not client-side behavior or appearance.
- Browser automation was unavailable for that pass (superseded by the browser validation below). No visual inspection, screenshots, manual keyboard walkthrough, device-width checks, reduced-motion check, or complete journey validation was performed. Automated tests do not replace these checks.

## Browser validation (2026-11-07, issue #19)

Production build, fictional sample (`GROWTH_OS_IGNORE_PRIVATE=1`), headless Chromium via Playwright with axe-core 4.14. Scripts were run from a scratch folder; no dependency was added to the repo.

- **Responsive:** all nine routes at 1440, 1280, 1024, 768, 390 and 320px. Checked page-level horizontal overflow, elements past the viewport outside scroll regions, clipped text and target sizes. After the fixes above: no page overflow and no clipped content at any width. The calendar and both video tables scroll inside labelled, focusable regions; the calendar shows a "Scroll sideways" hint on phones.
- **axe (WCAG 2.0/2.1/2.2 A and AA tags):** at 1440 and 390px on all nine routes. One serious violation (link in text block) found and fixed; zero violations after. axe covered rendered colour contrast.
- **Keyboard:** Tab order on Overview, Content Studio and Engagement follows the visual order with a visible 2px accent outline on every stop. Mobile menu: focus moves to "Close menu" on open; Escape closes it and returns focus to "Open menu". Drawer: see the table above.
- **Reduced motion:** with `prefers-reduced-motion: reduce`, no link, button or progress transition has a non-zero duration.
- **Journeys (no external requests were made during any of them):** ticked and added a daily priority; "Waiting on you" links open the right module; created a brief from the calendar; "Log as published" on an unapproved brief is refused ("needs approval and a live post URL first"); approving a draft reply moves it to "Approved to post" with only Copy reply / Manually replied (nothing is sent); a handoff cannot be logged without an item ID, and logs once one is chosen; Audience shows export age ("Data 1 day old") and per-number provenance; Reset everything returns to the sample without errors.
- **States:** endpoint unreachable shows the "OFFLINE · Showing the last cached copy, read-only" banner without client errors. Unknown platform followers show `UNKNOWN` with "Needs two snapshots inside this period"; the unknown progress baseline is covered by a unit test.
- **Charts and tables:** follower sparklines are decorative (`aria-hidden`) with a "View trend data" list of dated values; the scale note says the vertical axis fits the values shown. Tables carry ISO dates, units in headers and the source of lifetime totals.

## Safari and Firefox spot check (2026-11-10)

Dev server, fictional sample (`GROWTH_OS_IGNORE_PRIVATE=1`), headless Playwright engines: WebKit 27.2 (Safari's engine; at 390px with mobile emulation and touch) and Firefox 159. Scripts were run from a scratch folder; no dependency was added to the repo.

- **Responsive:** all nine routes at 390 and 1440px in both engines. No page overflow, nothing past the viewport outside scroll regions, no console or page errors. The only flag was the visually hidden "Actual" / ", target" labels in Content Intelligence (`sr-only`, 1px by design), a false positive.
- **Interactions:** in both engines the Content Studio drawer opens, keeps focus inside across 40 Tab presses and closes on Escape; at 390px the phone menu opens and closes on Escape.
- **Handoff chain:** downward arrows at 390px and a single row with right arrows at 1440px in both engines.

This is engine emulation, not Safari or Firefox on real devices; iOS Safari's dynamic toolbar and real touch behaviour were not covered.

**Not tested:** real screen readers (VoiceOver, NVDA), real touch devices and real Safari/Firefox on devices, and endpoint mode with real data. Automated contrast checks cover rendered text but not text over images. Visual review was done from screenshots, not by a designer.

## Next passes

1. Screen reader pass (VoiceOver on macOS and iOS) on Overview, Content Studio drawer and Engagement approval.
2. Real-device check: iOS Safari and Firefox on a phone, at least Overview, Content Studio and the phone menu.
