# ISOMS design system

One look for the web app and the phone app, built from the client's own brand (absecuritas.com) and the layout of the approved mockup: a deep-plum sidebar, pastel reading tiles, a bell and avatar in the header, and rubber-stamp statuses. Light by default (readable in sunlight), with a dark theme.

## Brand

- **Logo:** the AB Securitas seal and wordmark, from the client's website (`src/assets/ab-securitas-logo.png`, `ab-securitas-seal.png`; the same files are in `mobile_app/assets/images`). It is purple on transparent, so on dark plum it always sits on a white chip.
- **Colours** (taken from the client's site styles):

| Token | Light | Used for |
|-------|-------|----------|
| `--brand` | `#7C1C7C` | primary buttons, links, active tab on phones (the logo purple) |
| `--sidebar` | `#2D052D` | sidebar, phone app bar, sign-in hero (deep plum) |
| `--accent` | `#E8793F` | active sidebar item, timeline markers, app-bar avatar (warm orange; `--accent-ink #A8441A` for text) |
| `--paper` / `--surface` | `#F7F1F7` / `#FFFFFF` | page background (soft lilac) and panels |
| `--ink` / `--muted` | `#1E1220` / `#6B5A6E` | text |
| `--rule` | `#E6D9E6` | borders |
| `--alarm` / `--cleared` / `--warn` / `--info` | `#C62828` / `#1F7A4D` / `#9A5B00` / `#1D5F99` | status colours, kept distinct from the purple brand |
| `--tint-green/blue/red/purple/amber` | pastels | the five Overview reading tiles |

Dark values are in `src/styles/tokens.css` and apply by device preference, by the person's choice (sun/moon button), and automatically on the Control Room board. Components use tokens and never hard-code a colour (the Leaflet map markers are the one exception). On the phone the same palette is `Brand.*` in `mobile_app/lib/core/theme.dart` (light only for now).

## Type

- **Public Sans** for reading (legible outdoors; falls back to Noto Sans Sinhala and Tamil for names).
- **Big Shoulders Display** for numerals and the wordmark.
- Sentence case everywhere; capitals only on stamps. Both fonts are bundled in the phone app (SIL Open Font License) because it works offline.

## Components

- **Stamps:** every status is a double-bordered rubber stamp (`.badge`, `StatusBadge`): Short, Staffed, Open, Escalated, Closed, No cover.
- **Reading tiles** (`.kpis`, `.kpi`): pastel, icon, signage numeral, label, note. 5 across on desktop, 2 across on phones.
- **Needs attention now:** a ranked list of plain sentences with one action each (rules in `src/utils/attention.js`, tested).
- **Registers:** add `className="register"` to a table. On a phone each row becomes a labelled entry (`src/utils/registerLabels.js`).
- **Incident detail:** breadcrumb, stamps, Escalate / Close, details and information cards, and an activity timeline built from the incident's audit trail.
- **Sign-in:** split screen with a brand panel and the form.

## Layout

- **Desktop:** sidebar (sections by role, open-incident count) + top bar (theme, refresh, bell, account menu).
- **Phones (under 900 px):** logo and actions in the top bar, a bottom tab bar (four sections and More), 44 px touch targets, 16 px inputs.
- Pinch-zoom allowed, visible focus rings, skip link, reduced motion respected, print styles for reports.

## Adding to it

1. Use tokens and existing classes (`panel`, `card`, `btn-primary`, `btn-secondary`, `badge badge-danger`, `kpi`, `tile`, `numeral`, `toolbar`, `page`).
2. A new section goes in `src/dashboard/nav.js` (role rules) and `ExecutiveDashboard.jsx`.
3. Write for the person using it: say what happens ("Close incident"), explain errors and how to fix them, and give empty screens a next step.
