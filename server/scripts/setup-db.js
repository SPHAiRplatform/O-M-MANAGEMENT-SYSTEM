require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: 'postgres', // Connect to default postgres DB first
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function setupDatabase() {
  try {
    console.log('Setting up database...');

    // Create database if it doesn't exist
    const dbName = process.env.DB_NAME || 'solar_om_db';
    const checkDbQuery = `SELECT 1 FROM pg_database WHERE datname = $1`;
    const dbExists = await pool.query(checkDbQuery, [dbName]);

    if (dbExists.rows.length === 0) {
      // Note: CREATE DATABASE cannot be executed in a transaction
      // and cannot use parameterized queries, so we use template literal
      // This is safe here as dbName comes from environment variable
      await pool.query(`CREATE DATABASE "${dbName}"`);
      console.log(`Database '${dbName}' created successfully`);
    } else {
      console.log(`Database '${dbName}' already exists`);
    }

    // Close connection to postgres DB
    await pool.end();

    // Connect to the new database
    const appPool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: dbName,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    });

    // Read and execute schema
    const schemaPath = path.join(__dirname, '../db/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await appPool.query(schema);
    console.log('Schema created successfully');

    // Run Multi-Tenant migrations FIRST (required for multi-tenancy)
    const multiTenantMigrations = [
      'multi_tenant_001_create_organizations.sql',
      'multi_tenant_002_create_tenant_configuration_tables.sql',
      'multi_tenant_003_update_checklist_templates.sql',
      'multi_tenant_005_create_smart_innovations_energy_org.sql',
      'multi_tenant_006_add_organization_id_to_remaining_tables.sql',
      'add_organization_id_to_feedback_and_drafts.sql'
    ];
    
    console.log('Running Multi-Tenant migrations...');
    for (const migrationFile of multiTenantMigrations) {
      const migrationPath = path.join(__dirname, '../db/migrations', migrationFile);
      if (fs.existsSync(migrationPath)) {
        const migration = fs.readFileSync(migrationPath, 'utf8');
        await appPool.query(migration);
        console.log(`Multi-Tenant Migration ${migrationFile} applied successfully`);
      } else {
        console.log(`Warning: Multi-Tenant migration ${migrationFile} not found`);
      }
    }

    // Ensure users and assets tables have organization_id (if not added by migrations)
    // This is a safety check since some migrations assume these columns exist
    await appPool.query(`
      DO $$
      DECLARE
        default_org_id UUID;
      BEGIN
        -- Get the default organization ID (Smart Innovations Energy)
        SELECT id INTO default_org_id FROM organizations 
        WHERE slug = 'smart-innovations-energy' 
        LIMIT 1;

        -- Add organization_id to users if it doesn't exist
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'organization_id'
        ) THEN
          ALTER TABLE users 
            ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
          CREATE INDEX IF NOT EXISTS idx_users_organization_id ON users(organization_id);
          RAISE NOTICE 'Added organization_id to users table';
        END IF;

        -- Add organization_id to assets if it doesn't exist
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'assets' AND column_name = 'organization_id'
        ) THEN
          ALTER TABLE assets 
            ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
          -- Update existing assets to use default organization
          IF default_org_id IS NOT NULL THEN
            UPDATE assets SET organization_id = default_org_id WHERE organization_id IS NULL;
          END IF;
          CREATE INDEX IF NOT EXISTS idx_assets_organization_id ON assets(organization_id);
          RAISE NOTICE 'Added organization_id to assets table';
        END IF;
      END $$;
    `);

    // Run other migrations (order matters — dependencies noted in comments)
    const migrations = [
      // Platform tables
      'create_platform_migrations_table.sql',
      'create_platform_updates_table.sql',
      'create_platform_settings_table.sql',
      // Task/checklist enhancements
      'add_pm_performed_by_to_cm_tasks.sql',
      'add_task_metadata.sql',
      'add_draft_responses.sql',
      'add_draft_images.sql',
      'add_draft_spares_used.sql',
      'add_location_to_tasks.sql',
      'add_unplanned_cm_fields.sql',
      'allow_duplicate_pm_codes.sql',
      'update_cm_task_types_to_short_names.sql',
      // User auth & roles
      'add_password_to_users.sql',
      'add_profile_image_to_users.sql',
      'add_password_changed_column.sql',
      'add_multiple_roles_support.sql',        // Adds roles JSONB column
      'add_role_system_and_spare_requests.sql', // Adds super_admin role support + spare requests
      'fix_user_roles_migration.sql',           // Fixes roles column from role column
      'add_password_reset_columns.sql',
      // RBAC system (depends on roles support)
      'create_rbac_system.sql',
      // API & integrations
      'add_api_tokens_and_webhooks.sql',
      // Features
      'add_inventory.sql',
      'add_feedback_table.sql',
      'create_calendar_events_table.sql',
      'create_licenses_table.sql',
      'add_multi_tenant_license_fields.sql',
      'drop_licenses_table.sql',               // Removes licenses (replaced by tenant config)
      'add_task_pause_resume.sql',
      'add_overtime_requests.sql',
      'add_spares_used_to_tasks_and_responses.sql',
      'add_fault_log_fields_to_cm_letters.sql',
      'add_hours_tracking_and_notifications.sql', // Adds assigned_at to tasks + notifications table
      'add_multiple_task_assignments.sql',         // Depends on assigned_at from above
      'add_notification_idempotency_key.sql',
      'add_notifications_unique_constraint.sql',
      // Audit log
      'create_audit_log.sql',
      'audit_log_org_created_index.sql',
      // Plant map & SCADA
      'create_plant_map_structure.sql',
      'create_scada_tables.sql',
      // Tracker system
      'create_tracker_cycles.sql',
      'create_tracker_status_requests.sql',
      'wipe_tracker_status_requests.sql',
      // Multi-tenant phase 2: RLS policies & data migration
      'multi_tenant_004_implement_rls_policies.sql',
      'multi_tenant_007_migrate_existing_data_to_smart_innovations_energy.sql',
      'multi_tenant_008_add_default_configurations.sql',
      'multi_tenant_009_update_other_orgs_colors.sql',
      'multi_tenant_010_update_display_names_to_om_format.sql',
      // Organization ID consistency (depends on tables above existing)
      'add_organization_id_to_tracker_cycles.sql',
      'allow_null_organization_id_for_system_users.sql',
      'allow_null_organization_id_in_notifications.sql',
      'allow_null_organization_id_in_plant_map_structure.sql',
      'standardize_organization_id_null_handling.sql',
      'assign_existing_users_to_organizations.sql',
      // Branding
      'add_site_map_name_to_organization_branding.sql',
      // Performance optimizations (must run after RLS policies)
      'optimize_rls_policies.sql',
      'add_performance_indexes.sql',
    ];
    
    for (const migrationFile of migrations) {
      const migrationPath = path.join(__dirname, '../db/migrations', migrationFile);
      if (fs.existsSync(migrationPath)) {
        const migration = fs.readFileSync(migrationPath, 'utf8');
        await appPool.query(migration);
        console.log(`Migration ${migrationFile} applied successfully`);
      }
    }

    // Seed initial data (will use default organization created by multi_tenant_005)
    await seedInitialData(appPool);
    console.log('Initial data seeded successfully');

    await appPool.end();
    console.log('Database setup completed!');
  } catch (error) {
    console.error('Error setting up database:', error);
    process.exit(1);
  }
}

async function seedInitialData(pool) {
  const bcrypt = require('bcrypt');
  const saltRounds = 10;

  // Get default organization ID (created by multi_tenant_005 migration)
  const defaultOrgResult = await pool.query(`
    SELECT id FROM organizations WHERE slug = 'smart-innovations-energy' LIMIT 1
  `);
  
  if (defaultOrgResult.rows.length === 0) {
    throw new Error('Default organization not found. Please run Multi-Tenant migrations first.');
  }
  
  const defaultOrgId = defaultOrgResult.rows[0].id;
  console.log(`Using default organization: ${defaultOrgId}`);

  // Create default admin user with password (assigned to default organization)
  const defaultAdminPw = process.env.DEFAULT_ADMIN_PASSWORD || process.env.DEFAULT_USER_PASSWORD || 'changeme';
  const adminPassword = await bcrypt.hash(defaultAdminPw, saltRounds);
  const adminUser = await pool.query(`
    INSERT INTO users (username, email, full_name, role, password_hash, is_active, organization_id)
    VALUES ('admin', 'admin@solarom.com', 'System Administrator', 'admin', $1, true, $2)
    ON CONFLICT (username) DO UPDATE SET password_hash = $1, is_active = true, organization_id = $2
    RETURNING id
  `, [adminPassword, defaultOrgId]);

  // Create default technician user with password (assigned to default organization)
  const defaultTechPw = process.env.DEFAULT_TECH_PASSWORD || process.env.DEFAULT_USER_PASSWORD || 'changeme';
  const techPassword = await bcrypt.hash(defaultTechPw, saltRounds);
  const techUser = await pool.query(`
    INSERT INTO users (username, email, full_name, role, password_hash, is_active, organization_id)
    VALUES ('tech1', 'tech1@solarom.com', 'John Technician', 'technician', $1, true, $2)
    ON CONFLICT (username) DO UPDATE SET password_hash = $1, is_active = true, organization_id = $2
    RETURNING id
  `, [techPassword, defaultOrgId]);

  console.log('Default users created:');
  console.log(`  Admin: username=admin, password=${defaultAdminPw === 'changeme' ? 'changeme (set DEFAULT_ADMIN_PASSWORD env var)' : '***'}`);
  console.log(`  Technician: username=tech1, password=${defaultTechPw === 'changeme' ? 'changeme (set DEFAULT_TECH_PASSWORD env var)' : '***'}`);

  // Create sample Weather Station asset (assigned to default organization)
  const weatherStation = await pool.query(`
    INSERT INTO assets (asset_code, asset_name, asset_type, location, status, organization_id)
    VALUES ('WS-001', 'Weather Station 1', 'weather_station', 'Main Plant Area', 'active', $1)
    ON CONFLICT (asset_code) DO NOTHING
    RETURNING id
  `, [defaultOrgId]);

  // Create sample Energy Meter asset (for PM-14 checklist) (assigned to default organization)
  await pool.query(`
    INSERT INTO assets (asset_code, asset_name, asset_type, location, status, organization_id)
    VALUES ('EM-001', 'CT Building Energy Meter 1', 'energy_meter', 'CT Building', 'active', $1)
    ON CONFLICT (asset_code) DO NOTHING
  `, [defaultOrgId]);

  // Create Weather Station checklist template based on PM 013 procedure
  // This matches the actual checklist structure from Checksheets/WEATHER STATION.docx
  const weatherStationChecklist = {
    metadata: {
      procedure: 'PM 013',
      plant: 'WITKOP SOLAR PLANT',
      requires_team: true,
      requires_date: true,
      requires_time: true,
      requires_location: true
    },
    sections: [
      {
        id: 'section_1',
        title: 'PYRANOMETER INSPECTION IN POA (PLANE OF ARRAY)',
        items: [
          {
            id: 'item_1_1',
            type: 'pass_fail',
            label: 'Check that the pyranometer is clamped on its base',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_1_2',
            type: 'pass_fail',
            label: 'Check for damage, corrosion, encapsulation, decolouration, broken glass',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_1_3',
            type: 'pass_fail',
            label: 'Check the system if it\'s under shading – Any shading in the system',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_1_4',
            type: 'pass_fail',
            label: 'Check that the connections are not poor or if a damaged cable is found',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_1_5',
            type: 'pass_fail',
            label: 'With a fibre cloth and demineralised water, clean the glass and dry without leaving dirt',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_1_6',
            type: 'pass_fail',
            label: 'Check the connections are completely dry and well secured',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_1_7',
            type: 'pass_fail_with_measurement',
            label: 'Check good measure of equipment before and after inspection confirming SCADA values (w/m2)',
            required: true,
            has_observations: true,
            measurement_fields: [
              { id: 'before', label: 'Before (w/m2)', type: 'number', required: true },
              { id: 'after', label: 'After (w/m2)', type: 'number', required: true }
            ],
            validation: { pass: 'pass', fail: 'fail' }
          }
        ]
      },
      {
        id: 'section_2',
        title: 'CELL REFERENCE INSPECTION IN POA',
        items: [
          {
            id: 'item_2_1',
            type: 'pass_fail',
            label: 'Check that the cell is clamped on its base',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_2_2',
            type: 'pass_fail',
            label: 'Check for damage, corrosion, encapsulation, decolouration, broken glass',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_2_3',
            type: 'pass_fail',
            label: 'Check the system if it\'s under shading – Any shading in the system',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_2_4',
            type: 'pass_fail',
            label: 'Check that the connections are not poor or if a damaged cable is found',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_2_5',
            type: 'pass_fail',
            label: 'With a fibre cloth and demineralised water, clean the glass and dry without leaving dirt',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_2_6',
            type: 'pass_fail',
            label: 'Check the connections are completely dry and well secured',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_2_7',
            type: 'pass_fail_with_measurement',
            label: 'Check good measure of equipment before and after inspection confirming SCADA values (w/m2)',
            required: true,
            has_observations: true,
            measurement_fields: [
              { id: 'before', label: 'Before (w/m2)', type: 'number', required: true },
              { id: 'after', label: 'After (w/m2)', type: 'number', required: true }
            ],
            validation: { pass: 'pass', fail: 'fail' }
          }
        ]
      },
      {
        id: 'section_3',
        title: 'PYRANOMETER INSPECTION IN HORIZONTAL PLANE',
        items: [
          {
            id: 'item_3_1',
            type: 'pass_fail',
            label: 'Check that the pyranometer is clamped on its base',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_3_2',
            type: 'pass_fail',
            label: 'Check for damage, corrosion, encapsulation, decolouration, broken glass',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_3_3',
            type: 'pass_fail',
            label: 'Check the system if it\'s under shading – Any shading in the system',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_3_4',
            type: 'pass_fail',
            label: 'Check that the connections are not poor or if a damaged cable is found',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_3_5',
            type: 'pass_fail',
            label: 'With a fibre cloth and demineralised water, clean the glass and dry without leaving dirt',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_3_6',
            type: 'pass_fail',
            label: 'Check the connections are completely dry and well secured',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_3_7',
            type: 'pass_fail',
            label: 'Check the correct alignment of the level bubble',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_3_8',
            type: 'pass_fail_with_measurement',
            label: 'Check good measure of equipment before and after inspection confirming SCADA values (w/m2)',
            required: true,
            has_observations: true,
            measurement_fields: [
              { id: 'before', label: 'Before (w/m2)', type: 'number', required: true },
              { id: 'after', label: 'After (w/m2)', type: 'number', required: true }
            ],
            validation: { pass: 'pass', fail: 'fail' }
          }
        ]
      },
      {
        id: 'section_4',
        title: 'GENERAL INSPECTION OF STRUCTURE AND DEVICES',
        items: [
          {
            id: 'item_4_1',
            type: 'pass_fail_with_measurement',
            label: 'Check the external status of Temperature sensor and check the SCADA values (°C) with operator',
            required: true,
            has_observations: true,
            measurement_fields: [
              { id: 'scada_value', label: 'SCADA Value (°C)', type: 'number', required: true }
            ],
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_4_2',
            type: 'pass_fail_with_measurement',
            label: 'Check the external status of Wind sensor and check the SCADA values (m/s) with operator',
            required: true,
            has_observations: true,
            measurement_fields: [
              { id: 'scada_value', label: 'SCADA Value (m/s)', type: 'number', required: true }
            ],
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_4_3',
            type: 'pass_fail',
            label: 'Check the status of LANTRONIX, LEDs on OK and equipment communicating',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_4_4',
            type: 'pass_fail',
            label: 'With a fibre cloth and demineralised water, clean the backup panel and dry without leaving dirt',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_4_5',
            type: 'pass_fail',
            label: 'Check the external status from the battery backup of the system',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_4_6',
            type: 'pass_fail',
            label: 'Check the tightness of the control cabinet',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_4_7',
            type: 'pass_fail',
            label: 'Verify that the structure is in good condition (free of corrosion, correct fastening)',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_4_8',
            type: 'pass_fail',
            label: 'Rain gauge secured and clean',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_4_9',
            type: 'pass_fail',
            label: 'Verify that earth wire and spike in good condition (free of corrosion, correct fastening)',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          }
        ]
      },
      {
        id: 'section_5',
        title: 'OBSERVATIONS',
        items: [
          {
            id: 'item_observations',
            type: 'textarea',
            label: 'General observations and notes',
            required: false,
            placeholder: 'Enter any additional observations, issues, or notes here...'
          }
        ]
      }
    ],
    footer: {
      requires_inspector: true,
      requires_approver: true,
      requires_inspection_complete: true
    }
  };

  const validationRules = {
    overall_pass_condition: 'all_required_pass',
    fail_triggers: [
      { condition: 'any_item_fails', action: 'generate_cm' }
    ]
  };

  const cmGenerationRules = {
    auto_generate: true,
    priority_mapping: {
      'critical_sensor_failure': 'high',
      'data_logger_failure': 'high',
      'sensor_abnormal': 'medium',
      'calibration_required': 'low'
    },
    default_priority: 'medium'
  };

  await pool.query(`
    INSERT INTO checklist_templates (
      template_code, 
      template_name, 
      description, 
      asset_type, 
      task_type, 
      frequency,
      checklist_structure, 
      validation_rules, 
      cm_generation_rules,
      organization_id
    )
    VALUES (
      'WS-PM-013',
      'Weather Station Preventive Maintenance - PM 013',
      'Weather Station Preventive Maintenance Procedure PM 013 for WITKOP SOLAR PLANT. Includes Pyranometer Inspection (POA and Horizontal), Cell Reference Inspection, and General Structure Inspection.',
      'weather_station',
      'PM',
      'monthly',
      $1::jsonb,
      $2::jsonb,
      $3::jsonb,
      $4
    )
    ON CONFLICT (template_code) DO UPDATE SET
      checklist_structure = EXCLUDED.checklist_structure,
      validation_rules = EXCLUDED.validation_rules,
      cm_generation_rules = EXCLUDED.cm_generation_rules,
      organization_id = EXCLUDED.organization_id
  `, [
    JSON.stringify(weatherStationChecklist),
    JSON.stringify(validationRules),
    JSON.stringify(cmGenerationRules),
    defaultOrgId
  ]);

  console.log('Weather Station checklist template created');

  // ------------------------------------------------------------
  // Energy Meter Checklist Template (from Checksheets/excel/Energy Meter_Checklist.xlsx)
  // Procedure: PM-14
  // ------------------------------------------------------------
  const energyMeterChecklist = {
    metadata: {
      procedure: 'PM-14',
      plant: 'WITKOP SOLAR PLANT',
      title: 'Inspection for CT Building Energy Meter',
      requires_team: true,
      requires_date: true,
      requires_time: true,
      requires_location: true
    },
    sections: [
      {
        id: 'section_1',
        title: 'CT Building Energy meter Inspection',
        items: [
          {
            id: 'item_1_1',
            type: 'pass_fail',
            label: 'Check the condition of the connection',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_1_2',
            type: 'pass_fail',
            label: 'Check if is reading/recording',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_1_3',
            type: 'pass_fail',
            label: 'Check for errors on the screen',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_1_4',
            type: 'pass_fail',
            label: 'Check communication with SCADA',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_1_5',
            type: 'pass_fail',
            label: 'Check if closed and covered',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          },
          {
            id: 'item_1_6',
            type: 'pass_fail',
            label: 'Check the grounding',
            required: true,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          }
        ]
      },
      {
        id: 'section_2',
        title: 'Exterior cleaning of equipment and components',
        items: [
          {
            id: 'item_2_1',
            type: 'pass_fail',
            label: 'Exterior cleaning of equipment and components',
            required: false,
            has_observations: true,
            validation: { pass: 'pass', fail: 'fail' }
          }
        ]
      },
      {
        id: 'section_observations',
        title: 'OBSERVATIONS',
        items: [
          {
            id: 'item_final_observations',
            type: 'textarea',
            label: 'General observations and notes',
            required: false,
            placeholder: 'Enter any additional observations, issues, or notes here...'
          }
        ]
      }
    ],
    footer: {
      requires_inspector: true,
      requires_approver: true,
      requires_inspection_complete: true
    }
  };

  const energyMeterValidationRules = {
    overall_pass_condition: 'all_required_pass',
    fail_triggers: [{ condition: 'any_item_fails', action: 'generate_cm' }]
  };

  const energyMeterCmRules = {
    auto_generate: true,
    default_priority: 'medium'
  };

  await pool.query(`
    INSERT INTO checklist_templates (
      template_code,
      template_name,
      description,
      asset_type,
      task_type,
      frequency,
      checklist_structure,
      validation_rules,
      cm_generation_rules,
      organization_id
    )
    VALUES (
      'EM-PM-14',
      'Energy Meter Preventive Maintenance - PM-14',
      'Inspection for CT Building Energy Meter (PM-14). Digitized from the Excel checklist template.',
      'energy_meter',
      'PM',
      'monthly',
      $1::jsonb,
      $2::jsonb,
      $3::jsonb,
      $4
    )
    ON CONFLICT (template_code) DO UPDATE SET
      checklist_structure = EXCLUDED.checklist_structure,
      validation_rules = EXCLUDED.validation_rules,
      cm_generation_rules = EXCLUDED.cm_generation_rules,
      organization_id = EXCLUDED.organization_id
  `, [
    JSON.stringify(energyMeterChecklist),
    JSON.stringify(energyMeterValidationRules),
    JSON.stringify(energyMeterCmRules),
    defaultOrgId
  ]);

  console.log('Energy Meter checklist template created');
}

setupDatabase();

