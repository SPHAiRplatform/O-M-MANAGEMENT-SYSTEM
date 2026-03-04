# SPHAiR Digital - Configuration Options Guide

**Version:** 1.0  
**Last Updated:** January 2026  
**Purpose:** Document all per-company configuration options available in SPHAiR Digital

---

## Overview

SPHAiR Digital uses a **configuration-driven architecture** where companies can customize their experience without changing core features. All configuration is stored in three main tables:

1. **`organization_settings`** - Flexible key-value settings (JSONB)
2. **`organization_features`** - Feature flags and module enablement
3. **`organization_branding`** - Visual branding and appearance

---

## Table: `organization_settings`

**Purpose:** Store flexible, key-value configuration settings per organization  
**Structure:** JSONB values allow schema evolution without migrations

### Available Settings

#### Dashboard Configuration

**Setting Key:** `dashboard`

```json
{
  "layout": "grid|list|compact",
  "visible_cards": ["tasks", "assets", "inventory", "calendar", "plant"],
  "kpi_visibility": {
    "pending_tasks": true,
    "completed_tasks": true,
    "open_cm_letters": true,
    "in_progress_tasks": true
  },
  "refresh_interval": 30,
  "default_view": "overview|tasks|assets"
}
```

**Fields:**
- `layout` (string): Dashboard layout style - `grid` (default), `list`, or `compact`
- `visible_cards` (array): Which dashboard cards to show
- `kpi_visibility` (object): Toggle visibility of specific KPIs
- `refresh_interval` (number): Auto-refresh interval in seconds (default: 30)
- `default_view` (string): Default dashboard view when user logs in

**Example:**
```sql
INSERT INTO organization_settings (organization_id, setting_key, setting_value, description)
VALUES (
  'org-uuid',
  'dashboard',
  '{"layout": "grid", "visible_cards": ["tasks", "assets"], "kpi_visibility": {"pending_tasks": true}}'::jsonb,
  'Dashboard layout and visibility preferences'
);
```

#### Notification Configuration

**Setting Key:** `notifications`

```json
{
  "email_enabled": true,
  "sms_enabled": false,
  "channels": ["in_app", "email"],
  "rules": [
    {
      "event": "task_assigned",
      "channels": ["in_app", "email"],
      "recipients": ["assignee", "supervisor"],
      "template": "default"
    },
    {
      "event": "task_completed",
      "channels": ["in_app"],
      "recipients": ["assignee", "supervisor"],
      "template": "default"
    },
    {
      "event": "cm_letter_generated",
      "channels": ["in_app", "email"],
      "recipients": ["admin", "supervisor"],
      "template": "cm_letter"
    }
  ],
  "quiet_hours": {
    "enabled": true,
    "start": "22:00",
    "end": "07:00",
    "timezone": "UTC"
  }
}
```

**Fields:**
- `email_enabled` (boolean): Enable email notifications
- `sms_enabled` (boolean): Enable SMS notifications (requires SMS provider)
- `channels` (array): Available notification channels
- `rules` (array): Event-based notification rules
  - `event` (string): Event type (task_assigned, task_completed, cm_letter_generated, etc.)
  - `channels` (array): Channels to use for this event
  - `recipients` (array): Who should receive notifications
  - `template` (string): Notification template to use
- `quiet_hours` (object): Do not send notifications during these hours

**Example:**
```sql
INSERT INTO organization_settings (organization_id, setting_key, setting_value, description)
VALUES (
  'org-uuid',
  'notifications',
  '{"email_enabled": true, "channels": ["in_app", "email"], "rules": [...]}'::jsonb,
  'Notification preferences and rules'
);
```

#### Report Configuration

**Setting Key:** `reports`

```json
{
  "templates": {
    "pm_report": {
      "enabled": true,
      "custom_fields": ["location", "technician", "asset_type"],
      "format": "pdf",
      "include_charts": true,
      "include_images": true
    },
    "cm_report": {
      "enabled": true,
      "custom_fields": ["failure_reason", "corrective_action"],
      "format": "pdf",
      "include_charts": true
    },
    "inventory_report": {
      "enabled": true,
      "custom_fields": ["location", "category"],
      "format": "excel",
      "include_low_stock": true
    }
  },
  "default_format": "pdf",
  "auto_generate": {
    "pm_monthly": true,
    "cm_weekly": false
  },
  "delivery": {
    "email": true,
    "storage": "cloud",
    "retention_days": 90
  }
}
```

**Fields:**
- `templates` (object): Report template configurations
  - `enabled` (boolean): Enable this report type
  - `custom_fields` (array): Additional fields to include
  - `format` (string): Report format (`pdf`, `excel`, `csv`)
  - `include_charts` (boolean): Include charts/graphs
  - `include_images` (boolean): Include images/photos
- `default_format` (string): Default report format
- `auto_generate` (object): Auto-generation schedules
- `delivery` (object): Report delivery options

**Example:**
```sql
INSERT INTO organization_settings (organization_id, setting_key, setting_value, description)
VALUES (
  'org-uuid',
  'reports',
  '{"templates": {"pm_report": {"enabled": true, "format": "pdf"}}}'::jsonb,
  'Report template and generation preferences'
);
```

#### Task Configuration

**Setting Key:** `tasks`

```json
{
  "default_priority": "medium",
  "auto_assign": false,
  "require_photos": true,
  "require_checklist": true,
  "allow_early_completion": true,
  "workflow": {
    "pm_to_cm_auto_generate": true,
    "cm_letter_auto_generate": true,
    "approval_required": false
  },
  "reminders": {
    "enabled": true,
    "days_before_due": [3, 1],
    "channels": ["in_app", "email"]
  }
}
```

**Fields:**
- `default_priority` (string): Default task priority (`low`, `medium`, `high`, `urgent`)
- `auto_assign` (boolean): Auto-assign tasks based on rules
- `require_photos` (boolean): Require photos for task completion
- `require_checklist` (boolean): Require checklist completion
- `allow_early_completion` (boolean): Allow tasks to be completed before due date
- `workflow` (object): Task workflow automation
- `reminders` (object): Task reminder configuration

#### Inventory Configuration

**Setting Key:** `inventory`

```json
{
  "low_stock_threshold": 10,
  "auto_reorder": false,
  "track_consumption": true,
  "require_approval": false,
  "categories": ["spare_parts", "consumables", "tools"],
  "units": {
    "default": "pieces",
    "allowed": ["pieces", "liters", "kilograms", "meters"]
  }
}
```

**Fields:**
- `low_stock_threshold` (number): Threshold for low stock alerts
- `auto_reorder` (boolean): Enable automatic reordering
- `track_consumption` (boolean): Track item consumption
- `require_approval` (boolean): Require approval for inventory changes
- `categories` (array): Custom inventory categories
- `units` (object): Unit of measurement configuration

#### Calendar Configuration

**Setting Key:** `calendar`

```json
{
  "default_view": "month",
  "working_hours": {
    "start": "08:00",
    "end": "17:00",
    "days": ["monday", "tuesday", "wednesday", "thursday", "friday"]
  },
  "holidays": ["2026-01-01", "2026-12-25"],
  "timezone": "UTC",
  "show_weekends": true
}
```

**Fields:**
- `default_view` (string): Default calendar view (`month`, `week`, `day`)
- `working_hours` (object): Organization working hours
- `holidays` (array): Organization holidays (ISO date format)
- `timezone` (string): Organization timezone
- `show_weekends` (boolean): Show weekends on calendar

#### Security Configuration

**Setting Key:** `security`

```json
{
  "password_policy": {
    "min_length": 8,
    "require_uppercase": true,
    "require_lowercase": true,
    "require_numbers": true,
    "require_special": false,
    "expiry_days": 90
  },
  "session_timeout": 3600,
  "two_factor_enabled": false,
  "ip_whitelist": [],
  "audit_log_retention_days": 365
}
```

**Fields:**
- `password_policy` (object): Password requirements
- `session_timeout` (number): Session timeout in seconds
- `two_factor_enabled` (boolean): Enable 2FA
- `ip_whitelist` (array): Allowed IP addresses (empty = all)
- `audit_log_retention_days` (number): How long to keep audit logs

---

## Table: `organization_features`

**Purpose:** Enable/disable features and modules per organization  
**Structure:** Feature flags with optional JSONB configuration

### Available Features

#### Feature Codes

| Feature Code | Description | Default Config |
|--------------|-------------|----------------|
| `tasks` | Task Management Module | `{"enabled": true}` |
| `inventory` | Inventory Management | `{"enabled": true}` |
| `calendar` | Calendar/Scheduling | `{"enabled": true}` |
| `plant` | Plant Management | `{"enabled": true}` |
| `reports` | Reporting Module | `{"enabled": true}` |
| `cm_letters` | CM Letter Generation | `{"enabled": true}` |
| `checklist_templates` | Checklist Templates | `{"enabled": true}` |
| `notifications` | Notification System | `{"enabled": true}` |
| `offline_sync` | Offline Sync Capability | `{"enabled": true}` |
| `api_access` | API Access | `{"enabled": false, "rate_limit": 1000}` |
| `advanced_analytics` | Advanced Analytics | `{"enabled": false}` |
| `custom_branding` | Custom Branding | `{"enabled": true}` |
| `multi_user` | Multi-User Support | `{"enabled": true}` |
| `audit_trail` | Audit Trail | `{"enabled": true}` |

### Feature Configuration Examples

#### Task Management Feature

```sql
INSERT INTO organization_features (organization_id, feature_code, is_enabled, config)
VALUES (
  'org-uuid',
  'tasks',
  true,
  '{
    "max_concurrent_tasks": 100,
    "allow_task_delegation": true,
    "enable_task_templates": true
  }'::jsonb
);
```

#### API Access Feature

```sql
INSERT INTO organization_features (organization_id, feature_code, is_enabled, config)
VALUES (
  'org-uuid',
  'api_access',
  true,
  '{
    "rate_limit": 1000,
    "allowed_endpoints": ["tasks", "assets", "inventory"],
    "require_authentication": true
  }'::jsonb
);
```

#### Advanced Analytics Feature

```sql
INSERT INTO organization_features (organization_id, feature_code, is_enabled, config)
VALUES (
  'org-uuid',
  'advanced_analytics',
  true,
  '{
    "data_retention_days": 365,
    "enable_predictive": false,
    "export_formats": ["pdf", "excel"]
  }'::jsonb
);
```

### Checking Feature Availability

**In Application Code:**
```javascript
// Check if feature is enabled
const feature = await db.query(
  'SELECT is_enabled, config FROM organization_features WHERE organization_id = $1 AND feature_code = $2',
  [orgId, 'tasks']
);

if (feature.rows[0]?.is_enabled) {
  // Feature is enabled, proceed
}
```

---

## Table: `organization_branding`

**Purpose:** Visual branding and appearance customization  
**Structure:** Logo, colors, and branding configuration

### Branding Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `logo_url` | VARCHAR(255) | URL to company logo | `https://cdn.example.com/logo.png` |
| `primary_color` | VARCHAR(50) | Primary brand color | `#1A73E8` |
| `secondary_color` | VARCHAR(50) | Secondary brand color | `#4285F4` |
| `company_name_display` | VARCHAR(255) | Display name in UI (format: "{ABBREVIATION} O&M System") | `SIE O&M System` |
| `favicon_url` | VARCHAR(255) | Favicon URL | `https://cdn.example.com/favicon.ico` |
| `custom_domain` | VARCHAR(255) | Custom domain (if applicable) | `solar.sie.com` |
| `branding_config` | JSONB | Additional branding options | See below |

### Branding Config (JSONB)

```json
{
  "theme": "light|dark|auto",
  "font_family": "Roboto|Arial|Custom",
  "custom_css": "https://cdn.example.com/custom.css",
  "login_page": {
    "background_image": "https://cdn.example.com/login-bg.jpg",
    "show_logo": true,
    "custom_message": "Welcome to SIE O&M System"
  },
  "header": {
    "show_company_name": true,
    "logo_position": "left|center|right"
  },
  "footer": {
    "show_copyright": true,
    "custom_text": "© 2026 Smart Innovations Energy"
  }
}
```

### Example: Complete Branding Setup

```sql
INSERT INTO organization_branding (
  organization_id,
  logo_url,
  primary_color,
  secondary_color,
  company_name_display,
  favicon_url,
  custom_domain,
  branding_config
)
VALUES (
  'org-uuid',
  'https://cdn.example.com/logo.png',
  '#1A73E8',
  '#4285F4',
  'SIE O&M System',
  'https://cdn.example.com/favicon.ico',
  NULL,
  '{
    "theme": "light",
    "font_family": "Roboto",
    "login_page": {
      "show_logo": true,
      "custom_message": "Welcome to Smart Innovations Energy"
    }
  }'::jsonb
);
```

---

## Configuration Management API

### Get Organization Settings

```http
GET /api/organizations/:id/settings
```

**Response:**
```json
[
  {
    "setting_key": "dashboard",
    "setting_value": {"layout": "grid", "visible_cards": ["tasks"]},
    "description": "Dashboard configuration"
  }
]
```

### Update Organization Settings

```http
PUT /api/organizations/:id/settings
Content-Type: application/json

{
  "settings": [
    {
      "setting_key": "dashboard",
      "setting_value": {"layout": "list", "visible_cards": ["tasks", "assets"]},
      "description": "Dashboard preferences"
    }
  ]
}
```

### Get Organization Features

```http
GET /api/organizations/:id/features
```

**Response:**
```json
[
  {
    "feature_code": "tasks",
    "is_enabled": true,
    "config": {"max_concurrent_tasks": 100}
  }
]
```

### Update Organization Features

```http
PUT /api/organizations/:id/features
Content-Type: application/json

{
  "features": [
    {
      "feature_code": "tasks",
      "is_enabled": true,
      "config": {"max_concurrent_tasks": 150}
    }
  ]
}
```

### Get Organization Branding

```http
GET /api/organizations/:id/branding
```

**Response:**
```json
{
  "logo_url": "https://cdn.example.com/logo.png",
  "primary_color": "#1A73E8",
  "secondary_color": "#4285F4",
  "company_name_display": "SIE O&M System",
  "branding_config": {"theme": "light"}
}
```

### Update Organization Branding

```http
PUT /api/organizations/:id/branding
Content-Type: application/json

{
  "logo_url": "https://cdn.example.com/new-logo.png",
  "primary_color": "#FF5722",
  "secondary_color": "#FF9800",
  "company_name_display": "New Company Name",
  "branding_config": {"theme": "dark"}
}
```

---

## Best Practices

### 1. Configuration Defaults
- Always provide sensible defaults for new organizations
- Use `organization_settings` for flexible, evolving configuration
- Use `organization_features` for feature flags and module control
- Use `organization_branding` for visual customization only

### 2. Configuration Validation
- Validate JSONB structure before saving
- Provide clear error messages for invalid configuration
- Use JSON schemas for complex configurations

### 3. Configuration Migration
- When adding new configuration options, provide migration scripts
- Document breaking changes in configuration structure
- Support backward compatibility where possible

### 4. Performance
- Cache configuration in application layer
- Invalidate cache when configuration changes
- Use indexes on `organization_id` and `setting_key`/`feature_code`

### 5. Security
- Validate all configuration inputs
- Sanitize URLs in branding configuration
- Restrict file uploads for logos/favicons
- Audit configuration changes

---

## Configuration Examples by Use Case

### Use Case 1: Basic Company Setup

```sql
-- Enable all standard features
INSERT INTO organization_features (organization_id, feature_code, is_enabled, config)
VALUES
  ('org-uuid', 'tasks', true, '{}'::jsonb),
  ('org-uuid', 'inventory', true, '{}'::jsonb),
  ('org-uuid', 'calendar', true, '{}'::jsonb),
  ('org-uuid', 'plant', true, '{}'::jsonb);

-- Set basic dashboard configuration
INSERT INTO organization_settings (organization_id, setting_key, setting_value, description)
VALUES (
  'org-uuid',
  'dashboard',
  '{"layout": "grid", "visible_cards": ["tasks", "assets", "inventory"]}'::jsonb,
  'Default dashboard configuration'
);

-- Set basic branding
INSERT INTO organization_branding (organization_id, primary_color, secondary_color, company_name_display)
VALUES (
  'org-uuid',
  '#1A73E8',
  '#4285F4',
  'O&M System'  -- Will be auto-generated as "{ABBREVIATION} O&M System" based on company name
);
```

### Use Case 2: Premium Subscription (Advanced Features)

```sql
-- Enable advanced features
INSERT INTO organization_features (organization_id, feature_code, is_enabled, config)
VALUES
  ('org-uuid', 'advanced_analytics', true, '{"data_retention_days": 730}'::jsonb),
  ('org-uuid', 'api_access', true, '{"rate_limit": 5000}'::jsonb),
  ('org-uuid', 'custom_branding', true, '{"allow_custom_css": true}'::jsonb);
```

### Use Case 3: Restricted Access (Limited Features)

```sql
-- Disable certain features
INSERT INTO organization_features (organization_id, feature_code, is_enabled, config)
VALUES
  ('org-uuid', 'reports', false, '{}'::jsonb),
  ('org-uuid', 'api_access', false, '{}'::jsonb),
  ('org-uuid', 'advanced_analytics', false, '{}'::jsonb);
```

---

## Troubleshooting

### Configuration Not Applied
- Check if configuration is saved correctly in database
- Verify `organization_id` matches current organization
- Clear application cache if caching is enabled
- Check application logs for configuration loading errors

### Feature Not Working
- Verify feature is enabled: `SELECT is_enabled FROM organization_features WHERE feature_code = 'feature_name'`
- Check feature configuration for restrictions
- Verify user has permissions for the feature
- Check application logs for feature-specific errors

### Branding Not Showing
- Verify logo/favicon URLs are accessible
- Check browser console for 404 errors on assets
- Verify `branding_config` JSONB is valid
- Clear browser cache

---

## Future Configuration Options

Planned additions (not yet implemented):

- **Workflow Configuration:** Customize task workflows per organization
- **Integration Configuration:** Third-party integrations (Slack, Teams, etc.)
- **Data Retention:** Per-organization data retention policies
- **Export Configuration:** Custom export formats and fields
- **Localization:** Language and regional settings per organization

---

## Support

For questions or issues with configuration:
- Review this documentation
- Check `server/docs/ARCHITECTURAL_REVIEW.md` for architecture details
- Contact platform support for assistance
