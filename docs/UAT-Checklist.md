# ISOMS Pilot Stage 1 — User Acceptance Test Checklist

**For:** AB Securitas UAT participants · **Build:** Pilot Stage 1 · **Test accounts:** see your DOK Solutions contact (never share passcodes in writing)

Mark each row **Pass / Fail** and note the tester's name and date. Anything that fails goes to DOK Solutions with a screenshot.

## A. Sign-in and access (FR-6)

| # | Step | Expected result | Pass/Fail |
|---|------|-----------------|-----------|
| A1 | Sign in as the GM with the correct passcode | Dashboard shows all regions and sectors | |
| A2 | Sign in as an AGM | Only that AGM's region appears, in sites, KPIs and logs | |
| A3 | Sign in as a Sector Manager | Only that sector appears | |
| A4 | Sign in as a Visiting Officer | Only assigned sites and sector appear | |
| A5 | Try a wrong passcode | Clear error, no sign-in | |
| A6 | Try 11 wrong passcodes in a row | Sign-in is temporarily blocked | |
| A7 | Leave the app signed in, return after 12+ hours | Asked to sign in again | |
| A8 | Sign in for the first time with the initial passcode (web and mobile) | Forced to choose a personal passcode before anything else is shown | |
| A9 | On that screen try a short passcode, one with only letters, and the initial passcode again | Each is refused with a clear message | |
| A10 | Choose a valid personal passcode, then sign out and back in | Old passcode no longer works; new one signs in straight to the dashboard | |
| A11 | Use "Change passcode" from the account menu (mobile) / header (web) | Works with the correct current passcode, refused with a wrong one | |

## B. Executive dashboard (FR-1 to FR-3)

| # | Step | Expected result | Pass/Fail |
|---|------|-----------------|-----------|
| B1 | Open the dashboard | Loads in under 3 seconds | |
| B2 | Compare "required" and "on duty" with the master roster | Figures match | |
| B3 | Have an officer check in on mobile, then refresh | That site's on-duty count updates | |
| B4 | Check the monthly absenteeism % against a hand calculation (absences ÷ required officers × 30 days) | Matches to 2 decimals | |
| B5 | Review the 6-month trend chart | Six months shown, oldest first | |
| B6 | Filter by region / sector | Table and totals follow the filter | |

## C. Guard absence logging (FR-4)

| # | Step | Expected result | Pass/Fail |
|---|------|-----------------|-----------|
| C1 | Log an absence for a guard at an assigned site | Confirmation with a record ID | |
| C2 | Check the dashboard | Absence count and absenteeism % increase | |
| C3 | Log the same guard, date and shift again | Shown the existing record, no duplicate stored | |
| C4 | Log the same guard on a different shift | Accepted | |
| C5 | Leave a required field empty | Clear message naming the field | |
| C6 | Try to log for a site outside your scope (not selectable in the app) | Not possible | |

## D. Late reporting (FR-5)

| # | Step | Expected result | Pass/Fail |
|---|------|-----------------|-----------|
| D1 | Log a late arrival (scheduled 06:00, actual 06:40) | Confirmation; delay recorded as 40 minutes | |
| D2 | Log a night-shift arrival after midnight (scheduled 22:00, actual 00:30) | Delay recorded as 150 minutes | |
| D3 | Repeat the same officer, date and shift | Existing record shown | |
| D4 | Check the dashboard late count | Increases by the number logged | |

## E. Attendance (FR-1)

| # | Step | Expected result | Pass/Fail |
|---|------|-----------------|-----------|
| E1 | Check in at a site | Active shift displayed | |
| E2 | Try to check in again without checking out | Refused with a clear message | |
| E3 | Check out | Shift closes; on-duty count drops | |
| E4 | Check out every officer at a site that had checked in today | On-duty count shows 0 (not the old seeded figure) | |

## F. Mobile app

| # | Step | Expected result | Pass/Fail |
|---|------|-----------------|-----------|
| F1 | Install the Android APK on a real device | Installs and opens | |
| F2 | Sign in and complete C1, D1 and E1 on the device | All succeed over Wi-Fi/mobile data | |
| F3 | Turn the network off and submit an absence report | Told it is **saved on the phone** and will send later (no reference ID is shown yet) | |
| F4 | Open the Report tab while offline | A banner shows how many reports are waiting | |
| F5 | Turn the network back on (or tap SEND NOW) | The banner disappears; the report appears in the Activity log with a server ID and on the dashboard | |
| F6 | Close and reopen the app while a report is waiting | It is still waiting and sends once online | |
| F7 | Management role: open the Sites tab | KPI cards and the monthly absenteeism trend chart are shown | |

## G. Future-phase previews (not part of Pilot sign-off)

| # | Step | Expected result | Pass/Fail |
|---|------|-----------------|-----------|
| G1 | Submit an incident report | Confirmation with a server-issued ID | |
| G2 | Submit a site inspection | Confirmation with a server-issued ID | |
| G3 | Turn the network off and submit either | Saved on the phone and sent later, never shown as recorded before the server has it | |
| G4 | Dashboard: open the Incidents and Inspections tabs | Records from G1 and G2 are listed, scoped to the viewer's role | |
| G5 | Incident form: fill in witnesses, client representative, police/hospital/fire and estimated loss | All values appear on the saved incident | |
| G6 | Dashboard, Incidents tab: **Escalate** an open incident | Status badge turns red "Escalated" | |
| G7 | Dashboard: **Close** an incident and leave the notes empty | Refused: closure notes are required | |
| G8 | Dashboard: **Close** an incident with notes | Status "Closed", notes shown under the badge | |
| G9 | Dashboard: click **History** on that incident | Lists each change with who, when, old and new value | |
| G10 | Close an incident, then try to edit it through the API | Refused until it is reopened (409) | |
| G11 | Site inspection form | Shows all 12 SRS items; weapons only appears when "Armed site" is switched on | |
| G12 | Dashboard, Inspections tab, submit an inspection with one failed check | Shows "n / total" and names the failed item | |

## H. Roles (SRS FR-20)

| # | Step | Expected result | Pass / Fail |
|---|------|-----------------|-------------|
| H1 | Sign in as the demo guard `ABS-7041` on the phone | Only Check-In and Report tabs; Report offers Incident only | |
| H2 | Guard files an incident at their own site | Accepted | |
| H3 | Guard on the web dashboard | "Please use the ISOMS phone app" page | |
| H4 | Sign in as the demo client `CLIENT-001` on the web | Client Portal with incidents and inspections for Abans Head Office only; no reporter, witness, loss or GPS columns | |
| H5 | Client signs in on the phone | Told to use the web portal; can only sign out | |
| H6 | Control Room user closes an incident | Allowed | |
| H8 | Sign in as Control Room (`EPF-0999`) on the web | Opens on the **Operations Board**; "Dashboard" button switches to the KPI view | |
| H9 | Operations Board with a Critical and a Low incident open | Critical is listed first; tiles show open, critical, escalated and oldest-open age | |
| H10 | Board: **Escalate** then **Close** (with notes) an incident | It moves to Escalated, then leaves the queue; the tiles update | |
| H11 | Board: a site below its required headcount | Listed under "Sites needing attention" with the shortfall | |
| H12 | Log an absence and a late report, reload the board | Both appear under today's lists | |
| H13 | Sign in as Control Room on the phone | Lands on the **Ops** tab; Sites, Check-In, Report and Activity are still reachable | |
| H14 | Phone Ops tab: pull down to refresh, then Escalate and Close an incident | Both work; Close insists on notes | |
| H15 | SM, VO, AGM, guard and client try to open the board (web or API) | Refused | |
| H7 | MD, GM and AGM try to submit an inspection or log an absence | Not offered on the phone and refused by the server | |

## I. GPS site visits and live map (FR-8, FR-14)

| # | Step | Expected result | Pass / Fail |
|---|------|-----------------|-------------|
| I1 | Sign in as a VO (`EPF-1042`) on the phone: the **Visits** tab is there | Visible for VO and NVO only | |
| I2 | Stand at (or near) a site and tap **ARRIVE** | "Arrival recorded"; the card shows the site, arrival time and "Visit in progress" | |
| I3 | Arrive while far from the site (over 150 m) | Recorded, but flagged "Arrived N m from the site" | |
| I4 | Try to arrive again while a visit is open | Refused with a clear message; the open visit is shown | |
| I5 | Switch to another tab and wait 2 minutes | "Location shared at HH:MM" updates on the Visits tab | |
| I6 | Close and reopen the app during a visit | The visit is still open and location sharing resumes | |
| I7 | Switch location off during a visit | The card warns that location is not reaching the server | |
| I8 | Tap **DEPART** | Visit ends with the minutes on site; a new arrival is possible | |
| I9 | Arrive at a second site later the same day | Shows "Travelled N km since your last visit" | |
| I10 | MD on the web dashboard: **Field Map & Visits** | The officer appears on the map at the site; table lists the visit with minutes, km and On site | |
| I11 | Sign in as an NVO, start a visit; check as MD, then as AGM, SM and Control Room | MD sees the NVO; AGM, SM and Control Room do **not** | |
| I12 | AGM and SM look at the map | Only officers in their own region / sector | |
| I13 | VO, NVO, guard and client try to open the map | Not offered; refused by the server | |

## J. Daily reports (FR-18)

| # | Step | Expected result | Pass / Fail |
|---|------|-----------------|-------------|
| J1 | Web dashboard: **Daily Reports**; open each of the eight reports for today | Each loads, with a title, date and rows (or "Nothing to report") | |
| J2 | Attendance report | Per site: required, checked in, shortfall, absences, late, and a TOTAL row | |
| J3 | Emergency Incident Report | Contains Critical incidents and any where police, hospital or fire were called, with the services named | |
| J4 | Night Visit Report | Contains NVO visits and any arrival between 18:00 and 06:00 | |
| J5 | Pick a past date | Report is for that date | |
| J6 | Download CSV and open it in Excel | Columns match the table; a complaint beginning with `=` shows as text, not a formula | |
| J7 | AGM / SM open the Attendance report | Only their own sites | |
| J8 | Next morning, as MD tick **Stored copy** for yesterday | The nightly copy opens; it matches what was true that night | |
| J9 | SM, AGM, Control Room try the stored copy | Not offered; refused by the server | |

## K. Client feedback (FR-16)

| # | Step | Expected result | Pass / Fail |
|---|------|-----------------|-------------|
| K1 | Client `CLIENT-001` on the web: **Give feedback** | Form with the client's sites, a recent-visit list, five star ratings, complaints and suggestions | |
| K2 | Send it with a rating missing | Asked to give every rating | |
| K3 | Pick a completed visit and send feedback | "Thank you"; appears under "Your earlier feedback" | |
| K4 | Send feedback for the same visit again | Refused: already given | |
| K5 | Include a complaint | Flagged as a complaint | |
| K6 | SM / AGM / MD web: **Client Feedback** | Averages, the complaint highlighted; Acknowledge and Resolve buttons | |
| K7 | Resolve without notes | Refused: notes required | |
| K8 | Resolve with notes | Status Resolved; the **client** sees "AB Securitas replied: ..." | |
| K9 | Client Complaint Report for today | Lists the complaint and its status | |
| K10 | VO, NVO and guard try to read client feedback | Not offered; refused by the server | |

## Sign-off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| AB Securitas representative | | | |
| DOK Solutions Lanka | | | |
