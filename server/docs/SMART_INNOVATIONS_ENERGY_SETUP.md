# Smart Innovations Energy Organization Setup

## Overview

Smart Innovations Energy is the default organization for the SPHAiRDigital system. All existing templates, tasks, assets, and other data belong to this organization.

## Organization Details

- **ID**: `00000000-0000-0000-0000-000000000001` (Fixed UUID for consistency)
- **Name**: Smart Innovations Energy
- **Slug**: `smart-innovations-energy`
- **Status**: Active

## Migration Steps

To set up Smart Innovations Energy as the default organization:

1. **Create/Update Organization** (`multi_tenant_005_create_smart_innovations_energy_org.sql`)
   - Creates the organization if it doesn't exist
   - Updates existing organization to use fixed UUID and correct name/slug
   - Handles both "Smart Innovation Energy" (singular) and "Smart Innovations Energy" (plural)

2. **Add organization_id to Remaining Tables** (`multi_tenant_006_add_organization_id_to_remaining_tables.sql`)
   - Adds `organization_id` column to all tables that don't have it
   - Sets default value to Smart Innovations Energy ID
   - Creates indexes for performance

3. **Migrate Existing Data** (`multi_tenant_007_migrate_existing_data_to_smart_innovations_energy.sql`)
   - Assigns all existing data to Smart Innovations Energy
   - Ensures no NULL organization_id values remain
   - Updates users, assets, tasks, templates, etc.

## Verification

Run the verification script to check setup:

```bash
node server/scripts/verify-smart-innovations-energy-setup.js
```

This will verify:
- Organization exists with correct ID
- All data is assigned to Smart Innovations Energy
- Indexes are created
- No NULL organization_id values

## Current Status

Based on verification script:
- ✅ Organization exists: `00000000-0000-0000-0000-000000000001`
- ✅ Users: All assigned
- ✅ Assets: All assigned
- ✅ Tasks: All assigned
- ⚠️ Checklist Templates: 13/14 assigned (1 NULL - likely a system template)
- ✅ Inventory Items: All assigned
- ✅ Calendar Events: All assigned

## Notes

- System templates (with `is_system_template = true`) may have `organization_id = NULL` - this is intentional
- The `creator` user (system_owner) has `organization_id = NULL` - this is intentional
- All other data should have `organization_id = '00000000-0000-0000-0000-000000000001'`

## Next Steps

After running migrations:
1. Verify all data is assigned correctly
2. Test RLS policies work (users only see Smart Innovations Energy data)
3. Test system_owner can see all data
4. Proceed with multi-tenant route migration
