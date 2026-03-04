# Company Folder Structure

## Overview

SPHAiRDigital uses **company name-based folders** (slugs) instead of organization IDs for better organization and management. Each company has a complete folder structure with all necessary subdirectories.

## Folder Structure

```
uploads/
└── companies/
    ├── smart-innovations-energy/          # Company folder (uses slug, not UUID)
    │   ├── templates/                    # Template files (Excel, Word)
    │   ├── images/                        # Task/checklist images
    │   ├── cm_letters/                    # CM letter documents and Excel reports
    │   ├── inventory/                     # Inventory lists and related files
    │   ├── profiles/                      # User profile images
    │   ├── reports/                       # Generated reports (Excel, PDF)
    │   ├── exports/                      # Exported data files
    │   ├── logs/                          # Application logs and audit trails
    │   └── documents/                     # Other documents
    │
    ├── acme-solar-solutions/              # Another company
    │   └── ... (same structure)
    │
    └── green-energy-corp/                 # Another company
        └── ... (same structure)
```

## Benefits of Using Company Names (Slugs)

1. **Human-Readable**: Easy to identify which folder belongs to which company
2. **Easy Management**: System administrators can quickly navigate folders
3. **Better Organization**: Clear folder names instead of UUIDs
4. **Secure**: Each company's files are completely isolated
5. **Scalable**: Easy to backup, migrate, or archive entire company folders

## Folder Descriptions

### `templates/`
- **Purpose**: Store uploaded template files (Excel, Word)
- **Files**: Template files uploaded via the UI
- **Example**: `PM-013-Template.xlsx`, `Weather_Station_Checklist.docx`

### `images/`
- **Purpose**: Store task and checklist images
- **Files**: Photos uploaded for failed checklist items, task documentation
- **Example**: `1234567890-uuid-photo.jpg`, `task-evidence.png`

### `cm_letters/`
- **Purpose**: Store CM letter documents and generated reports
- **Files**: Fault Log Excel reports, CM letter PDFs
- **Example**: `Fault_Log_2026-01.xlsx`, `CM-LTR-12345.pdf`

### `inventory/`
- **Purpose**: Store inventory-related files
- **Files**: Inventory lists, stock reports, import/export files
- **Example**: `Inventory_Count_2026-01.xlsx`, `Stock_Report.pdf`

### `profiles/`
- **Purpose**: Store user profile images
- **Files**: User avatars and profile pictures
- **Example**: `profile-userId-1234567890-avatar.jpg`

### `reports/`
- **Purpose**: Store generated reports
- **Files**: Monthly reports, analytics reports, custom reports
- **Example**: `Monthly_Report_2026-01.pdf`, `Analytics_Dashboard.xlsx`

### `exports/`
- **Purpose**: Store exported data files
- **Files**: Data exports, backup files, CSV exports
- **Example**: `Data_Export_2026-01-26.csv`, `Backup_2026-01-26.json`

### `logs/`
- **Purpose**: Store application logs and audit trails
- **Files**: Activity logs, audit logs, error logs
- **Example**: `activity_2026-01.log`, `audit_trail.json`

### `documents/`
- **Purpose**: Store other miscellaneous documents
- **Files**: Contracts, certificates, manuals, etc.
- **Example**: `Contract_2026.pdf`, `Certificate.pdf`

## File Path Format

**URL Format:**
```
/uploads/companies/{company_slug}/{file_type}/{filename}
```

**Examples:**
- `/uploads/companies/smart-innovations-energy/images/photo.jpg`
- `/uploads/companies/smart-innovations-energy/reports/Fault_Log_2026-01.xlsx`
- `/uploads/companies/acme-solar-solutions/templates/template.xlsx`

## Automatic Directory Creation

When a new organization is created:
1. Company folder is automatically created using the organization's slug
2. All 9 subdirectories are created automatically
3. Ready for immediate use

**Example:**
- Organization: "Smart Innovations Energy" (slug: `smart-innovations-energy`)
- Folder created: `uploads/companies/smart-innovations-energy/`
- All subdirectories created automatically

## Migration

Existing files are migrated from old paths to new company-scoped paths:

**Old Path:** `/uploads/filename.jpg`
**New Path:** `/uploads/companies/smart-innovations-energy/images/filename.jpg`

The migration script:
1. Reads organization_id from database records
2. Fetches the organization slug
3. Creates company folder structure
4. Copies files to new locations
5. Updates database records with new paths

## Security

- **Directory Traversal Protection**: All file paths are validated
- **Slug Sanitization**: Company slugs are sanitized before use
- **Access Control**: Files are only accessible to users with organization access
- **RLS Policies**: Database-level filtering ensures data isolation

## Best Practices

1. **Always use company slugs** for folder names (never UUIDs)
2. **Use the utility functions** from `organizationStorage.js`
3. **Validate file types** before storing
4. **Organize files** by type in appropriate subdirectories
5. **Backup company folders** individually for easier restoration
6. **Monitor storage** per company for quota management

## Troubleshooting

### Folder Not Created
- Check organization slug is valid
- Verify write permissions on `uploads/` directory
- Check logs for errors

### Files Not Found
- Verify file path uses company slug (not UUID)
- Check file was migrated (if it's an old file)
- Verify organization slug matches database

### Permission Errors
- Check directory permissions
- Verify organization context is set correctly
- Ensure user has access to the organization
