# Company-Scoped Storage Architecture

## Overview

SPHAiRDigital implements **company-scoped file storage** using company names (slugs) to ensure complete data isolation between companies. Each company has its own folder structure with comprehensive subdirectories, preventing any possibility of data leakage or confusion.

## Folder Structure

```
uploads/
├── companies/
│   ├── smart-innovations-energy/
│   │   ├── templates/          # Template files (Excel, Word)
│   │   ├── images/              # Task/checklist images
│   │   ├── cm_letters/          # CM letter documents and reports
│   │   ├── inventory/           # Inventory lists and related files
│   │   ├── profiles/            # User profile images
│   │   ├── reports/             # Generated reports (Excel, PDF)
│   │   ├── exports/             # Exported data files
│   │   ├── logs/                # Application logs and audit trails
│   │   └── documents/           # Other documents
│   ├── acme-solar-solutions/
│   │   └── ... (same structure)
│   └── ...
├── profiles/                    # Legacy profile images (backward compatibility)
└── templates/                   # Legacy templates (backward compatibility)
```

**Key Feature**: Folders use **company slugs** (e.g., `smart-innovations-energy`) instead of UUIDs, making them human-readable and easy to manage.

## Benefits

1. **Complete Data Isolation**: Each company's files are physically separated
2. **Easy Backup**: Backup entire organization folder for company-specific backups
3. **Clear Organization**: Easy to identify which files belong to which company
4. **Scalability**: Can easily move organization folders to different storage systems
5. **Security**: Prevents accidental access to other companies' files
6. **Compliance**: Easier to meet data residency requirements

## Implementation Details

### File Path Format

**New Format (Company-Scoped by Slug):**
```
/uploads/companies/{company_slug}/{file_type}/{filename}
```

**Examples:**
- Template: `/uploads/companies/smart-innovations-energy/templates/1234567890-template.xlsx`
- Image: `/uploads/companies/smart-innovations-energy/images/1234567890-uuid-photo.jpg`
- CM Letter Report: `/uploads/companies/smart-innovations-energy/cm_letters/Fault_Log_20260126.xlsx`
- Profile: `/uploads/companies/smart-innovations-energy/profiles/profile-userId-1234567890-avatar.jpg`
- Report: `/uploads/companies/smart-innovations-energy/reports/Monthly_Report_2026-01.pdf`

**Legacy Format (Backward Compatibility):**
- `/uploads/{filename}` - Still supported for existing files
- `/uploads/profiles/{filename}` - Still supported for existing profile images
- `/uploads/organizations/{org_id}/{file_type}/{filename}` - Legacy organization ID format

### File Types

| File Type | Directory | Description |
|-----------|-----------|-------------|
| `templates` | `companies/{slug}/templates/` | Excel/Word template files |
| `images` | `companies/{slug}/images/` | Task images, checklist photos |
| `cm_letters` | `companies/{slug}/cm_letters/` | CM letter documents and Excel reports |
| `inventory` | `companies/{slug}/inventory/` | Inventory lists and related files |
| `profiles` | `companies/{slug}/profiles/` | User profile images |
| `reports` | `companies/{slug}/reports/` | Generated reports (Excel, PDF) |
| `exports` | `companies/{slug}/exports/` | Exported data files |
| `logs` | `companies/{slug}/logs/` | Application logs and audit trails |
| `documents` | `companies/{slug}/documents/` | Other documents |

## API Usage

### Uploading Files

All file uploads automatically use company-scoped storage. The company slug is determined from:

1. **Tenant Context** (set by `tenantContext` middleware - includes `organizationSlug`)
2. **Session** (for system owners who entered a company - `selectedOrganizationSlug`)
3. **User's organization_id** → fetched slug from database (for regular users)
4. **Task's organization_id** → fetched slug from database (fallback for images)

### Serving Files

Files are served via:
```
GET /uploads/companies/{company_slug}/{file_type}/{filename}
```

**Example URLs:**
- `/uploads/companies/smart-innovations-energy/images/photo.jpg`
- `/uploads/companies/smart-innovations-energy/reports/Fault_Log_2026-01.xlsx`
- `/uploads/companies/acme-solar-solutions/templates/template.xlsx`

The server automatically:
- Validates the file type
- Checks directory traversal security
- Serves with proper content-type headers
- Enforces CORS/CORP policies

## Migration

### Existing Files

Run the migration script to organize existing files:

```bash
node server/scripts/migrate-files-to-company-folders.js
```

This script:
1. Creates company directories for all active organizations using their slugs
2. Migrates existing files based on their `organization_id` → slug mapping
3. Updates database records with new file paths
4. Preserves old files (copies, doesn't move) for safety

**Example Output:**
```
✅ Created directories for: Smart Innovations Energy (smart-innovations-energy)
✅ Created directories for: Acme Solar Solutions (acme-solar-solutions)
```

### New Organizations

When a new organization is created:
1. Company directories are automatically created using the organization's slug
2. All file uploads use the new company-scoped paths
3. No migration needed for new organizations
4. Folder structure includes all 9 subdirectories (templates, images, cm_letters, inventory, profiles, reports, exports, logs, documents)

## Security Considerations

### Directory Traversal Protection

All file serving routes include security checks:
- Validates file path is within the organization directory
- Prevents accessing files from other organizations
- Blocks directory traversal attempts (`../`)

### Access Control

- Files are only accessible if the user has access to the organization
- RLS policies ensure users can only see their organization's data
- File paths in database are validated against organization_id

### File Validation

- File types are validated before upload
- File sizes are limited per file type
- Magic number detection prevents MIME type spoofing

## Database Schema

### Tables with File Paths

1. **`failed_item_images`**
   - `image_path`: Organization-scoped path
   - Linked to `tasks` via `task_id` (which has `organization_id`)

2. **`users`**
   - `profile_image`: Organization-scoped path
   - Linked to `organizations` via `organization_id`

3. **`checklist_templates`**
   - Template files are parsed and stored as JSONB
   - Original files can be stored in `templates/` directory

## Utilities

### `server/utils/organizationStorage.js`

Provides helper functions:
- `getOrganizationSlugFromRequest(req, pool)` - Get company slug from request (async)
- `getOrganizationSlugById(pool, orgId)` - Get slug from organization ID (async)
- `getStoragePath(slug, fileType, filename)` - Get storage path
- `getFileUrl(slug, fileType, filename)` - Get URL path
- `ensureCompanyDirs(slug)` - Create directory structure
- `migrateFilePath(oldPath, slug, fileType)` - Migrate file path
- `sanitizeSlug(slug)` - Sanitize slug for filesystem use
- `getCompanyDir(slug)` - Get company directory path

## Best Practices

1. **Always use organization-scoped paths** for new uploads
2. **Validate organization_id** before file operations
3. **Use the utility functions** instead of hardcoding paths
4. **Run migration script** after deploying to production
5. **Monitor file storage** per organization for quota management
6. **Backup organization folders** individually for easier restoration

## Troubleshooting

### Files Not Found

- Check if organization directories exist
- Verify file path format matches new structure
- Check database records have correct `organization_id`
- Ensure file was migrated (if it's an old file)

### Permission Errors

- Verify organization_id is set in request context
- Check user has access to the organization
- Ensure directory exists and has write permissions

### Migration Issues

- Run migration script with proper database credentials
- Check logs for specific file migration errors
- Verify old files exist before migration
- Test with a single organization first

## Future Enhancements

1. **Cloud Storage Integration**: Support S3/GCS per organization
2. **File Quotas**: Limit storage per organization
3. **File Versioning**: Track file versions per organization
4. **Automatic Cleanup**: Remove orphaned files
5. **Storage Analytics**: Track storage usage per organization
