# SPHAiR Multi-Tenant SaaS Platform Architecture

**Version:** 1.0  
**Date:** January 2026  
**Status:** Strategic Architecture Document  
**Author:** Senior Developer & Prompt Engineer (10+ years experience)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Multi-Tenancy Architecture](#multi-tenancy-architecture)
3. [Update & Deployment Strategy](#update--deployment-strategy)
4. [License Management System](#license-management-system)
5. [White-Labeling & Customization](#white-labeling--customization)
6. [Feature Flags & Toggles](#feature-flags--toggles)
7. [Admin Dashboard for BRIGHTSTEP](#admin-dashboard-for-brightstep)
8. [Additional SaaS Platform Features](#additional-saas-platform-features)
9. [Database Schema Design](#database-schema-design)
10. [Implementation Phases](#implementation-phases)
11. [Security Considerations](#security-considerations)
12. [Scalability & Performance](#scalability--performance)

---

## Executive Summary

SPHAiR should be architected as a **multi-tenant SaaS platform** where BRIGHTSTEP TECHNOLOGIES maintains full control over deployments, updates, and system customization. This document outlines the strategic architecture for:

1. **Scheduled Maintenance Windows** (02:00-06:00 like Capitec)
2. **Multi-Tenant License System** (companies with tiered user limits)
3. **White-Labeling** (custom branding per company)
4. **Feature Toggles** (enable/disable features per company)
5. **Admin Dashboard** (BRIGHTSTEP manages all companies)

**Target Model:** Similar to Salesforce, HubSpot, Monday.com - SaaS platform serving multiple companies.

---

## Multi-Tenancy Architecture

### Architecture Pattern: **Row-Level Security (RLS) with Tenant Isolation**

```
┌─────────────────────────────────────────────────────────┐
│              BRIGHTSTEP Central Admin                      │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Multi-Tenant Management Dashboard               │   │
│  │  - View all companies                            │   │
│  │  - License management                            │   │
│  │  - White-label configuration                     │   │
│  │  - Feature toggle management                     │   │
│  │  - System updates & deployments                  │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                          │
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
        ▼                 ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Company A  │  │   Company B  │  │   Company C  │
│  (Small 2-10)│  │ (Medium 10-30)│  │ (Large 30+)  │
│              │  │              │  │              │
│ Custom Brand │  │ Custom Brand │  │ Custom Brand │
│ Feature Set A│  │ Feature Set B│  │ Feature Set C│
│ Users: 5/10  │  │ Users: 25/30 │  │ Users: 50/50 │
└──────────────┘  └──────────────┘  └──────────────┘
```

### Key Principles

1. **Data Isolation:** Each company's data is completely isolated (tenant_id on every table)
2. **Shared Infrastructure:** Single codebase, single database (cost-effective)
3. **Customization:** Per-company branding and feature configuration
4. **Centralized Control:** BRIGHTSTEP has full control over all deployments

---

## Update & Deployment Strategy

### Strategy: **Blue-Green Deployment with Maintenance Windows**

#### Deployment Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Production Environment                       │
│                                                          │
│  ┌──────────────┐         ┌──────────────┐            │
│  │  Blue Server │◄───────►│ Green Server │            │
│  │  (Active)    │  Load   │  (Standby)   │            │
│  └──────────────┘  Balancer└──────────────┘            │
│         │                    │                          │
│         └──────────┬─────────┘                          │
│                    ▼                                     │
│         ┌──────────────────┐                            │
│         │  Shared Database │                            │
│         │  (Multi-Tenant)  │                            │
│         └──────────────────┘                            │
└─────────────────────────────────────────────────────────┘
                          ▲
                          │
              ┌───────────┴───────────┐
              │                       │
    ┌─────────▼─────┐       ┌────────▼────────┐
    │ CI/CD Pipeline│       │ Maintenance     │
    │ (GitHub)      │       │ Window Scheduler│
    │               │       │ (02:00-06:00)   │
    └───────────────┘       └─────────────────┘
```

### Maintenance Window Strategy (02:00-06:00)

#### Automated Maintenance Process

**Step 1: Pre-Maintenance Checks (01:50)**
- Verify all scheduled tasks completed
- Check active users count
- Verify database backups completed
- Check system health metrics

**Step 2: Enter Maintenance Mode (02:00)**
- Set maintenance flag in database
- Show maintenance page to users
- Disable new login attempts
- Gracefully handle active sessions (30-min grace period)

**Step 3: Deploy to Standby Server (02:05-05:00)**
- Deploy new code to Green server
- Run database migrations
- Run health checks
- Verify all services operational

**Step 4: Switch Traffic (05:00-05:30)**
- Switch load balancer to Green server
- Monitor for 30 minutes
- Verify all companies' systems working

**Step 5: Exit Maintenance Mode (05:30)**
- Remove maintenance flag
- Re-enable login
- Send notification emails to admins
- Log deployment completion

**Step 6: Post-Deployment (05:30-06:00)**
- Monitor error rates
- Monitor performance metrics
- Rollback if critical issues detected

### Deployment Methods

#### Option 1: Automated CI/CD (Recommended)

```yaml
# .github/workflows/maintenance-deployment.yml
name: Scheduled Maintenance Deployment

on:
  schedule:
    # Run at 02:00 SAST daily (or weekly as needed)
    - cron: '0 2 * * 0'  # Every Sunday at 02:00
  workflow_dispatch:  # Manual trigger

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Enter Maintenance Mode
        run: |
          ssh user@server 'curl -X POST https://api.sphair.com/admin/maintenance/enable \
            -H "Authorization: Bearer ${{ secrets.ADMIN_TOKEN }}"'
      
      - name: Wait for Active Sessions
        run: sleep 1800  # 30 minutes grace period
      
      - name: Deploy to Standby Server
        run: |
          ssh user@green-server 'cd /app && git pull && \
            docker-compose build && docker-compose up -d && \
            npm run migrate'
      
      - name: Health Check
        run: |
          # Wait for services to be ready
          sleep 60
          curl https://green-server.sphair.com/health || exit 1
      
      - name: Switch Traffic
        run: |
          ssh user@load-balancer 'switch-to-green.sh'
      
      - name: Verify Deployment
        run: |
          sleep 300  # 5 minutes
          # Check error rates, performance
          curl https://api.sphair.com/health/metrics || exit 1
      
      - name: Exit Maintenance Mode
        run: |
          ssh user@server 'curl -X POST https://api.sphair.com/admin/maintenance/disable \
            -H "Authorization: Bearer ${{ secrets.ADMIN_TOKEN }}"'
      
      - name: Rollback on Failure
        if: failure()
        run: |
          ssh user@load-balancer 'switch-to-blue.sh'
          ssh user@server 'curl -X POST https://api.sphair.com/admin/maintenance/disable \
            -H "Authorization: Bearer ${{ secrets.ADMIN_TOKEN }}"'
```

#### Option 2: Manual Deployment Script

```bash
#!/bin/bash
# deploy-maintenance.sh

MAINTENANCE_START="02:00"
MAINTENANCE_END="06:00"

# Step 1: Enable maintenance mode
echo "Enabling maintenance mode..."
curl -X POST https://api.sphair.com/admin/maintenance/enable \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Step 2: Wait for active sessions to finish
echo "Waiting for active sessions (30 minutes)..."
sleep 1800

# Step 3: Deploy to standby
echo "Deploying to standby server..."
ssh user@green-server "cd /app && git pull && docker-compose up -d --build"

# Step 4: Run migrations
echo "Running database migrations..."
ssh user@green-server "cd /app && npm run migrate"

# Step 5: Health check
echo "Running health checks..."
curl https://green-server.sphair.com/health || exit 1

# Step 6: Switch traffic
echo "Switching traffic to new server..."
ssh user@load-balancer "./switch-to-green.sh"

# Step 7: Disable maintenance mode
echo "Exiting maintenance mode..."
sleep 300  # Monitor for 5 minutes
curl -X POST https://api.sphair.com/admin/maintenance/disable \
  -H "Authorization: Bearer $ADMIN_TOKEN"

echo "Deployment complete!"
```

### Maintenance Mode Implementation

**Database Table:**
```sql
CREATE TABLE maintenance_mode (
  id SERIAL PRIMARY KEY,
  is_active BOOLEAN DEFAULT false,
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  reason TEXT,
  initiated_by UUID REFERENCES users(id)
);
```

**API Endpoints:**
- `POST /admin/maintenance/enable` - Enable maintenance mode
- `POST /admin/maintenance/disable` - Disable maintenance mode
- `GET /admin/maintenance/status` - Check maintenance status
- `GET /maintenance` - Public endpoint (returns maintenance page HTML)

**Frontend Implementation:**
- Check maintenance status on app load
- Show maintenance page if active
- Poll every 60 seconds to detect when maintenance ends
- Gracefully handle API errors during maintenance

---

## License Management System

### License Tiers

| Tier | User Limit | Price/Month | Features |
|------|-----------|-------------|----------|
| **Small** | 2-10 users | $X | Basic features |
| **Medium** | 10-30 users | $Y | Standard features |
| **Large Enterprise** | 30+ users | $Z | All features + priority support |

### License Model

**Each Company Has:**
- Unique `company_id` (tenant identifier)
- License tier (small/medium/large)
- Maximum user limit
- Current user count (enforced)
- License expiry date
- Feature configuration (white-labeling, feature toggles)

### Database Schema

```sql
-- Companies (Tenants) Table
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name VARCHAR(255) NOT NULL,
  company_code VARCHAR(50) UNIQUE NOT NULL,  -- Unique identifier (e.g., "ABC-SOLAR")
  license_tier VARCHAR(20) NOT NULL,  -- 'small', 'medium', 'large'
  max_users INTEGER NOT NULL,  -- User limit based on tier
  current_user_count INTEGER DEFAULT 0,  -- Tracked automatically
  license_key VARCHAR(255) UNIQUE NOT NULL,  -- Signed license key
  license_status VARCHAR(20) DEFAULT 'active',  -- 'active', 'expired', 'suspended'
  license_expires_at TIMESTAMP,
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  billing_email VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Company Settings (White-Label Configuration)
CREATE TABLE company_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  setting_key VARCHAR(100) NOT NULL,  -- 'primary_color', 'logo_url', 'company_name_display'
  setting_value TEXT,  -- JSON or string value
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, setting_key)
);

-- Company Feature Toggles
CREATE TABLE company_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  feature_code VARCHAR(100) NOT NULL,  -- 'inventory', 'calendar', 'reporting', 'api_access'
  is_enabled BOOLEAN DEFAULT true,
  config JSONB,  -- Feature-specific configuration
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, feature_code)
);

-- Users table (add company_id)
ALTER TABLE users ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
CREATE INDEX idx_users_company_id ON users(company_id);
```

### License Enforcement

**Middleware to Check License:**
```javascript
// server/middleware/licenseCheck.js
async function checkCompanyLicense(req, res, next) {
  const companyId = req.session.company_id || req.user?.company_id;
  
  if (!companyId) {
    return res.status(403).json({ error: 'No company associated' });
  }
  
  const company = await pool.query(
    'SELECT * FROM companies WHERE id = $1 AND license_status = $2',
    [companyId, 'active']
  );
  
  if (company.rows.length === 0) {
    return res.status(403).json({ 
      error: 'License inactive or expired',
      message: 'Please contact your administrator' 
    });
  }
  
  // Check user limit
  if (company.rows[0].current_user_count >= company.rows[0].max_users) {
    return res.status(403).json({ 
      error: 'User limit reached',
      message: `Maximum ${company.rows[0].max_users} users allowed` 
    });
  }
  
  req.company = company.rows[0];
  next();
}
```

**User Creation Enforcement:**
```javascript
// In user creation route
async function createUser(req, res) {
  const companyId = req.company.id;
  
  // Check current user count
  const userCount = await pool.query(
    'SELECT COUNT(*) FROM users WHERE company_id = $1 AND is_active = true',
    [companyId]
  );
  
  const currentCount = parseInt(userCount.rows[0].count);
  
  if (currentCount >= req.company.max_users) {
    return res.status(403).json({ 
      error: 'User limit reached',
      current: currentCount,
      max: req.company.max_users
    });
  }
  
  // Create user...
  // After creation, update company.current_user_count
}
```

---

## White-Labeling & Customization

### Customization Options

**1. Branding**
- Company logo
- Primary color (theme color)
- Secondary colors
- Company name display
- Favicon

**2. UI Customization**
- Custom login page background
- Custom welcome message
- Custom footer text
- Custom email templates

**3. Domain Customization** (Advanced)
- Custom subdomain (e.g., `abc-solar.sphair.com`)
- Custom domain (e.g., `app.abcsolar.com`) - requires DNS setup

### Implementation Strategy

**Company Settings Table:**
```sql
-- Example settings
INSERT INTO company_settings (company_id, setting_key, setting_value) VALUES
  ('company-uuid', 'primary_color', '#0066CC'),
  ('company-uuid', 'logo_url', 'https://cdn.sphair.com/logos/abc-solar.png'),
  ('company-uuid', 'company_name_display', 'ABC Solar O&M'),
  ('company-uuid', 'favicon_url', 'https://cdn.sphair.com/favicons/abc-solar.ico'),
  ('company-uuid', 'login_background_url', 'https://cdn.sphair.com/backgrounds/abc-solar.jpg'),
  ('company-uuid', 'welcome_message', 'Welcome to ABC Solar Management System');
```

**Frontend Theme Application:**
```javascript
// client/src/utils/companyTheme.js
export function getCompanyTheme(companyId) {
  // Fetch from API or localStorage
  const settings = getCompanySettings(companyId);
  
  return {
    primaryColor: settings.primary_color || '#0066CC',
    logo: settings.logo_url || '/default-logo.png',
    companyName: settings.company_name_display || 'SPHAiR Digital',
    favicon: settings.favicon_url || '/favicon.ico'
  };
}

// Apply theme on app load
export function applyCompanyTheme(theme) {
  // Set CSS variables
  document.documentElement.style.setProperty('--primary-color', theme.primaryColor);
  
  // Update logo
  const logoImg = document.getElementById('company-logo');
  if (logoImg) logoImg.src = theme.logo;
  
  // Update favicon
  const favicon = document.querySelector("link[rel='icon']");
  if (favicon) favicon.href = theme.favicon;
  
  // Update company name
  const companyNameEl = document.getElementById('company-name');
  if (companyNameEl) companyNameEl.textContent = theme.companyName;
}
```

**API Endpoint:**
```javascript
// GET /api/company/settings
router.get('/settings', requireAuth, async (req, res) => {
  const companyId = req.session.company_id;
  
  const settings = await pool.query(
    'SELECT setting_key, setting_value FROM company_settings WHERE company_id = $1',
    [companyId]
  );
  
  const settingsObj = {};
  settings.rows.forEach(row => {
    settingsObj[row.setting_key] = row.setting_value;
  });
  
  res.json(settingsObj);
});
```

---

## Feature Flags & Toggles

### Feature Toggle System

**Available Features:**
- `inventory` - Inventory management module
- `calendar` - Calendar and scheduling
- `reporting` - Advanced reporting
- `api_access` - API access for integrations
- `offline_mode` - Offline functionality
- `mobile_app` - Mobile app access
- `advanced_analytics` - Analytics dashboard
- `custom_templates` - Custom checklist templates
- `multi_site` - Multi-site management
- `workflow_automation` - Advanced workflow automation

### Implementation

**Feature Check Middleware:**
```javascript
// server/middleware/featureCheck.js
function requireFeature(featureCode) {
  return async (req, res, next) => {
    const companyId = req.session.company_id || req.user?.company_id;
    
    const feature = await pool.query(
      `SELECT is_enabled FROM company_features 
       WHERE company_id = $1 AND feature_code = $2`,
      [companyId, featureCode]
    );
    
    if (feature.rows.length === 0 || !feature.rows[0].is_enabled) {
      return res.status(403).json({ 
        error: 'Feature not available',
        feature: featureCode,
        message: 'This feature is not enabled for your company' 
      });
    }
    
    next();
  };
}

// Usage in routes:
router.get('/inventory', requireAuth, requireFeature('inventory'), getInventory);
router.get('/calendar', requireAuth, requireFeature('calendar'), getCalendar);
```

**Frontend Feature Check:**
```javascript
// client/src/utils/permissions.js
export async function isFeatureEnabled(featureCode) {
  const features = await fetch('/api/company/features').then(r => r.json());
  return features[featureCode] === true;
}

// Usage in components:
if (await isFeatureEnabled('inventory')) {
  // Show inventory menu item
}
```

**Feature Management API:**
```javascript
// POST /admin/companies/:companyId/features/:featureCode
router.post('/admin/companies/:companyId/features/:featureCode', 
  requireAuth, requireSuperAdmin, 
  async (req, res) => {
    const { companyId, featureCode } = req.params;
    const { is_enabled, config } = req.body;
    
    await pool.query(
      `INSERT INTO company_features (company_id, feature_code, is_enabled, config)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, feature_code) 
       DO UPDATE SET is_enabled = $3, config = $4, updated_at = CURRENT_TIMESTAMP`,
      [companyId, featureCode, is_enabled, config]
    );
    
    res.json({ message: 'Feature updated successfully' });
  }
);
```

---

## Admin Dashboard for BRIGHTSTEP

### Dashboard Features

**1. Company Management**
- List all companies (with search, filters, pagination)
- View company details (license, users, usage statistics)
- Create new company licenses
- Edit company settings
- Suspend/activate companies
- View company billing information

**2. License Management**
- Generate new licenses
- View all licenses and statuses
- Track license expirations
- Send renewal reminders
- Revoke licenses

**3. White-Label Configuration**
- Configure branding for each company
- Upload logos
- Set theme colors
- Configure custom domains

**4. Feature Toggle Management**
- Enable/disable features per company
- Configure feature-specific settings
- View feature usage statistics

**5. System Updates & Deployment**
- Schedule maintenance windows
- Trigger deployments
- View deployment history
- Rollback deployments

**6. System Monitoring**
- View number of companies using system
- Total user count across all companies
- System health metrics
- Error monitoring
- Performance metrics

**7. Usage Analytics**
- Company growth over time
- Feature adoption rates
- User activity metrics
- Revenue metrics (if billing integrated)

### Admin Dashboard API Endpoints

```javascript
// Company Management
GET    /admin/companies              // List all companies
GET    /admin/companies/:id          // Get company details
POST   /admin/companies              // Create new company
PUT    /admin/companies/:id          // Update company
DELETE /admin/companies/:id          // Delete company (soft delete)

// License Management
POST   /admin/licenses/generate      // Generate new license
GET    /admin/licenses               // List all licenses
GET    /admin/licenses/expiring      // Get expiring licenses
PUT    /admin/licenses/:id/renew     // Renew license

// White-Label Configuration
GET    /admin/companies/:id/settings // Get company settings
PUT    /admin/companies/:id/settings // Update company settings

// Feature Management
GET    /admin/companies/:id/features // Get company features
PUT    /admin/companies/:id/features // Update company features

// System Statistics
GET    /admin/stats/overview         // Overall statistics
GET    /admin/stats/companies        // Company statistics
GET    /admin/stats/users            // User statistics
GET    /admin/stats/usage            // Usage statistics

// Deployment Management
POST   /admin/maintenance/enable     // Enable maintenance mode
POST   /admin/maintenance/disable    // Disable maintenance mode
GET    /admin/maintenance/status     // Get maintenance status
POST   /admin/deploy                 // Trigger deployment
GET    /admin/deploy/history         // Get deployment history
```

### Admin Dashboard Frontend

**Key Components:**
- Company List View (table with filters)
- Company Detail View (tabs: Overview, License, Settings, Features, Users)
- License Generation Form
- White-Label Configuration UI
- Feature Toggle Management UI
- System Statistics Dashboard
- Deployment Management UI

---

## Additional SaaS Platform Features

### Features to Consider

**1. Usage Analytics Dashboard**
- Track feature usage per company
- Monitor user activity
- Performance metrics
- Error rates

**2. Billing Integration**
- Stripe/PayPal integration
- Automatic invoicing
- Subscription management
- Payment history

**3. Company Admin Portal**
- Each company has their own admin view
- Manage users (within their limit)
- Configure white-labeling (if allowed)
- View usage statistics
- Request support

**4. Support Ticketing System**
- In-app support tickets
- Priority based on tier
- Integration with helpdesk software

**5. API Access (for Enterprise)**
- RESTful API for integrations
- API keys per company
- Rate limiting per company
- Webhooks for events

**6. Audit Logging**
- Track all company activities
- Compliance reporting
- Security monitoring

**7. Data Export/Import**
- Export company data (for backup or migration)
- Import data from other systems
- Data migration tools

**8. Multi-Site Management (for Enterprise)**
- Companies can manage multiple solar plants
- Site-specific configurations
- Cross-site reporting

**9. Role Templates**
- Pre-configured role sets per tier
- Custom role creation (Enterprise)

**10. Integration Marketplace**
- Third-party integrations (optional)
- Webhook integrations
- Zapier/Make.com integrations

---

## Database Schema Design

### Core Multi-Tenant Schema

```sql
-- Companies (Tenants)
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_code VARCHAR(50) UNIQUE NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  license_tier VARCHAR(20) NOT NULL,  -- 'small', 'medium', 'large'
  max_users INTEGER NOT NULL,
  current_user_count INTEGER DEFAULT 0,
  license_key VARCHAR(255) UNIQUE NOT NULL,
  license_status VARCHAR(20) DEFAULT 'active',
  license_expires_at TIMESTAMP,
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  billing_email VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Company Settings (White-Label)
CREATE TABLE company_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  setting_key VARCHAR(100) NOT NULL,
  setting_value TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, setting_key)
);

-- Company Features
CREATE TABLE company_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  feature_code VARCHAR(100) NOT NULL,
  is_enabled BOOLEAN DEFAULT true,
  config JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, feature_code)
);

-- Users (add company_id)
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);

-- All existing tables need company_id
ALTER TABLE assets ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE checklist_templates ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
-- ... etc for all tables

-- Row-Level Security (PostgreSQL)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_company_isolation ON users
  USING (company_id = current_setting('app.current_company_id')::UUID);

-- Similar policies for all tables
```

### Migration Strategy

**Phase 1: Add Company Support**
1. Create `companies` table
2. Create default BRIGHTSTEP company (id: 00000000-0000-0000-0000-000000000000)
3. Add `company_id` to all tables
4. Migrate existing data to default company
5. Add company_id to user sessions

**Phase 2: Enable Row-Level Security**
1. Create RLS policies
2. Test data isolation
3. Enable RLS on all tables

**Phase 3: Add Customization**
1. Create `company_settings` table
2. Create `company_features` table
3. Add admin dashboard

---

## Implementation Phases

### Phase 1: Foundation (Weeks 1-2)
- [ ] Database schema for multi-tenancy
- [ ] Company management tables
- [ ] User-company association
- [ ] Basic license enforcement
- [ ] Row-level security policies

### Phase 2: Core Multi-Tenancy (Weeks 3-4)
- [ ] Tenant isolation in all API routes
- [ ] License tier system
- [ ] User limit enforcement
- [ ] Company selection in login/session

### Phase 3: White-Labeling (Week 5)
- [ ] Company settings table
- [ ] Theme API endpoints
- [ ] Frontend theme application
- [ ] Logo/color customization UI

### Phase 4: Feature Toggles (Week 6)
- [ ] Company features table
- [ ] Feature check middleware
- [ ] Frontend feature checks
- [ ] Admin feature management UI

### Phase 5: Admin Dashboard (Weeks 7-8)
- [ ] BRIGHTSTEP admin dashboard
- [ ] Company management UI
- [ ] License management UI
- [ ] White-label configuration UI
- [ ] Feature toggle UI
- [ ] System statistics dashboard

### Phase 6: Update System (Week 9)
- [ ] Maintenance mode system
- [ ] Scheduled deployment automation
- [ ] Blue-green deployment setup
- [ ] Maintenance window scheduler

### Phase 7: Advanced Features (Weeks 10-12)
- [ ] Usage analytics
- [ ] Billing integration (optional)
- [ ] API access (Enterprise)
- [ ] Audit logging
- [ ] Support system (optional)

---

## Security Considerations

### Multi-Tenant Security

1. **Data Isolation**
   - Row-Level Security (RLS) on all tables
   - Always filter by company_id in queries
   - Never expose company_id in client-side code

2. **Authentication & Authorization**
   - JWT tokens include company_id
   - Validate company_id on every request
   - Separate admin authentication for BRIGHTSTEP

3. **API Security**
   - Rate limiting per company
   - API keys for external access (Enterprise)
   - CORS configuration per company domain

4. **License Security**
   - Cryptographically signed license keys
   - License validation on every request (cached)
   - Automatic license expiry checks

---

## Scalability & Performance

### Performance Optimizations

1. **Database Indexing**
   - Index on `company_id` for all tables
   - Composite indexes for common queries
   - Partition large tables by company (future)

2. **Caching Strategy**
   - Cache company settings in Redis
   - Cache feature toggles in Redis
   - Cache license status (with TTL)

3. **Query Optimization**
   - Always include company_id in WHERE clauses
   - Use prepared statements
   - Batch queries when possible

4. **Load Balancing**
   - Horizontal scaling across servers
   - Session affinity (sticky sessions)
   - Database connection pooling

---

## Success Metrics

### Platform Metrics

- **Total Companies:** Number of active companies
- **Total Users:** Total users across all companies
- **License Utilization:** % of companies at user limit
- **Feature Adoption:** % of companies using each feature
- **Uptime:** System availability percentage
- **Deployment Success Rate:** % of successful deployments

### Business Metrics

- **Monthly Recurring Revenue (MRR)**
- **Customer Lifetime Value (CLV)**
- **Churn Rate:** % of companies that cancel
- **Net Promoter Score (NPS)**
- **Average Revenue Per User (ARPU)**

---

## Complete Cost Analysis - Multi-Tenant SaaS Platform

### Executive Cost Summary

**Recommended Setup: DigitalOcean (Best Balance)**
- **Monthly Cost:** $350-650/month
- **Annual Cost:** $4,200-7,800/year
- **90-Day Cost:** $1,050-1,950

**Budget Alternative: Hetzner Cloud**
- **Monthly Cost:** $200-400/month
- **Annual Cost:** $2,400-4,800/year
- **90-Day Cost:** $600-1,200

**Enterprise Option: AWS (Scalable)**
- **Monthly Cost:** $500-1,200/month
- **Annual Cost:** $6,000-14,400/year
- **90-Day Cost:** $1,500-3,600

---

### Detailed Cost Breakdown

#### 1. Infrastructure Costs (Core Platform)

##### Option A: DigitalOcean (Recommended - Best Quality/Price Balance)

| Service | Specification | Monthly Cost | Annual Cost | Notes |
|---------|---------------|--------------|-------------|-------|
| **Primary Server (Blue)** | 4 vCPU, 8GB RAM, 160GB SSD | $48 | $576 | Main application server |
| **Standby Server (Green)** | 4 vCPU, 8GB RAM, 160GB SSD | $48 | $576 | For blue-green deployments |
| **Managed PostgreSQL** | 4GB RAM, 100GB storage, HA | $120 | $1,440 | High availability database |
| **Managed Redis** | 2GB RAM | $30 | $360 | Session management & caching |
| **Spaces (Object Storage)** | 500GB storage, 5TB transfer | $25 | $300 | File uploads, logos, backups |
| **Load Balancer** | Standard | $12 | $144 | Traffic distribution |
| **Backup Storage** | 200GB automated backups | $20 | $240 | Database & file backups |
| **Bandwidth** | 5TB included | $0 | $0 | Included in plans |
| **SSL Certificate** | Let's Encrypt (free) | $0 | $0 | Free SSL |
| **Monitoring** | Basic monitoring (free) | $0 | $0 | Included |
| **SUBTOTAL** | | **$303** | **$3,636** | |

**Why DigitalOcean:**
- ✅ Excellent performance-to-cost ratio
- ✅ Predictable pricing (no surprises)
- ✅ Managed services (less maintenance)
- ✅ Great documentation and support
- ✅ Easy scaling
- ✅ Full control and Docker support

##### Option B: Hetzner Cloud (Budget Option - Best Price)

| Service | Specification | Monthly Cost | Annual Cost | Notes |
|---------|---------------|--------------|-------------|-------|
| **Primary Server** | 4 vCPU, 8GB RAM, 160GB SSD | €16.58 (~$18) | €199 (~$216) | Main server |
| **Standby Server** | 4 vCPU, 8GB RAM, 160GB SSD | €16.58 (~$18) | €199 (~$216) | Standby server |
| **Managed PostgreSQL** | 4GB RAM, 100GB storage | €36 (~$39) | €432 (~$468) | Database |
| **Managed Redis** | 2GB RAM | €10 (~$11) | €120 (~$130) | Cache |
| **Object Storage** | 500GB | €15 (~$16.50) | €180 (~$195) | File storage |
| **Load Balancer** | Basic | €5 (~$5.50) | €60 (~$65) | Traffic distribution |
| **Backup Storage** | 200GB | €4 (~$4.40) | €48 (~$52) | Backups |
| **Bandwidth** | 20TB included | €0 | €0 | Included |
| **SUBTOTAL** | | **€103.16 (~$113)** | **€1,238 (~$1,343)** | |

**Why Hetzner:**
- ✅ Best price-to-performance ratio
- ✅ EU-based (GDPR compliant)
- ✅ Excellent hardware
- ⚠️ Smaller ecosystem than DigitalOcean
- ⚠️ Less managed services

##### Option C: AWS (Enterprise - Maximum Scalability)

| Service | Specification | Monthly Cost | Annual Cost | Notes |
|---------|---------------|--------------|-------------|-------|
| **EC2 (Primary)** | t3.xlarge (4 vCPU, 16GB) | $150 | $1,800 | On-demand pricing |
| **EC2 (Standby)** | t3.xlarge (4 vCPU, 16GB) | $150 | $1,800 | Standby server |
| **RDS PostgreSQL** | db.t3.large (2 vCPU, 8GB, 100GB) | $150 | $1,800 | Managed database |
| **ElastiCache Redis** | cache.t3.medium (2GB) | $50 | $600 | Managed Redis |
| **S3 Storage** | 500GB standard | $12 | $144 | Object storage |
| **CloudFront CDN** | 1TB transfer | $85 | $1,020 | CDN for static assets |
| **Application Load Balancer** | Standard | $20 | $240 | Load balancing |
| **Backup Storage (S3)** | 200GB | $5 | $60 | Backups |
| **Data Transfer** | 5TB out | $0 | $0 | First 1GB free, then $0.09/GB |
| **SUBTOTAL** | | **$617** | **$7,404** | |

**Why AWS:**
- ✅ Maximum scalability
- ✅ Global infrastructure
- ✅ Enterprise-grade services
- ⚠️ More expensive
- ⚠️ Complex pricing
- ⚠️ Steeper learning curve

---

#### 2. Third-Party Services (Essential)

| Service | Provider | Monthly Cost | Annual Cost | Purpose |
|---------|----------|--------------|-------------|---------|
| **Domain Name** | Namecheap/Cloudflare | $1-2 | $12-24 | Primary domain (sphair.com) |
| **Email Service** | SendGrid (free tier) | $0-15 | $0-180 | Transactional emails (100/day free) |
| **Monitoring** | UptimeRobot (free) | $0 | $0 | Uptime monitoring (50 monitors free) |
| **Error Tracking** | Sentry (free tier) | $0-26 | $0-312 | Error tracking (5K events/month free) |
| **CDN** | Cloudflare (free tier) | $0-20 | $0-240 | CDN & DDoS protection (free tier available) |
| **Backup Service** | Backblaze B2 (optional) | $0-10 | $0-120 | Off-site backups (optional) |
| **Analytics** | Google Analytics (free) | $0 | $0 | Usage analytics |
| **SUBTOTAL** | | **$1-73** | **$12-876** | |

**Recommended Third-Party Stack:**

1. **Email: SendGrid** (Free tier: 100 emails/day)
   - Upgrade to Essentials ($15/month) for 50K emails/month
   - Best for transactional emails

2. **Monitoring: UptimeRobot** (Free tier)
   - 50 monitors free
   - Upgrade to Pro ($7/month) for more monitors

3. **Error Tracking: Sentry** (Free tier)
   - 5,000 events/month free
   - Upgrade to Team ($26/month) for 50K events/month

4. **CDN: Cloudflare** (Free tier)
   - Free CDN, DDoS protection, SSL
   - Upgrade to Pro ($20/month) for advanced features

---

#### 3. Development & DevOps Tools

| Service | Provider | Monthly Cost | Annual Cost | Purpose |
|---------|----------|--------------|-------------|---------|
| **GitHub** | GitHub (free/paid) | $0-4 | $0-48 | Code repository (free for public) |
| **CI/CD** | GitHub Actions (free) | $0 | $0 | Automated deployments (2K min/month free) |
| **Code Quality** | SonarCloud (free) | $0 | $0 | Code analysis (free for open source) |
| **Documentation** | Notion/Confluence | $0-8 | $0-96 | Documentation (free tier available) |
| **Project Management** | Jira/Linear | $0-10 | $0-120 | Project tracking (free tier available) |
| **SUBTOTAL** | | **$0-22** | **$0-264** | |

**Recommended:**
- **GitHub:** Free for public repos, $4/month for private (Team plan)
- **CI/CD:** GitHub Actions (free tier: 2,000 minutes/month)
- **Documentation:** Notion (free for personal use)

---

#### 4. Security & Compliance

| Service | Provider | Monthly Cost | Annual Cost | Purpose |
|---------|----------|--------------|-------------|---------|
| **SSL Certificate** | Let's Encrypt (free) | $0 | $0 | HTTPS (free) |
| **DDoS Protection** | Cloudflare (free) | $0 | $0 | DDoS protection (free tier) |
| **Security Scanning** | Snyk (free tier) | $0 | $0 | Dependency scanning (free tier) |
| **Vulnerability Scanning** | OWASP ZAP (free) | $0 | $0 | Security testing (open source) |
| **SUBTOTAL** | | **$0** | **$0** | |

**All security essentials available for free!**

---

#### 5. Support & Communication Tools

| Service | Provider | Monthly Cost | Annual Cost | Purpose |
|---------|----------|--------------|-------------|---------|
| **Support Ticketing** | Zendesk (free tier) | $0-55 | $0-660 | Customer support (free tier: 5 agents) |
| **Live Chat** | Tawk.to (free) | $0 | $0 | Live chat widget (free) |
| **Email Support** | Gmail/Outlook | $0-6 | $0-72 | Business email (Gmail: $6/user/month) |
| **Communication** | Slack/Discord | $0-8 | $0-96 | Team communication (free tier available) |
| **SUBTOTAL** | | **$0-69** | **$0-828** | |

**Recommended:**
- **Support:** Zendesk (free tier: 5 agents, unlimited tickets)
- **Live Chat:** Tawk.to (completely free)
- **Email:** Gmail Workspace ($6/user/month) or free Gmail

---

#### 6. Billing & Payment Processing (Optional)

| Service | Provider | Monthly Cost | Annual Cost | Purpose |
|---------|----------|--------------|-------------|---------|
| **Payment Processing** | Stripe | 2.9% + $0.30 | Variable | Credit card processing |
| **Invoicing** | Stripe Billing | $0 | $0 | Subscription management (free) |
| **Accounting** | QuickBooks/Xero | $0-30 | $0-360 | Accounting software (optional) |
| **SUBTOTAL** | | **Variable** | **Variable** | Based on revenue |

**Recommended: Stripe**
- No monthly fee
- 2.9% + $0.30 per transaction
- Built-in subscription management
- Best developer experience

---

### Total Cost Summary

#### Scenario 1: DigitalOcean (Recommended - Best Quality/Price)

| Category | Monthly | Annual | 90 Days |
|----------|---------|--------|---------|
| **Infrastructure** | $303 | $3,636 | $909 |
| **Third-Party Services** | $20 | $240 | $60 |
| **DevOps Tools** | $4 | $48 | $12 |
| **Support Tools** | $0 | $0 | $0 |
| **Security** | $0 | $0 | $0 |
| **TOTAL** | **$327** | **$3,924** | **$981** |

**With Scaling (50+ companies):**
- Infrastructure: $500-800/month
- Third-party: $50-100/month
- **Total: $550-900/month**

#### Scenario 2: Hetzner Cloud (Budget - Best Price)

| Category | Monthly | Annual | 90 Days |
|----------|---------|--------|---------|
| **Infrastructure** | $113 | $1,343 | $339 |
| **Third-Party Services** | $20 | $240 | $60 |
| **DevOps Tools** | $4 | $48 | $12 |
| **Support Tools** | $0 | $0 | $0 |
| **Security** | $0 | $0 | $0 |
| **TOTAL** | **$137** | **$1,631** | **$411** |

**With Scaling (50+ companies):**
- Infrastructure: $200-350/month
- Third-party: $50-100/month
- **Total: $250-450/month**

#### Scenario 3: AWS (Enterprise - Maximum Scalability)

| Category | Monthly | Annual | 90 Days |
|----------|---------|--------|---------|
| **Infrastructure** | $617 | $7,404 | $1,851 |
| **Third-Party Services** | $20 | $240 | $60 |
| **DevOps Tools** | $4 | $48 | $12 |
| **Support Tools** | $0 | $0 | $0 |
| **Security** | $0 | $0 | $0 |
| **TOTAL** | **$641** | **$7,692** | **$1,923** |

**With Scaling (50+ companies):**
- Infrastructure: $1,200-2,000/month
- Third-party: $50-100/month
- **Total: $1,250-2,100/month**

---

### Cost Breakdown by Company Count

#### Small Scale (1-10 companies)

**DigitalOcean:**
- Monthly: $327-400
- Annual: $3,924-4,800
- **90 Days: $981-1,200**

**Hetzner:**
- Monthly: $137-200
- Annual: $1,631-2,400
- **90 Days: $411-600**

#### Medium Scale (10-50 companies)

**DigitalOcean:**
- Monthly: $400-600
- Annual: $4,800-7,200
- **90 Days: $1,200-1,800**

**Hetzner:**
- Monthly: $200-350
- Annual: $2,400-4,200
- **90 Days: $600-1,050**

#### Large Scale (50+ companies)

**DigitalOcean:**
- Monthly: $600-1,000
- Annual: $7,200-12,000
- **90 Days: $1,800-3,000**

**Hetzner:**
- Monthly: $350-600
- Annual: $4,200-7,200
- **90 Days: $1,050-1,800**

---

### Recommended Stack (Best Quality/Price)

#### Infrastructure: **DigitalOcean**

**Why:**
- Best balance of performance, price, and ease of use
- Predictable costs (no surprises)
- Excellent managed services
- Great documentation
- Easy scaling

**Monthly Cost:** $303-500 (depending on scale)

#### Third-Party Services:

1. **Email:** SendGrid (Free tier → $15/month when needed)
2. **Monitoring:** UptimeRobot (Free tier)
3. **Error Tracking:** Sentry (Free tier → $26/month when needed)
4. **CDN:** Cloudflare (Free tier → $20/month Pro when needed)
5. **Domain:** Namecheap ($12/year)
6. **Support:** Zendesk (Free tier → $55/month when needed)

**Monthly Cost:** $0-20 (start free, scale as needed)

#### DevOps:

1. **GitHub:** Free (public) or $4/month (private)
2. **CI/CD:** GitHub Actions (Free tier)
3. **Documentation:** Notion (Free tier)

**Monthly Cost:** $0-4

#### **Total Recommended Monthly Cost:**

**Starting (1-10 companies):** $327-400/month  
**Growing (10-50 companies):** $400-600/month  
**Established (50+ companies):** $600-1,000/month

---

### Cost Optimization Strategies

1. **Start with Free Tiers**
   - Use free tiers for all third-party services initially
   - Upgrade only when you hit limits

2. **Right-Size Infrastructure**
   - Start with smaller instances
   - Scale up as you grow
   - Use auto-scaling when available

3. **Reserved Instances** (AWS)
   - Save 30-40% with 1-year commitments
   - Only if you're certain about usage

4. **Monitor Usage**
   - Set up billing alerts
   - Review costs monthly
   - Optimize unused resources

5. **Use CDN for Static Assets**
   - Reduces server load
   - Improves performance
   - Can reduce server costs

6. **Database Optimization**
   - Regular cleanup of old data
   - Archive old records
   - Optimize queries

---

### Hidden Costs to Consider

1. **Data Transfer Overages**
   - Most providers include generous bandwidth
   - Monitor usage to avoid surprises

2. **Backup Storage Growth**
   - Backups grow over time
   - Plan for 20-30% annual growth

3. **Support Costs**
   - Time spent on support
   - May need dedicated support person at scale

4. **Development Time**
   - Ongoing maintenance
   - Feature development
   - Bug fixes

5. **Compliance & Security**
   - Security audits
   - Compliance certifications (if needed)
   - Insurance (cyber liability)

---

### ROI Calculation Example

**Assumptions:**
- 20 companies using the platform
- Average subscription: $200/month per company
- Monthly Revenue: $4,000
- Monthly Costs: $500

**ROI:**
- **Monthly Profit:** $3,500
- **Annual Profit:** $42,000
- **ROI:** 700% (7x return)

**Break-even:** With 3 companies at $200/month each

---

### Cost Comparison Summary

| Platform | Monthly (Start) | Monthly (Scale) | Best For |
|----------|----------------|----------------|----------|
| **DigitalOcean** | $327 | $600-1,000 | Best overall (recommended) |
| **Hetzner** | $137 | $350-600 | Best price |
| **AWS** | $641 | $1,250-2,100 | Maximum scalability |

**Recommendation:** Start with **DigitalOcean** for best quality/price balance, or **Hetzner** if budget is primary concern.

---

## Conclusion

This architecture transforms SPHAiR into a **true SaaS platform** similar to Salesforce, HubSpot, or Monday.com, where:

1. **BRIGHTSTEP has full control** over updates and deployments via scheduled maintenance windows
2. **Multiple companies** can use the system with isolated data and custom branding
3. **License management** enforces user limits and feature access per tier
4. **White-labeling** allows each company to customize their experience
5. **Feature toggles** enable/disable features per company
6. **Admin dashboard** provides complete oversight and management

**Next Steps:**
1. Review and approve this architecture
2. Prioritize implementation phases
3. Begin Phase 1: Database schema for multi-tenancy
4. Set up development environment for multi-tenant testing

---

**Document Version:** 1.0  
**Last Updated:** January 2026  
**Status:** Strategic Architecture - Ready for Implementation Review
