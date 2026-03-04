# User Organization Context Implementation

## Overview
This document describes the complete implementation ensuring that regular users (like John Technician) see only their company's data and branding when they log in.

## Problem Statement
When a regular user (e.g., John Technician from Smart Innovations Energy) logs in, they must:
1. See "{ABBREVIATION} O&M System" in the page title (e.g., "SIE O&M System")
2. See only their company's data across all pages (Dashboard, Tasks, Templates, Inventory, Plant Map, Calendar)
3. Have their organization context automatically set (no manual selection needed)

## Implementation Summary

### 1. Backend Changes

#### A. Login Response (`server/routes/auth.js`)
**Changes:**
- Updated login query to include `organization_id` in SELECT statement
- Added organization info loading for regular users (not system owners)
- Login response now includes:
  - `organization_id`: User's organization UUID
  - `organization_name`: Organization name (e.g., "Smart Innovations Energy")
  - `organization_slug`: Organization slug (e.g., "smart-innovations-energy")

**Code Location:** Lines 40-65 (query), 310-360 (response)

#### B. `/me` Endpoint (`server/routes/auth.js`)
**Changes:**
- Updated query to include `organization_id` in SELECT statement
- Added organization info loading for regular users
- Response includes same organization fields as login

**Code Location:** Lines 458-560

#### C. Tenant Context Middleware (`server/middleware/tenantContext.js`)
**Status:** ✅ Already correctly implemented
- Regular users: `organizationId` is set from `user.organization_id` (line 141)
- System owners: `organizationId` is set from `req.session.selectedOrganizationId` (line 123)
- RLS session variables are set correctly for data isolation

#### D. Data Filtering
**Status:** ✅ Already correctly implemented
- All routes use `getDb(req, pool)` for RLS-aware queries
- Explicit `organization_id` filters added as backup:
  - `tasks.js`: Line 150+ (WHERE organization_id = $1)
  - `inventory.js`: Line 100+ (WHERE organization_id = $1)
  - `calendar.js`: Line 31, 95 (WHERE organization_id = $1)
  - `checklistTemplates.js`: Line 65+ (WHERE organization_id = $1)
  - `cmLetters.js`: Line 100+ (WHERE organization_id = $1)
  - `users.js`: Line 188+ (WHERE organization_id = $1)

### 2. Frontend Changes

#### A. Page Title Hook (`client/src/hooks/usePageTitle.js`)
**New File:** Created dynamic page title hook
- **Tenant routes** (`/tenant/*`): Shows "{ABBREVIATION} O&M System"
- **Platform routes** (`/platform/*`): Shows "O&M System - SPHAiRDigital"
- Extracts abbreviation from:
  1. `company_name_display` from branding API (format: "SIE O&M System")
  2. `user.organization_name` from user object
  3. Falls back to organization API if needed

**Code Location:** `client/src/hooks/usePageTitle.js`

#### B. App Component (`client/src/App.js`)
**Changes:**
- Added `usePageTitle()` hook call in `AppContent` component
- Page title updates automatically when route or organization changes

**Code Location:** Line 71

#### C. Company Colors (`client/src/App.js`)
**Status:** ✅ Already implemented
- Company colors are loaded on login (line 105-114)
- Colors reload when organization changes (line 117-141)

#### D. Header Component (`client/src/App.js`)
**Status:** ✅ Already implemented
- Shows company abbreviation in header for tenant routes
- Format: "{ABBREVIATION} O&M System" (line 560-580)

## Data Flow for Regular User Login

```
1. User logs in (John Technician)
   ↓
2. Backend queries user with organization_id
   ↓
3. Backend loads organization info (name, slug)
   ↓
4. Login response includes:
   - user.organization_id
   - user.organization_name
   - user.organization_slug
   ↓
5. Frontend stores user object in AuthContext
   ↓
6. TenantContext middleware sets organizationId from user.organization_id
   ↓
7. RLS session variables set: app.current_organization_id = user.organization_id
   ↓
8. All API queries filtered by organization_id (RLS + explicit filters)
   ↓
9. Page title hook extracts abbreviation and sets: "SIE O&M System"
   ↓
10. Company colors loaded and applied
   ↓
11. User sees only Smart Innovations Energy data
```

## Verification Checklist

### Backend Verification
- [x] Login query includes `organization_id`
- [x] Login response includes `organization_id`, `organization_name`, `organization_slug`
- [x] `/me` endpoint includes organization info
- [x] TenantContext middleware sets `organizationId` for regular users
- [x] All routes use `getDb(req, pool)` for RLS
- [x] All routes have explicit `organization_id` filters

### Frontend Verification
- [x] Page title hook created and integrated
- [x] Hook extracts abbreviation correctly from `company_name_display`
- [x] Hook handles regular users vs system owners
- [x] Company colors load on login
- [x] Header shows company abbreviation

### Data Isolation Verification
- [x] Tasks filtered by `organization_id`
- [x] Inventory filtered by `organization_id`
- [x] Calendar filtered by `organization_id`
- [x] Templates filtered by `organization_id`
- [x] CM Letters filtered by `organization_id`
- [x] Users filtered by `organization_id`
- [x] Plant map loaded from company-scoped files
- [x] Dashboard shows only company-specific data

## Testing Instructions

### Test Case: John Technician (Regular User)
1. **Login:**
   - Username: `john` (or appropriate test user)
   - Password: (user's password)
   - Expected: Login successful, user object includes `organization_id`, `organization_name`

2. **Page Title:**
   - Navigate to `/tenant/dashboard`
   - Expected: Browser tab shows "SIE O&M System" (or appropriate abbreviation)

3. **Header:**
   - Expected: Header shows "{ABBREVIATION} O&M System" (e.g., "SIE O&M System")

4. **Dashboard:**
   - Expected: Shows only Smart Innovations Energy data
   - Logo: Shows SIE logo
   - Stats: Only SIE tasks, assets, etc.

5. **Tasks Page:**
   - Expected: Shows only tasks assigned to Smart Innovations Energy
   - No tasks from other companies visible

6. **Inventory Page:**
   - Expected: Shows only inventory items for Smart Innovations Energy
   - No items from other companies visible

7. **Templates Page:**
   - Expected: Shows only templates for Smart Innovations Energy
   - No templates from other companies visible

8. **Calendar Page:**
   - Expected: Shows only calendar events for Smart Innovations Energy
   - No events from other companies visible

9. **Plant Page:**
   - Expected: Shows only Smart Innovations Energy plant map
   - Title: Shows site map name from organization branding
   - Map: Loads from `uploads/companies/smart-innovations-energy/plant/map-structure.json`

10. **Users Page:**
    - Expected: Shows only users from Smart Innovations Energy
    - No users from other companies visible

## Security Considerations

1. **Data Isolation:**
   - RLS policies enforce organization-level filtering at database level
   - Explicit `organization_id` filters provide backup protection
   - Regular users cannot access other organizations' data

2. **Organization Assignment:**
   - All users must have `organization_id` (except system owners)
   - Migration script assigns existing users to organizations
   - New users automatically assigned to creator's organization

3. **Branding Isolation:**
   - Company colors loaded from organization-specific branding
   - Logo loaded from company-scoped file path
   - Page title reflects user's organization

## Future Enhancements

1. **Organization Switching (System Owners):**
   - System owners can switch between organizations
   - Page title updates automatically
   - Data refreshes to show new organization

2. **Multi-Organization Users:**
   - Support users belonging to multiple organizations
   - Organization selector in UI
   - Context switching without re-login

3. **Branding Customization:**
   - Allow organizations to customize page title format
   - Support custom abbreviations
   - Custom favicon per organization

## Maintenance Notes

- **Organization Assignment:** Ensure all new users are assigned to an organization during creation
- **Migration:** Run `assign_existing_users_to_organizations.sql` for any users without `organization_id`
- **Testing:** Regularly test data isolation by logging in as users from different organizations
- **Monitoring:** Check logs for any RLS bypass attempts or data leakage warnings
