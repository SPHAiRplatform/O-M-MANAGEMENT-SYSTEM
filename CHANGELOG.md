# Changelog

All notable changes to the SPHAiRDigital O&M System are documented here.

Format: `[YYYY-MM-DD] Category: Description`

---

## [2026-05-18]

### Offline Overhaul
- **Service Worker** (`sphair-omv2`): Rewrote caching strategy — navigation requests are now network-first and cache the React app shell on first online visit so the full SPA loads offline; static assets (hashed JS/CSS bundles) are cache-first and cached automatically on first load
- **ChecklistForm auto-save**: When offline, drafts now save directly to IndexedDB and show "Draft saved offline" instead of an error; when online but network drops mid-save, falls back to IndexedDB silently; IndexedDB draft is always mirrored on visibility change / page hide
- **ChecklistForm offline submit**: Pressing Submit while offline queues the full checklist to IndexedDB and shows a "Submission pending" banner; on reconnect the submission fires automatically via an `online` event listener; if network drops right at submit time, the submission is queued the same way
- **ChecklistForm draft restore**: `loadTaskAndDraft` now falls back to IndexedDB offline draft when the server draft endpoint is unreachable
- **SyncManager fix — status code validation**: `processSyncItem` now uses `validateStatus: () => true` and throws on HTTP 4xx/5xx so failed requests retry or are marked failed (previously 400/422 responses were treated as success)
- **SyncManager fix — listener leak**: `startAutoSync` now stores the `online` handler reference and removes any previously registered handler before re-adding — prevents duplicate listeners accumulating across logins
- **SyncManager fix — nextRetry respected**: Items with a future `nextRetry` timestamp are now skipped during sync instead of being retried immediately
- **SyncManager fix — stopAutoSync cleanup**: Now also removes the online event listener, not just the interval
- **OfflineIndicator re-enabled**: Fixed the checkmark flicker by holding the `completed` state for the full 3 seconds before resetting to `idle`, preventing the component from returning `null` before the timeout fires; re-added `<OfflineIndicator />` to App.js
- **Pre-load on login**: On login (when online), assigned tasks (pending/in_progress) and all checklist templates are fetched and stored in IndexedDB so the technician's full workload is available offline from the very first visit
- **offlineStorage**: Added `saveOfflineDraft`, `getOfflineDraft`, `removeOfflineDraft`, `savePendingSubmission`, `getPendingSubmission`, `getAllPendingSubmissions`, `removePendingSubmission` methods to support the new offline draft and queued submission flows
- Removed leftover `console.log` statements from `offlineStorage.js` and `offlineApi.js`

### User Deactivation Improvements
- Deactivating a user now immediately revokes their active Redis session — they are kicked out within ~5 seconds instead of waiting for their JWT to expire
- Notification functions (`notifyTaskAssigned`, `notifyTaskReminder`) now guard against sending notifications to deactivated users
- Tasks list now shows deactivated assignees in gray italic with a "(Deactivated)" label instead of displaying their name normally
- User Management now has a "Show inactive" checkbox — deactivated users are hidden by default and shown on demand

### Debug Cleanup
- Removed all `console.log` debug statements from client and server (kept `console.error` / `console.warn`)
- Files cleaned: `api.js`, `Plant.js`, `useInactivityTimeout.js`, `syncManager.js`, `ChecklistForm.js`, `ChecklistTemplates.js`, `Tasks.js`, `Inspection.js`, `TaskDetail.js`, `server/routes/inventory.js`, `server/routes/auth.js`, `offlineStorage.js`, `offlineApi.js`

---

## [2026-05-16]

### Security
- Raised minimum password length from 6 to 8 characters across all registration, reset, and change-password flows (server-side middleware, route handlers, and frontend validation)
- Added audit log entries for `password_changed` and `password_reset` events
- Removed system_owner exemption from audit logging — all roles are now audited equally
- Added `PASSWORD_CHANGED` and `PASSWORD_RESET` constants to `AUDIT_ACTIONS`

### Features
- **PWA Support**: App is now installable as a Progressive Web App on Android, iOS, and PC (Windows/Mac)
  - Added `manifest.json` with proper icons and metadata
  - Added `service-worker.js` with cache-first (static) and network-first (navigation) strategies
  - Added `offline.html` branded fallback page
  - Added `InstallPrompt` component — shows install banner at bottom of screen
  - Added iOS-specific meta tags for Add to Home Screen support
  - Added Windows tile meta tags
- **Session Displacement Detection**: Reduced heartbeat poll interval from 30s to 5s — displaced sessions are now detected within ~5 seconds instead of up to 30s

### Bug Fixes
- Fixed PWA icon on PC being tiny — logo content was only 101×143px inside a 500×500 transparent canvas; fixed by cropping to bounding box before resizing
- Fixed Platform Analytics completion rate formula — was dividing by `created + completed` instead of just `created`
- Fixed Platform Analytics `newThisPeriod` for assets — was hardcoded to 0, now queries the database
- Fixed Platform Analytics active users label — renamed `active` → `activeInPeriod` to match what the data actually represents
- Fixed responsive table layout for all tables (Templates, Tasks, CM Letters, Inspection, Users) — action buttons now stay inline on mobile instead of stacking vertically
- Fixed Audit Log table (DataTable) conflict with global mobile card CSS — DataTable now correctly uses horizontal scroll on mobile instead of card layout

### UI / Responsive Design
- All data tables now use card layout on mobile (label + value pairs via `data-label` attributes)
- Action button cells forced to stay inline (`flex-wrap: nowrap`) on all screen sizes
- Added tablet breakpoint (`768px–1024px`) to global CSS
- Tables wrapped in `table-responsive` div: ChecklistTemplates, Tasks, CMLetters, Inspection

### Platform Analytics Improvements
- Added Task Type filter (All / PM / CM) — all queries now respect this filter consistently
- Added Overdue Tasks KPI card (highlighted red when count > 0)
- Added Total Assets KPI card (was missing from the 8-card grid)
- Added Org filter dropdown to Employee Scorecard table
- Added Overdue column to Org Activity Comparison table
- Fixed completion rate trend chart — `spanGaps: false` so missing days show as gaps not straight lines

### Branding
- Updated login screen copyright: `© 2026 SPHAiRDigital (PTY)LTD. All rights reserved.`

---

## How to use this file

- Add an entry every time a feature is shipped, a bug is fixed, or a security change is made
- Use categories: `Features`, `Bug Fixes`, `Security`, `UI`, `Performance`, `Breaking Changes`
- Keep entries short — one line per change is enough
- Group by date (newest at top)
