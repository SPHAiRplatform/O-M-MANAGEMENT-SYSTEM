# Platform Architecture Implementation Plan

## Current State Analysis

### Existing Components:
- ✅ `Dashboard.js` - Currently shows **tenant-specific** data (tasks, CM letters, inventory)
- ✅ All routes are flat (`/tasks`, `/inventory`, `/calendar`, etc.)
- ✅ Organization routes exist at `/organizations` (not `/platform/organizations`)
- ✅ Tenant context middleware sets `organization_id` for RLS
- ✅ Header shows "{ABBREVIATION} O&M System" (e.g., "SIE O&M System")

### What Needs to Change:
1. Create NEW Platform Dashboard (separate from current Dashboard)
2. Modify middleware to detect platform vs tenant routes
3. Add `/platform/*` routes (new)
4. Migrate existing routes to `/tenant/*` (rename, don't duplicate)
5. Add "Enter Company" functionality
6. Update header to show company abbreviation for tenant routes

## Step-by-Step Implementation Plan

### ⚠️ IMPORTANT: No Conflicts Strategy
- **Create NEW components** for platform routes (don't modify existing ones yet)
- **Add NEW routes** alongside existing ones (don't remove old routes yet)
- **Test each step** before moving to next
- **Migrate incrementally** - keep old routes working until new ones are tested

---

## Step 1: Create Platform Dashboard Component

### What to Create:
- **NEW FILE**: `client/src/components/PlatformDashboard.js`
- **Purpose**: System-wide dashboard for platform administration
- **Data**: All organizations, all users, all assets, all tasks (aggregated)

### What NOT to Touch:
- ❌ Don't modify existing `Dashboard.js` (will become TenantDashboard later)
- ❌ Don't change any existing routes yet
- ❌ Don't modify middleware yet

### Implementation Details:
- Component fetches data from `/api/platform/*` endpoints (to be created)
- Shows system-wide metrics:
  - Total organizations count
  - Total users across all organizations
  - Total assets across all organizations
  - Total tasks across all organizations
  - Active vs inactive organizations
- Lists all organizations with quick actions
- "Enter Company" button for each organization

### Files to Create:
- `client/src/components/PlatformDashboard.js` (NEW)
- `client/src/components/PlatformDashboard.css` (NEW, can copy from Dashboard.css initially)

### API Endpoints Needed (to be created in Step 2):
- `GET /api/platform/stats` - System-wide statistics
- `GET /api/platform/organizations` - List all organizations (already exists at `/api/organizations`)

### Testing:
- Component renders without errors
- Can fetch and display data
- No impact on existing Dashboard

---

## Step 2: Implement Application-Level Filtering Middleware

### What to Modify:
- **MODIFY**: `server/middleware/tenantContext.js`
- **ADD**: Route detection logic (platform vs tenant)
- **ADD**: Application-level filtering flag

### What NOT to Touch:
- ❌ Don't remove existing RLS logic (still needed for regular users)
- ❌ Don't modify existing routes yet
- ❌ Don't change how regular users work

### Implementation Details:
- Detect if route starts with `/api/platform/*`
- For platform routes + system owner:
  - Set `req.platformMode = true`
  - Set `req.skipRLS = true` (flag for routes to use)
  - Don't set `organization_id` in session variables
- For tenant routes (or regular users):
  - Keep existing behavior (set organization_id, RLS active)
- Add helper: `isPlatformRoute(req)` and `shouldSkipRLS(req)`

### Changes to Make:
```javascript
// In tenantContext.js
function setTenantContext(pool) {
  return async (req, res, next) => {
    // Detect platform route
    const isPlatformRoute = req.path.startsWith('/api/platform/');
    
    // ... existing user lookup code ...
    
    if (isSystemOwner && isPlatformRoute) {
      // Platform mode - skip RLS
      req.platformMode = true;
      req.skipRLS = true;
      req.tenantContext = {
        organizationId: null,
        userId: userId,
        isSystemOwner: true,
        platformMode: true
      };
    } else {
      // Tenant mode - existing behavior
      // ... existing code ...
    }
  };
}
```

### Testing:
- Platform routes work for system owners (no filtering)
- Tenant routes still work for regular users (filtered)
- No breaking changes to existing functionality

---

## Step 3: Add Platform Routes (`/platform/*`)

### What to Create:
- **NEW ROUTES** in `client/src/App.js`:
  - `/platform/dashboard` → PlatformDashboard component
  - `/platform/organizations` → OrganizationManagement (move from `/organizations`)
  - `/platform/users` → System-wide user management (new or reuse UserManagement)
  - `/platform/system-settings` → Platform settings (new component)

### What NOT to Touch:
- ❌ Don't remove existing routes yet (`/organizations`, `/users`, etc.)
- ❌ Don't modify existing route handlers
- ❌ Keep both old and new routes working

### Implementation Details:
- Add routes to App.js
- Protect with `requireRole="system_owner"`
- Redirect system owners from `/` to `/platform/dashboard` (if system owner)
- Regular users still go to `/` → current Dashboard (tenant dashboard)

### Changes to Make:
```javascript
// In App.js - Add new routes
<Route 
  path="/platform/dashboard" 
  element={
    <ProtectedRoute requireRole="system_owner">
      <PlatformDashboard />
    </ProtectedRoute>
  } 
/>
<Route 
  path="/platform/organizations" 
  element={
    <ProtectedRoute requireRole="system_owner">
      <OrganizationManagement />
    </ProtectedRoute>
  } 
/>
// ... more platform routes ...

// Modify root route to redirect system owners
<Route 
  path="/" 
  element={
    <ProtectedRoute>
      {isSuperAdmin() ? <Navigate to="/platform/dashboard" /> : <Dashboard />}
    </ProtectedRoute>
  } 
/>
```

### Testing:
- System owners can access `/platform/dashboard`
- Regular users cannot access platform routes
- Existing routes still work

---

## Step 4: Migrate Existing Routes to Tenant Routes (`/tenant/*`)

### What to Modify:
- **RENAME routes** in `client/src/App.js`:
  - `/` → `/tenant/dashboard` (keep `/` as redirect)
  - `/tasks` → `/tenant/tasks`
  - `/inventory` → `/tenant/inventory`
  - `/calendar` → `/tenant/calendar`
  - `/plant` → `/tenant/plant`
  - `/cm-letters` → `/tenant/cm-letters`
  - `/checklist-templates` → `/tenant/checklist-templates`
  - `/users` → `/tenant/users` (for org admins)
  - All other operational routes

### What NOT to Touch:
- ❌ Don't modify component implementations yet
- ❌ Don't change API endpoints yet
- ❌ Keep backward compatibility (redirects from old routes)

### Implementation Details:
- Add new `/tenant/*` routes
- Keep old routes with redirects to new routes (for backward compatibility)
- Update all internal links to use `/tenant/*` paths
- Update navigation in Header component

### Changes to Make:
```javascript
// Add tenant routes
<Route path="/tenant/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
<Route path="/tenant/tasks" element={<ProtectedRoute><Tasks /></ProtectedRoute>} />
// ... etc ...

// Keep old routes with redirects (backward compatibility)
<Route path="/" element={<ProtectedRoute><Navigate to="/tenant/dashboard" /></ProtectedRoute>} />
<Route path="/tasks" element={<ProtectedRoute><Navigate to="/tenant/tasks" /></ProtectedRoute>} />
// ... etc ...
```

### Testing:
- All tenant routes work
- Old routes redirect correctly
- No broken links
- Regular users see tenant dashboard

---

## Step 5: Add "Enter Company" Functionality

### What to Create:
- **NEW COMPONENT**: `client/src/components/EnterCompany.js` (modal/dropdown)
- **MODIFY**: PlatformDashboard to include "Enter Company" buttons
- **ADD**: Company context switching logic

### What NOT to Touch:
- ❌ Don't modify tenant routes yet
- ❌ Don't change how regular users work

### Implementation Details:
- In PlatformDashboard, show list of organizations
- Each organization has "Enter Company" button
- Clicking sets selected organization in context/state
- Redirects to `/tenant/dashboard` with organization context
- Store selected organization in session/localStorage

### Changes to Make:
- Create EnterCompany component/modal
- Add organization selection state
- Add "Enter Company" buttons in PlatformDashboard
- Add context provider for selected organization (optional)
- Update tenant routes to use selected organization

### Testing:
- System owner can select and enter a company
- Switches to tenant routes correctly
- Organization context is maintained

---

## Step 6: Update Header to Show Company Abbreviation

### What to Modify:
- **MODIFY**: `client/src/App.js` Header component
- **ADD**: Company abbreviation display logic
- **ADD**: "Back to Platform" button (for system owners in tenant mode)

### What NOT to Touch:
- ❌ Don't break existing header functionality
- ❌ Don't change navigation structure yet

### Implementation Details:
- Detect if on tenant route (`/tenant/*`)
- If tenant route + system owner: Show "Back to Platform" button
- If tenant route: Show company abbreviation (e.g., "SIE")
- If platform route: Show "SPHAiRDigital" or "Platform Admin"
- Get company abbreviation from organization data or branding

### Changes to Make:
```javascript
// In Header component
const isTenantRoute = location.pathname.startsWith('/tenant/');
const isPlatformRoute = location.pathname.startsWith('/platform/');

// Get company abbreviation from context/organization
const companyAbbrev = isTenantRoute ? getCompanyAbbreviation() : null;

// Display logic
{isTenantRoute && companyAbbrev && (
  <span className="company-abbrev">{companyAbbrev}</span>
)}
{isTenantRoute && isSuperAdmin() && (
  <Link to="/platform/dashboard">Back to Platform</Link>
)}
```

### Testing:
- Header shows correct text for platform vs tenant routes
- Company abbreviation displays correctly
- "Back to Platform" button works

---

## Step 7: Test Access Control

### What to Test:
- System owner access to platform routes
- System owner access to tenant routes (with company selection)
- Regular user access (should only see tenant routes)
- Regular user cannot access platform routes
- Data isolation (regular users only see their org's data)
- Platform routes show all data (no filtering)

### Test Cases:
1. **System Owner Login**:
   - ✅ Lands on `/platform/dashboard`
   - ✅ Can access all platform routes
   - ✅ Can enter a company
   - ✅ Sees company data in tenant routes
   - ✅ Can switch back to platform

2. **Regular User Login**:
   - ✅ Lands on `/tenant/dashboard` (their org)
   - ✅ Cannot access `/platform/*` routes (redirected)
   - ✅ Only sees their organization's data
   - ✅ No "Back to Platform" button

3. **Data Isolation**:
   - ✅ Regular users: Only see their org's data
   - ✅ System owners (platform): See all data
   - ✅ System owners (tenant): See selected org's data

---

## Migration Checklist

### Step 1: Platform Dashboard ✅
- [ ] Create PlatformDashboard.js
- [ ] Create PlatformDashboard.css
- [ ] Test component renders
- [ ] Test data fetching

### Step 2: Application-Level Filtering ✅
- [ ] Modify tenantContext.js
- [ ] Add platform route detection
- [ ] Add skipRLS flag
- [ ] Test middleware logic

### Step 3: Platform Routes ✅
- [ ] Add `/platform/*` routes to App.js
- [ ] Redirect system owners to platform dashboard
- [ ] Test platform route access
- [ ] Test regular user cannot access

### Step 4: Tenant Routes ✅
- [ ] Add `/tenant/*` routes to App.js
- [ ] Add redirects from old routes
- [ ] Update internal links
- [ ] Test all routes work

### Step 5: Enter Company ✅
- [ ] Create EnterCompany component
- [ ] Add to PlatformDashboard
- [ ] Implement company selection
- [ ] Test company switching

### Step 6: Header Updates ✅
- [ ] Add company abbreviation display
- [ ] Add "Back to Platform" button
- [ ] Test header display logic
- [ ] Test navigation

### Step 7: Testing ✅
- [ ] Test system owner flow
- [ ] Test regular user flow
- [ ] Test data isolation
- [ ] Test access control

---

## Important Notes

1. **No Breaking Changes**: Each step should be backward compatible
2. **Test Incrementally**: Test each step before moving to next
3. **Keep Old Routes**: Don't remove old routes until new ones are fully tested
4. **Gradual Migration**: Users can use old routes while new ones are being tested
5. **Documentation**: Update docs as we go

---

## Dependencies Between Steps

- **Step 1** can be done independently (just create component)
- **Step 2** is needed for Step 3 (middleware must detect platform routes)
- **Step 3** depends on Step 1 (need PlatformDashboard component)
- **Step 4** can be done after Step 3 (migrate routes)
- **Step 5** depends on Step 3 and 4 (need platform routes and tenant routes)
- **Step 6** depends on Step 4 (need tenant routes to detect)
- **Step 7** tests everything together

---

## Risk Mitigation

1. **Keep Old Routes**: Don't delete old routes until fully tested
2. **Feature Flags**: Can use feature flags to enable/disable new routes
3. **Rollback Plan**: Each step can be rolled back independently
4. **Testing**: Test each step thoroughly before proceeding

---

**Ready to proceed with Step 1?**
