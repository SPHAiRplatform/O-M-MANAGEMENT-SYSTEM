# SPHAiRDigital Architecture - Platform That Hosts Companies

## Overview

SPHAiRDigital is a **multi-tenant SaaS platform** that hosts multiple companies. Each company has isolated data, customizable templates, settings, features, and branding.

## Route Structure

### `/platform/*` - Platform Routes

**Purpose**: System-wide administration and management  
**Access**: System owners only (`system_owner` role)  
**Data Scope**: All organizations, all users, all data (no filtering)  
**Default View**: System owners start here

#### Platform Routes:
- `/platform/dashboard` - Platform overview dashboard
- `/platform/organizations` - Manage all organizations
- `/platform/users` - Manage all users across organizations
- `/platform/system-settings` - Platform-wide settings
- `/platform/analytics` - Cross-organization analytics
- `/platform/reports` - System-wide reports

### `/tenant/*` - Tenant Routes

**Purpose**: Company-specific operations  
**Access**: All authenticated users (filtered by organization)  
**Data Scope**: Only user's organization data  
**Header Display**: Shows company abbreviation (e.g., "SIE")  
**Entry**: Deliberate action - "Enter Company"

#### Tenant Routes:
- `/tenant/dashboard` - Company dashboard
- `/tenant/tasks` - Company tasks
- `/tenant/inventory` - Company inventory
- `/tenant/calendar` - Company calendar
- `/tenant/plant` - Company plant management
- `/tenant/cm-letters` - Company CM letters
- `/tenant/checklist-templates` - Company templates
- All operational routes

## Platform Dashboard

**What System Owners See Without Entering a Company**

The Platform Dashboard (`/platform/dashboard`) provides:

### System Overview
- Total organizations count
- Total users across all organizations
- Total assets across all organizations
- Total tasks across all organizations
- Active vs inactive organizations
- System health metrics

### Organization Management
- List of all organizations
- Organization status (active/inactive)
- User counts per organization
- Quick access to organization details
- Create new organization

### Quick Actions
- Manage organizations
- View system-wide analytics
- Access platform settings
- Generate system reports
- Monitor platform health

## Enter Company - Deliberate Action

**Key Principle**: "Enter Company" is a deliberate action, not default behavior.

### Flow:
1. **System Owner Logs In** → Lands on `/platform/dashboard`
2. **Views Platform Overview** → Sees all organizations
3. **Selects "Enter Company"** → Explicit action to switch context
4. **Switches to Tenant Routes** → `/tenant/*` routes become active
5. **Header Shows Company Abbreviation** → e.g., "SIE" for Smart Innovations Energy
6. **All Operations Scoped** → Data filtered to that company
7. **Can Switch Back** → Return to platform view anytime

### Benefits:
- ✅ Clear separation between platform admin and company operations
- ✅ Prevents accidental cross-company data access
- ✅ Platform management is primary view for system owners
- ✅ Company entry is intentional and can be tracked/audited
- ✅ Easy to switch between companies for support/testing

## Data Isolation Strategy

### Application-Level Filtering

**System Owners (Platform Routes)**:
- RLS bypassed in application code
- Can query all data without organization_id filtering
- Full access to all organizations
- Used for platform administration

**System Owners (Tenant Routes)**:
- Application-level filtering by selected organization
- Data scoped to specific company
- Used for testing/support within a company

**Regular Users (All Routes)**:
- RLS policies active
- Always filtered by their `organization_id`
- Cannot access other organizations' data
- Secure data isolation maintained

### Implementation:

```javascript
// Platform Routes - No filtering
if (isPlatformRoute && isSystemOwner) {
  // Query all data, no organization_id filter
  const allOrgs = await db.query('SELECT * FROM organizations');
}

// Tenant Routes - Filter by organization
if (isTenantRoute) {
  const orgId = req.tenantContext?.organizationId;
  // Query filtered by organization_id
  const orgTasks = await db.query(
    'SELECT * FROM tasks WHERE organization_id = $1',
    [orgId]
  );
}
```

## User Experience Flow

### System Owner Flow:
1. Login → `/platform/dashboard`
2. View platform overview
3. Manage organizations
4. **Click "Enter Company"** → Select organization
5. Switch to `/tenant/dashboard` → See company data
6. Work within company context
7. **Click "Back to Platform"** → Return to platform view

### Regular User Flow:
1. Login → `/tenant/dashboard` (their organization)
2. Work within their company
3. All data automatically filtered
4. Cannot access platform routes

## Header Display

### Platform Routes:
- Shows: "SPHAiRDigital" or "Platform Admin"
- No company abbreviation
- Platform-level navigation

### Tenant Routes:
- Shows: Company abbreviation (e.g., "SIE")
- Company-specific navigation
- "Back to Platform" button (for system owners)

## Migration Path

### Current State:
- All routes are tenant-specific (`/tasks`, `/inventory`, etc.)
- System owners see filtered data
- No platform-level view

### Target State:
- Platform routes (`/platform/*`) for system admin
- Tenant routes (`/tenant/*`) for company operations
- Clear separation and deliberate company entry

### Steps:
1. Create platform routes structure
2. Create Platform Dashboard component
3. Implement application-level filtering
4. Add "Enter Company" functionality
5. Migrate existing routes to `/tenant/*`
6. Update navigation and header
7. Test access control

## Benefits of This Architecture

1. **Clear Separation**: Platform admin vs company operations
2. **Security**: Deliberate company entry prevents accidents
3. **Scalability**: Easy to add more companies
4. **User Experience**: System owners see platform overview first
5. **Flexibility**: Can switch between companies easily
6. **Auditability**: Company entry can be logged/tracked

## Next Steps

1. Implement application-level filtering middleware
2. Create Platform Dashboard component
3. Add platform routes structure
4. Migrate existing routes to tenant routes
5. Add "Enter Company" functionality
6. Update header to show company abbreviation
7. Test with system owner and regular users
