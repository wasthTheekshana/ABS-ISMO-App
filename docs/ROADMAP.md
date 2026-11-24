# ISOMS — SRS Status & Roadmap

Living document. Source: *SRS AB Securitas ISOMS Pilot Stage 1* (`docs/SRS_AB_Securitas_ISOMS_Pilot_Stage1 (1).docx`).
**Update this file whenever a requirement changes status.** Last updated: 2026-11-11.

Legend: ✅ done · 🟡 partly done · ⬜ not started · ❓ blocked on a customer answer

## Phase summary (as of 2026-11-16)

**Phase 1 = Pilot Stage 1** (SRS FR-1..6, NFR-1..6, Sprint Plan sprints 1–5). The software is feature-complete; what remains is sign-off and release.
- ⬜ UAT with AB Securitas using `docs/UAT-Checklist.md`, defect fixes, formal sign-off (S4-04..06)
- ⬜ Test on a low-end Android phone (NFR-4); the only device so far is a Pixel
- ❓ Customer answers: absenteeism formula, late cut-off times, attendance data source (S1-02), real roster with required headcount per site
- ⬜ Production deployment: server, HTTPS and domain, remove cleartext from the APK, nightly backups with a restore test, uptime monitoring (S5-01, NFR-3)
- ⬜ Real data in place of demo data: replace `EPF-000`, `ABS-7041`, `CLIENT-001` and the demo roster; final master-data sync (S5-02)
- ⬜ Go-live, handover document and user walkthrough, start of the 3-month support window (S5-03..05)
- 🟡 Small code items: on-duty table grouped by AGM/SM (FR-1), empty-database check of every dashboard tab, backup of the release keystore, remove the stale `public/isoms-app.apk`

**Phase 2 = every `[Future Phase]` requirement** (FR-7..20). No sprint plan exists yet. Built ahead of schedule: incident reporting with closure and audit trail, 12-item inspections, all roles, Control Room board, offline queue, **GPS site visits and live map (FR-8, FR-14), daily reports (FR-18), client feedback and complaints (FR-16)**. Still to build: push notifications, monthly analytics (FR-19), AI risk analysis (FR-17), incident video/voice notes (FR-13), the last parts of the full dashboard (FR-7: armed guards, response times), scheduled report e-mail, iOS app.

---

## 1. Pilot Stage 1 (must-have)

| ID | Requirement | Status | What is left |
|----|-------------|--------|--------------|
| FR-1 | Officers on duty, live, split by sector/AGM/SM/site | 🟡 | Live count by site and sector works. The AGM/SM grouping exists only in the absenteeism table; the on-duty table is still by site/sector. |
| FR-2 | Officers required + shortfall/surplus | ✅ | — |
| FR-3 | Monthly absenteeism (count + %), current & prior month, by sector/AGM/SM/site | ✅ | Done 2026-11-11: "Group by" Sector / AGM / SM on the dashboard (AGM = by region, SM = by sector). ❓ AB Securitas must still confirm the formula (absences ÷ required officers ÷ days). |
| FR-4 | Absence logging by VO/NVO/SM/Control Room | ✅ | Done 2026-11-11: server returns 403 for any other role; the phone hides the card. |
| FR-5 | Late reporting logging | ✅ | Same as FR-4. |
| FR-6 | Role-scoped dashboard access | ✅ | — |
| UC-1 step 5 | Date-range filter | ✅ | Done 2026-11-11: `GET /api/kpis/executive?from=&to=` (max 366 days, scoped) plus date pickers on the absenteeism tab. |
| UC-1 alt | "No data available" state instead of errors | 🟡 | Verify on every dashboard tab with an empty database. |
| UC-2 alt | Duplicate entry shows the existing record | ✅ | Server returns the existing record on 409 and the phone form shows it. A queued report that turns out to be a duplicate is dropped silently, which is intended. |

## 2. Non-functional requirements

| ID | Requirement | Status | What is left |
|----|-------------|--------|--------------|
| NFR-1 | Dashboard < 3 s | ✅ | Covered by `performance.test.js`. Re-measure on the real server. |
| NFR-2 | Role/region-enforced data access | ✅ | — |
| NFR-3 | Availability in operating hours | ⬜ | Needs hosting, monitoring and an uptime check. |
| NFR-4 | Usable on low-end Android | 🟡 | Test on a low-end device (only a Pixel so far). |
| NFR-5 | Timestamp + attribution + **edit audit trail** | 🟡 | Timestamp/attribution done. No edit feature exists yet, so no audit trail; build it together with any edit/close feature. |
| NFR-6 | Scalable data model | ✅ | — |

## 3. Already built ahead of the Pilot (SRS "Future Phase")

| ID | Status | Notes |
|----|--------|-------|
| FR-9..12 Incident reporting (operational/security/safety/medical) | ✅ | Done 2026-11-13: report, list, **closure workflow** (Open → Escalated → Closed, notes required, reopen), **editing with a field-level audit trail** (NFR-5), witnesses, client representative, police/hospital/fire, estimated loss. Close/escalate/History are on the web dashboard; the phone reports. Editing has an API but no screen yet. |
| FR-15 Site inspection checklist + rating | ✅ | Done 2026-11-13: all 12 SRS items on phone, server and dashboard. Weapons/ammunition is "not applicable" unless the site is armed. Only VO/NVO/SM may inspect. |
| FR-20 Full RBAC | ✅ | Done 2026-11-13: staff roles plus **Security Guard** (own site; check-in and incident reports only; sees only their own reports) and **Client** (read-only, own sites via `client_sites`, internal detail redacted, web portal). Role lists live in `server/middleware/roles.js`. **Control Room** has its own **Operations Board** (done 2026-11-13): live open-incident queue ordered by severity, escalated and age, with Escalate / Close from the board, short-staffed sites, today's absences and late reports, officers on duty now; refreshes every 30 s. Web: the Control Room's home screen (MD and GM can open it too). Phone: an "Ops" tab that Control Room lands on after sign-in. |
| Offline queue (UC-3 alt) | ✅ | Phone queues reports, per user, with retry. |
| Forced passcode change | ✅ | Server, web and phone. |

## 3b. Phase 2 features built 2026-11-18

| ID | Status | What exists |
|----|--------|-------------|
| FR-14 GPS site-visit monitoring | ✅ | VO and NVO tap **Arrive / Depart** on the phone (new Visits tab). The server records arrival and departure fixes, minutes on site, **distance travelled since the previous visit** (breadcrumb path through the pings), and whether the arrival was inside the **150 m geofence** (`GEOFENCE_METERS`); an off-site arrival is recorded and flagged, not blocked. One open visit per officer, enforced by the database. |
| FR-8 live GPS map | ✅ | The phone sends a location ping every 60 s while a visit is open, on any tab, and resumes after an app restart. Web **Field Map & Visits** tab (Leaflet + OpenStreetMap): site markers with arrival zones, officers colour-coded, stale fixes greyed, day's visit table. **NVO positions are returned to MD and GM only**; AGM sees VOs in their region, SM in their sector, Control Room all VOs. Raw coordinates in the visit list are MD/GM only. |
| FR-18 automated daily reports | ✅ | Eight reports: Daily Incident, Daily Attendance, Site Visit, Client Complaint, Emergency Incident, Night Visit, KPI, Daily Operations Summary. Generated live for the viewer's scope, with **CSV export** (formula-injection safe) and print. A nightly job stores the **organisation-wide copy** of yesterday's reports (`daily_reports`); MD and GM can open the stored copy. Not yet: scheduled e-mail or PDF delivery. |
| FR-16 client feedback | ✅ | Clients rate punctuality, discipline, grooming, communication and overall (1-5 stars) plus complaints and suggestions, optionally about one recent completed visit at their site (one response per visit). Management acknowledges, resolves (notes required) or reopens; the client sees the outcome. Complaints feed the Client Complaint Report. |

Known limits: location sharing runs while the app process is alive (screen-off tracking needs an Android foreground service); the location ping table has no retention job yet; the map uses OpenStreetMap's public tile server, which is for light use (see `docs/DEPLOYMENT.md`).

## 4. Future phases (not started)

| ID | Requirement | Depends on |
|----|-------------|-----------|
| FR-7 | Full executive dashboard: the remaining items are armed guards on duty/required, and incident response times (time to first response, not only time to close) | Armed flag on sites and guards; an "acknowledged" step on incidents |
| FR-13 | Auto-capture: photos (one per report today), video, voice notes | File storage decision |
| FR-17 | AI risk analysis | Several months of real data |
| FR-19 | Monthly executive analytics | Real data |
| FR-20 | Remaining roles: Control Room, Security Guard, Client | Customer role definitions |
| §5.4 | Push notifications | Firebase project (Android) + Apple APNs key (iOS) |

## 5. Suggested order of work

1. ~~Close Pilot gaps~~ — done 2026-11-11 (role restriction, AGM/SM grouping, date range, duplicate record). Remaining Pilot item: on-duty table by AGM/SM, and the empty-state check.
2. **Get the Pilot into users' hands:** install the signed APK on real phones · run `docs/UAT-Checklist.md` · replace placeholder `EPF-000` and demo roster · hosting + HTTPS per `docs/DEPLOYMENT.md`.
3. **Incident module completion:** closure workflow, photos, witness/police fields, audit trail (FR-9..13, NFR-5).
4. **Control Room role + push notifications** (needs Firebase).
5. **GPS monitoring** (FR-8, FR-14).
6. **Reports, analytics, client feedback, AI** (FR-16..19) once data exists.

## 6. Open questions for AB Securitas

- Confirm the absenteeism formula and the "late" cut-off times (SRS §2.6).
- Real officer roster (AGM → SM → VO/NVO with EPF numbers) and required headcount per site.
- Enhance the existing Attendance App or run alongside it (SRS §5.3)? How does on-duty data reach ISOMS?
- Who owns the Firebase / Apple developer accounts?
- Hosting: AB Securitas servers or DOK's GCP Docker environment?

## 7. Operational to-dos (not code)

- Back up `mobile_app/android/app/isoms-release.jks` and `mobile_app/android/key.properties` in two places.
- Add the dashboard's LAN address to `FRONTEND_URL` in `.env` if opened from another device, then restart the API.
- `public/isoms-app.apk` is stale (old key) — remove or replace before distribution.
- Optional Windows firewall rule for phone testing over Wi-Fi (not needed over USB).

## Change log

- 2026-11-23 — **Redesign: "The Duty Register"** (`docs/DESIGN.md`). Web: new design system, app shell with a phone tab bar, "Needs attention now" home, tables that stack into labelled entries on phones, light and dark themes, pinch-zoom allowed. Phone app: same palette, fonts and stamp statuses. Fixed on the way: on-duty and shortfall counts arrived as text from `/api/sites` and concatenated ("0102281418") instead of adding. Backend 505 tests, Flutter 85. Checked in a browser at phone and desktop width (light and dark) for sign-in, Overview and Control Room; Incidents, Field map, Reports, Feedback and the client portal were restyled but not individually eyeballed.

- 2026-11-18 — GPS site visits + live map (FR-14, FR-8), daily reports with nightly archive (FR-18), client feedback (FR-16): server, web and phone. Backend 480 tests, Flutter 85. Fixed on the way: a race that could stop location sharing, and a crash if the officer signed out mid-ping. The APK must be rebuilt/installed for the Visits tab.

- 2026-11-13 — Control Room operations board (`GET /api/control-room/board`, web board, phone Ops tab). Backend 324 tests, Flutter 63. The APK must be rebuilt to get the Ops tab. Control Room still has no dispatch/assign-to-officer or push alert (needs Firebase) and no GPS map (FR-8).
- 2026-11-13 — Incident closure + audit trail, 12-item inspection checklist, Security Guard and Client roles (server, phone, web). Fixed `db:seed`, which never applied `schema_phase2.sql`. Unknown roles are now refused (403) instead of getting an empty list. Backend 307 tests, Flutter 52 tests. The APK must be rebuilt for the phone changes.
- 2026-11-11 — Pilot gaps closed: role-restricted absence/late logging (server + phone), AGM/SM grouping, date-range filter. Backend 265 tests, Flutter 48 tests. The installed APK must be rebuilt to pick up the phone change.
- 2026-11-11 — File created from the SRS review; reflects state after offline queue, passcode policy, inspections/incidents on the dashboard.
