# Claude Design Prompt — AB Securitas ISOMS (Pilot Stage 1)

Paste everything below the line into Claude Design.

---

## Brief

Design the UI wireframes and a clickable hi-fi prototype for **ISOMS – Integrated Security Operations Management System**, a Pilot Stage 1 product for **AB Securitas (Pvt) Ltd.** (a security-guard company in Sri Lanka, part of the ABANS Group), built by DOK Solutions Lanka.

It has two surfaces:
1. **Mobile app (Android, primary)** for field officers (Visiting Officers, Night Visiting Officers, Sector Managers, Control Room) to log guard absences and late reporting.
2. **Responsive web dashboard** for executives (MD, Director/CEO, GM, DGM, AGM, Sector Managers) to see five staffing KPIs.

Deliver: (a) low-fidelity wireframes of every screen below, then (b) a high-fidelity, linked prototype of the same screens. Show the mobile screens in a phone frame (360×800) and the dashboard at desktop (1440×900) plus a tablet/mobile responsive view.

## Users and constraints
- Field officers use **low-end Android phones, between site visits, often with poor signal**. Keep typing to a minimum: use pickers, toggles, big tap targets (min 48px), and auto-calculated fields.
- Executives want a **glanceable, role-scoped** dashboard: MD/Director-CEO/GM see all sectors; DGM/AGM/Ops Managers and Sector Managers see only their own region/sector.
- Staff are identified by **EPF number**. Hierarchy: AGM → SM → VO/NVO → Guards → Sites.
- Every submission is timestamped and attributed to the submitting user (show this in confirmations and history).

## Visual direction
Dark, serious, operational "control room" feel; calm, not flashy.
- Background `#0b0f19`, surface `#131b2e`, elevated `#1a253e`, cards translucent navy, 1px border `rgba(255,255,255,0.08)`.
- Primary blue `#3b82f6`; **AB Securitas gold `#f59e0b`** as the brand accent (badge, key highlights).
- Status: success `#10b981`, warning `#f59e0b`, danger `#ef4444`, info `#06b6d4`.
- Text `#f1f5f9`, muted `#94a3b8`, dim `#64748b`.
- Fonts: **Outfit** for headings, **Inter** for body. Radii 8 / 12 / 18px. Icons: Lucide.
- Status is always conveyed by colour **plus** icon/label (accessibility).

## Mobile screens (field app)

1. **Staff Login** — AB Securitas gold shield badge + app name. Role selector (VO, NVO, Sector Manager, Control Room), Staff ID / EPF number field, passcode field (with show/hide), "Sign in" button. Error state for wrong credentials.
2. **My Sites (home)** — greeting with name, role, EPF. List of **site cards**: site name, status chip (Fully staffed / Short-staffed / Critical), "on duty / required" count (e.g. 8 / 10), and quick actions "Log Absence" and "Log Late". Bottom navigation: My Sites, Log, History. Empty state when no sites are assigned.
3. **Log Guard Absence** — site picker, officer/guard picker (name + EPF), shift selector (Day / Night), date (defaults today), reason chips (Sick, Emergency, No-show, Personal, Other), **"Replacement deployed?" toggle** that reveals a replacement-guard picker when on, optional note, sticky "Submit" button. Inline validation.
4. **Log Late Reporting** — site, officer, shift; **scheduled time** and **actual time** time-pickers; an **auto-calculated delay** readout (e.g. "Late by 42 min", warning-coloured) that updates live; optional reason; Submit.
5. **Duplicate Entry state** — when an entry already exists for the same officer + shift, show the existing record in a card with a message "Already logged — duplicates are not allowed" and a "View record" button (no submit).
6. **Submission Confirmation** — success check, **reference ID** (e.g. `ABS-ABS-20260820-0042`), summary (type, officer, site, shift, time, submitted by, timestamp), buttons "Log another" and "Back to My Sites".
7. **Recent Submissions / History** — chronological log grouped by day; each row shows type icon (absence vs late), officer, site, time, reference ID; filter chips (All / Absence / Late); tap opens a read-only detail sheet showing the audit info (submitted by, timestamp, edits).
8. **Offline banner** (component, shown on any screen) — "No connection — entries will sync when you're back online".

## Web dashboard screens (executive)

1. **Web Login** — same branding, EPF + passcode.
2. **Pilot Executive KPI Dashboard** (main screen)
   - Top bar: logo, scope label (e.g. "All Sectors" or "Western – AGM Perera"), date-range picker (default: current month), user menu with role.
   - Filter row: Sector → AGM → SM → Site cascading selectors, "Reset".
   - **Five KPI cards:** (1) Officers Currently On Duty, (2) Officers Required, (3) Monthly Guard Absenteeism (count **and** %, with change vs prior month), (4) Guard Absence count, (5) Late Reporting count. Between 1 and 2, show a **shortfall/surplus** indicator (e.g. "−37 shortfall", red; or "+3 surplus", green).
   - **Absenteeism trend chart** — daily line/area for the selected month with the prior month as a faint comparison line; hover tooltip.
   - **Breakdown table** — rows by sector / AGM / SM / site (expandable drill-down) with columns: On duty, Required, Shortfall, Absent, Absenteeism %, Late. Sortable; colour-coded shortfall and absenteeism cells.
   - Recent activity feed (latest absences/late reports with submitter).
3. **Empty state** — "No data available for this period" with an illustration/icon and a hint (not an error).
4. **Role-scope variants** — show the same dashboard for (a) MD (all sectors) and (b) a Sector Manager (own sector only, sector filter locked).
5. **Responsive** — tablet and phone layouts: KPI cards collapse to a 2-col then 1-col grid; table becomes cards.

## Screens to show only as "Coming in later phases" (muted, locked, not interactive)
A single "Future Phases" preview screen listing greyed tiles: Live Executive Dashboard, Incident Reporting (Operational / Security / Safety / Medical), GPS Monitoring, Digital Site Checklist, Client Feedback, AI Risk Analysis, Automated Daily Reports, Monthly Analytics. Do **not** design these in detail.

## Sample data (use realistic, consistent values)
- Officers on duty **412**, required **449**, shortfall **−37**.
- Absenteeism this month **38 absences · 4.1%** (prior month 3.4%).
- Late reports this month **27**.
- Sectors: Colombo, Western, Southern, Central, Northern. Sample sites: "ABANS Head Office – Colombo 02", "Liberty Plaza", "Galle Fort Warehouse", "Kandy City Centre".
- Sample officers: Nimal Perera (EPF 10245), Kasun Silva (EPF 10388), Ruwan Fernando (EPF 10412).
- Sample users: Chamara Waduge (General Manager – Static SBU), a Visiting Officer, a Sector Manager.

## Interaction flow to make clickable
Login → My Sites → Log Absence → Submit → Confirmation → History.
Login → My Sites → Log Late Reporting (watch the delay auto-calculate) → Submit → Confirmation.
Web: Login → Dashboard → change filter → drill into a sector row → switch to Sector Manager view.

## Output requirements
- Wireframes first (grayscale boxes, annotated), then the styled prototype.
- Annotate key behaviours (auto-delay calculation, duplicate prevention, role-scoped data).
- Keep a consistent component set: buttons, inputs, chips, cards, status badges, table, bottom nav, toast, bottom sheet.
- Accessible contrast (WCAG AA) on the dark theme; no information by colour alone.
