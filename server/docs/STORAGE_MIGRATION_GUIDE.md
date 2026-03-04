# Storage Migration Guide: Company Name-Based Folders

## Overview

SPHAiRDigital has been updated to use **company name-based folders** (slugs) instead of organization UUIDs. This makes folder management easier, more secure, and better organized.

## What Changed

### Before (Organization ID-based)
```
uploads/organizations/{uuid}/templates/
uploads/organizations/{uuid}/images/
```

### After (Company Slug-based)
```
uploads/companies/smart-innovations-energy/templates/
uploads/companies/smart-innovations-energy/images/
uploads/companies/smart-innovations-energy/cm_letters/
uploads/companies/smart-innovations-energy/inventory/
uploads/companies/smart-innovations-energy/profiles/
uploads/companies/smart-innovations-energy/reports/
uploads/companies/smart-innovations-energy/exports/
uploads/companies/smart-innovations-energy/logs/
uploads/companies/smart-innovations-energy/documents/
```

## Complete Folder Structure

Each company now has **9 subdirectories**:

1. **`templates/`** - Template files (Excel, Word)
2. **`images/`** - Task/checklist images
3. **`cm_letters/`** - CM letter documents and Excel reports
4. **`inventory/`** - Inventory lists and related files
5. **`profiles/`** - User profile images
6. **`reports/`** - Generated reports (Excel, PDF)
7. **`exports/`** - Exported data files
8. **`logs/`** - Application logs and audit trails
9. **`documents/`** - Other documents

## Migration Steps

### Step 1: Run Migration Script

```bash
cd server/scripts
node migrate-files-to-company-folders.js
```

This script will:
- Create company folders for all active organizations
- Migrate existing files to company-scoped folders
- Update database records with new file paths
- Preserve old files (copies, doesn't move)

### Step 2: Verify Migration

Check that folders were created:
```bash
ls -la server/uploads/companies/
```

You should see folders like:
- `smart-innovations-energy/`
- `acme-solar-solutions/`
- `green-energy-corp/`
- `solartech-industries/`

### Step 3: Test File Uploads

1. Upload a template file → should go to `companies/{slug}/templates/`
2. Upload an image → should go to `companies/{slug}/images/`
3. Upload a profile image → should go to `companies/{slug}/profiles/`
4. Generate a CM report → should save to `companies/{slug}/reports/`

### Step 4: Verify File Serving

Test accessing files via URL:
- `/uploads/companies/smart-innovations-energy/images/photo.jpg`
- `/uploads/companies/smart-innovations-energy/reports/Fault_Log.xlsx`

## Updated Components

### Backend Routes Updated

1. **`server/routes/checklistTemplates.js`**
   - Templates stored in `companies/{slug}/templates/`

2. **`server/routes/upload.js`**
   - Images stored in `companies/{slug}/images/`

3. **`server/routes/users.js`**
   - Profile images stored in `companies/{slug}/profiles/`

4. **`server/routes/cmLetters.js`**
   - Reports saved to `companies/{slug}/reports/`

5. **`server/routes/inventory.js`**
   - Exports saved to `companies/{slug}/exports/`

6. **`server/routes/organizations.js`**
   - Creates company folders on organization creation

### Middleware Updated

- **`server/middleware/tenantContext.js`**
  - Now includes `organizationSlug` in tenant context
  - Fetches slug from database when needed

### Utilities Updated

- **`server/utils/organizationStorage.js`**
  - All functions now use company slugs
  - Legacy functions maintained for backward compatibility

### File Serving Updated

- **`server/index.js`**
  - New route: `/uploads/companies/{slug}/{file_type}/{filename}`
  - Legacy routes maintained for backward compatibility

## Benefits

1. **Human-Readable Folders**: Easy to identify which folder belongs to which company
2. **Complete Organization**: All file types organized in dedicated subdirectories
3. **Easy Management**: System administrators can quickly navigate and manage files
4. **Secure Isolation**: Each company's files are completely separated
5. **Scalable**: Easy to backup, migrate, or archive entire company folders
6. **Professional**: Clean folder structure suitable for enterprise use

## Security Features

- **Slug Sanitization**: Company slugs are sanitized before use
- **Directory Traversal Protection**: All file paths are validated
- **Access Control**: Files only accessible to users with organization access
- **RLS Policies**: Database-level filtering ensures data isolation

## Troubleshooting

### Files Not Found After Migration

1. Check if migration script ran successfully
2. Verify file paths in database were updated
3. Check if files exist in old locations
4. Verify organization slug matches database

### Folder Not Created

1. Check organization slug is valid
2. Verify write permissions on `uploads/` directory
3. Check logs for errors
4. Ensure organization is active

### Permission Errors

1. Check directory permissions
2. Verify organization context is set correctly
3. Ensure user has access to the organization
4. Check database connection

## Next Steps

After migration:
1. ✅ Verify all folders were created
2. ✅ Test file uploads work correctly
3. ✅ Test file serving works correctly
4. ✅ Review and delete old files (if desired)
5. ✅ Update any external scripts that reference old paths

## Support

For issues or questions:
- Check `server/docs/COMPANY_FOLDER_STRUCTURE.md` for detailed documentation
- Check `server/docs/ORGANIZATION_STORAGE_ARCHITECTURE.md` for architecture details
- Review migration script logs for specific errors
