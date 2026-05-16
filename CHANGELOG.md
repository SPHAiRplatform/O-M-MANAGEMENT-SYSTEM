# Changelog

All notable changes to the SPHAiRDigital O&M System are documented here.

Format: `[YYYY-MM-DD] Category: Description`

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
