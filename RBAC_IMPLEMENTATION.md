# RBAC System Implementation Guide

## Overview

The SPHAiR Digital now includes a comprehensive Role-Based Access Control (RBAC) system that provides fine-grained permission management based on user roles and responsibilities.

## Architecture

### Database Schema

The RBAC system consists of four main tables:

1. **`roles`** - Defines all available roles in the system
2. **`permissions`** - Defines all available permissions (resource:action pairs)
3. **`role_permissions`** - Maps roles to their permissions
4. **`user_roles`** - Maps users to their roles (supports multiple roles per user)

### Roles

The system includes the following roles:

- **System Owner** (`system_owner`) - Full system access and control
- **Operations Administrator** (`operations_admin`) - Manages daily operations and users
- **Supervisor** (`supervisor`) - Oversees work execution and approves requests
- **Technician** (`technician`) - Performs maintenance tasks and completes checklists
- **General Worker** (`general_worker`) - Basic access to assigned tasks only
- **Inventory Controller** (`inventory_controller`) - Manages inventory and spares

### Permissions

Permissions follow the format `resource:action`:

- **Tasks**: `tasks:create`, `tasks:read`, `tasks:update`, `tasks:delete`, `tasks:assign`, `tasks:approve`, `tasks:execute`
- **Templates**: `templates:create`, `templates:read`, `templates:update`, `templates:delete`
- **Inventory**: `inventory:create`, `inventory:read`, `inventory:update`, `inventory:delete`, `inventory:approve`
- **Users**: `users:create`, `users:read`, `users:update`, `users:delete`, `users:manage_roles`
- **CM Letters**: `cm_letters:create`, `cm_letters:read`, `cm_letters:update`, `cm_letters:delete`, `cm_letters:download`
- **Calendar**: `calendar:read`, `calendar:update`
- **Plant Map**: `plant:read`, `plant:update`, `plant:approve`
- **Notifications**: `notifications:read`, `notifications:update`, `notifications:approve`
- **Reports**: `reports:read`, `reports:download`
- **System**: `system:admin`, `system:settings`

## Installation

### 1. Run Database Migration

```bash
cd server
psql -U postgres -d your_database -f db/migrations/create_rbac_system.sql
```

### 2. Migrate Existing Users

```bash
cd server
node scripts/migrate-users-to-rbac.js
```

This script will:
- Map legacy roles to new RBAC roles
- Assign appropriate roles to existing users
- Skip users that already have roles assigned

## Backend Usage

### Middleware

#### Require Permission

```javascript
const { requirePermission } = require('./middleware/rbac');

// Require specific permission
router.post('/tasks', requirePermission('tasks:create'), async (req, res) => {
  // Route handler
});

// Require any of multiple permissions
const { requireAnyPermission } = require('./middleware/rbac');
router.get('/tasks', requireAnyPermission('tasks:read', 'tasks:update'), async (req, res) => {
  // Route handler
});

// Require all permissions
const { requireAllPermissions } = require('./middleware/rbac');
router.put('/tasks/:id', requireAllPermissions('tasks:update', 'tasks:approve'), async (req, res) => {
  // Route handler
});
```

#### Require Role

```javascript
const { requireRole } = require('./middleware/rbac');

router.get('/admin', requireRole('system_owner', 'operations_admin'), async (req, res) => {
  // Route handler
});
```

#### Helper Functions

```javascript
const { hasPermission, hasAnyPermission, hasRole } = require('./middleware/rbac');

// In route handlers
if (hasPermission(req, 'tasks:delete')) {
  // User can delete tasks
}

if (hasAnyRole(req, 'supervisor', 'operations_admin')) {
  // User is supervisor or admin
}
```

### Loading RBAC Data

RBAC data (permissions and roles) is automatically loaded:
- During login (stored in session)
- In JWT tokens (for stateless authentication)
- On-demand via `loadUserRBAC` middleware

## Frontend Usage

### Hooks

#### usePermissions Hook

```javascript
import { usePermissions } from '../hooks/usePermissions';

function MyComponent() {
  const { hasPermission, hasRole, canPerformAction } = usePermissions();
  
  if (hasPermission('tasks:create')) {
    // Show create button
  }
  
  if (hasRole('supervisor')) {
    // Show supervisor features
  }
  
  if (canPerformAction('inventory', 'update')) {
    // Show inventory update button
  }
}
```

### Protected Routes

```javascript
import ProtectedRoute from './components/ProtectedRoute';

<Route 
  path="/users" 
  element={
    <ProtectedRoute requirePermission="users:read">
      <UserManagement />
    </ProtectedRoute>
  } 
/>

// Require any of multiple permissions
<Route 
  path="/tasks" 
  element={
    <ProtectedRoute requirePermission={['tasks:read', 'tasks:update']}>
      <Tasks />
    </ProtectedRoute>
  } 
/>

// Require specific role
<Route 
  path="/admin" 
  element={
    <ProtectedRoute requireRole="system_owner">
      <AdminPanel />
    </ProtectedRoute>
  } 
/>
```

### Conditional Rendering

```javascript
import { usePermissions } from '../hooks/usePermissions';
import { PERMISSIONS } from '../utils/permissions';

function TaskList() {
  const { hasPermission } = usePermissions();
  
  return (
    <div>
      <h1>Tasks</h1>
      {hasPermission(PERMISSIONS.TASKS_CREATE) && (
        <button onClick={handleCreate}>Create Task</button>
      )}
      {hasPermission(PERMISSIONS.TASKS_DELETE) && (
        <button onClick={handleDelete}>Delete</button>
      )}
    </div>
  );
}
```

## Permission Constants

Use permission constants for type safety:

```javascript
import { PERMISSIONS, ROLES } from '../utils/permissions';

// Check permission
if (hasPermission(PERMISSIONS.TASKS_CREATE)) {
  // ...
}

// Check role
if (hasRole(ROLES.SUPERVISOR)) {
  // ...
}
```

## Role Permissions Matrix

| Role | Tasks | Templates | Inventory | Users | CM Letters | Calendar | Plant | Reports |
|------|-------|-----------|-----------|-------|------------|----------|-------|---------|
| System Owner | All | All | All | All | All | All | All | All |
| Operations Admin | All | All | All | All | All | All | All | All |
| Supervisor | Create, Read, Update, Assign, Approve | Read | Read, Approve | Read | All | Read, Update | Read, Approve | Read, Download |
| Technician | Read, Update, Execute | Read | Read | - | Create, Read, Update | Read | Read, Update | - |
| General Worker | Read, Update, Execute (assigned only) | Read | - | - | - | Read | - | - |
| Inventory Controller | Read | - | All | - | - | - | - | Read, Download |

## Migration from Legacy Roles

The system maintains backward compatibility with legacy roles:

- `super_admin` → `system_owner`
- `admin` → `operations_admin`
- `supervisor` → `supervisor`
- `technician` → `technician`

Legacy role checks will continue to work, but new code should use RBAC permissions.

## Best Practices

1. **Use Permissions, Not Roles**: Check permissions rather than roles for fine-grained control
2. **Fail Securely**: Default to denying access if permission check fails
3. **Cache Permissions**: Permissions are cached in session/JWT to reduce database queries
4. **Audit Access**: Log permission checks for security auditing
5. **Test Thoroughly**: Test all permission combinations for each role

## Troubleshooting

### Permissions Not Loading

1. Check if RBAC tables exist: `SELECT * FROM roles;`
2. Verify user has roles assigned: `SELECT * FROM user_roles WHERE user_id = '...';`
3. Check session data: `req.session.permissions` should contain permission codes

### Migration Issues

1. Run migration script: `node scripts/migrate-users-to-rbac.js`
2. Check for errors in console output
3. Verify role mappings in `ROLE_MAPPING` constant

### Frontend Permission Checks Failing

1. Verify user object includes `permissions` array
2. Check API response includes permissions in user object
3. Ensure `usePermissions` hook is used correctly

## Future Enhancements

- Permission inheritance (roles can inherit from other roles)
- Dynamic permission assignment (assign permissions directly to users)
- Permission groups (group related permissions)
- Time-based permissions (permissions that expire)
- Audit logging for permission checks
