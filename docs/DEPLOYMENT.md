# ISOMS — Deployment & Release Guide

Everything needed to move ISOMS off a developer PC. **Status: written from the working pilot setup but not yet rehearsed on a real server — do a dry run on a staging machine first.**

## 1. What runs where

| Piece | What it is | Port |
|-------|-----------|------|
| API | Node 20 + Express (`npm run server`) | 5010 |
| Database | PostgreSQL 16 | 5432 (internal only, never public) |
| Web dashboard | Static files from `npm run build` → `dist/` | served by the reverse proxy |
| Mobile app | Flutter APK (Android) / IPA (iOS) | talks to the API over HTTPS |

Only the reverse proxy (80/443) is exposed to the internet. The API and database listen on localhost / a private network.

## 2. Server environment (`.env`, never committed)

| Variable | Notes |
|----------|-------|
| `NODE_ENV` | `production` |
| `PORT` | `5010` |
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` | Dedicated DB user with a strong password. **`DB_PASSWORD` is mandatory in production — the API refuses to start without it.** |
| `JWT_SECRET` | Random, 32+ characters (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`). Changing it signs everyone out. |
| `FRONTEND_URL` | Comma-separated allowed browser origins, e.g. `https://isoms.example.lk` |

## 3. First-time database setup

```
npm ci
npm run db:seed        # applies db/schema.sql + db/schema_phase2.sql (incidents, inspections, audit trail, client sites) and loads the starter accounts, sites and guards
```

The seed is safe to re-run: it refreshes profile data but **never resets an existing account's passcode**.

Starter accounts are created with a shared initial passcode and a **must-change-at-first-login** flag. Before go-live:

1. Replace the placeholder MD account (`EPF-000`), the demo guard (`ABS-7041`), the demo client (`CLIENT-001`, linked to one site through `client_sites`) and the demo users/sites/guards in `server/db/seed.js` with the real roster, then seed. A real client needs a `users` row with role `CLIENT` and one `client_sites` row per site they may see.
2. Hand each person their initial passcode privately. They are forced to choose their own on first sign-in.
3. The shared initial passcode can never be chosen again as a new passcode (`INITIAL_PASSCODES` in `server/routes/auth.routes.js`).

## 4. HTTPS (required)

The pilot APK allows plain HTTP (`usesCleartextTraffic` in `mobile_app/android/app/src/main/AndroidManifest.xml`) and iOS allows local networking only. For production:

1. Point a DNS name at the server and put Nginx or Caddy in front of the API and the `dist/` folder, with a Let's Encrypt certificate.
2. Proxy `/api/` to `http://127.0.0.1:5010`; serve `dist/` for everything else (single-page app fallback to `index.html`).
3. Build the web app with `VITE_API_BASE_URL=https://isoms.example.lk/api` (otherwise it calls port 5010 on its own host, which is only right for development).
4. **Remove** `android:usesCleartextTraffic="true"` from the manifest and rebuild the APK with `--dart-define=API_BASE_URL=https://isoms.example.lk/api`.

## 5. Backups

Nightly dump, kept off the server, with a restore rehearsed at least once:

```
pg_dump -U <DB_USER> -h <DB_HOST> -Fc isoms_db > isoms_$(date +%F).dump
pg_restore -U <DB_USER> -h <DB_HOST> -d isoms_db_restore isoms_2026-11-09.dump
```

Keep at least 30 daily and 12 monthly copies. The audit tables (absence, late, incidents, inspections, attendance) are the legal record — treat them accordingly.

## 6. Mobile releases

### Android
- Release builds are signed with `mobile_app/android/app/isoms-release.jks`, configured by `mobile_app/android/key.properties` (both git-ignored).
- **Back up the keystore and `key.properties` in a password manager or vault, in two places.** If the keystore is lost, installed copies of the app cannot be updated — users would have to uninstall and reinstall.
- Build: `cd mobile_app && flutter build apk --release --target-platform android-arm64 --dart-define=API_BASE_URL=https://<host>/api`
- For wide distribution use an app bundle (`flutter build appbundle`) and Google Play, or an MDM.
- Raise `version:` in `mobile_app/pubspec.yaml` for every release (`1.0.1+2`: name+build number).

### iOS
- Needs a Mac with Xcode, an Apple Developer account and a provisioning profile. The Flutter project already contains the location/camera usage strings and the `AB ISOMS` display name.
- `flutter build ipa --dart-define=API_BASE_URL=https://<host>/api`, then upload with Xcode/Transporter to TestFlight.

## 6b. GPS, map and report settings

- **Site coordinates.** The arrival geofence and the map markers need `sites.lat` and `sites.lng`. The seed holds approximate demo values; load surveyed coordinates for the real sites. A site without coordinates still works: arrivals are recorded with no on-site result.
- **Geofence size.** `GEOFENCE_METERS` (default 150) is the distance within which an arrival counts as on site.
- **Map tiles.** The web map loads OpenStreetMap tiles from `tile.openstreetmap.org`, which needs internet in the viewer's browser and is intended for light use. For a busy production dashboard use a commercial tile provider or self-host tiles, and change the URL in `src/dashboard/FieldMap.jsx`. The Content-Security-Policy on the web host must allow the tile server.
- **Time zone.** Report days, "today" and the night window (18:00 to 06:00) use `Asia/Colombo`.
- **Nightly report archive.** The API process stores yesterday's organisation-wide reports at start-up and re-checks hourly (`server/jobs/dailyArchive.js`). If the API runs as several instances the work may repeat, which is harmless (it replaces the same rows). Reports are not yet e-mailed or exported to PDF automatically.
- **Location data and privacy.** `location_pings` keeps one row per fix (about one a minute per officer on a visit) with no automatic clean-up. Agree a retention period with AB Securitas (for example 90 days), add a scheduled delete, and make sure staff have been told their location is recorded during site visits. NVO positions are visible to MD and GM only.
- **Phone tracking limit.** Location is shared while the app process is running. Tracking with the screen off or the app closed needs an Android foreground service and is not included.

## 7. Pre-go-live checklist

- [ ] `NODE_ENV=production`, strong `DB_PASSWORD` and `JWT_SECRET` set
- [ ] Real roster seeded; placeholder accounts removed
- [ ] HTTPS live; cleartext removed from the APK
- [ ] Database not reachable from the internet; firewall allows only 80/443
- [ ] Nightly backup running and a restore tested
- [ ] Release keystore backed up in two places
- [ ] `npm test` (backend) and `flutter test` (mobile) green on the release commit
- [ ] UAT (`docs/UAT-Checklist.md`) signed off by AB Securitas
- [ ] Rollback plan: previous `dist/`, previous APK, last good DB dump

## 8. Not included yet

- **Push notifications** (e.g. alert managers to a Critical incident) need a Firebase project owned by AB Securitas (Android) and an Apple APNs key (iOS). Until then managers see incidents on the dashboard and in the mobile Activity tab when they refresh.
- **iOS build** — requires a Mac.
