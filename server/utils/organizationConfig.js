/**
 * Organization Configuration Utilities
 * Helper functions for managing organization configuration
 */

/**
 * Get organization setting value
 * @param {Object} db - Database connection or pool
 * @param {string} organizationId - Organization UUID
 * @param {string} settingKey - Setting key
 * @param {*} defaultValue - Default value if setting doesn't exist
 * @returns {Promise<*>} Setting value or default
 */
async function getOrganizationSetting(db, organizationId, settingKey, defaultValue = null) {
  try {
    const result = await db.query(
      'SELECT setting_value FROM organization_settings WHERE organization_id = $1 AND setting_key = $2',
      [organizationId, settingKey]
    );

    if (result.rows.length === 0) {
      return defaultValue;
    }

    return result.rows[0].setting_value;
  } catch (error) {
    console.error(`Error getting organization setting ${settingKey}:`, error);
    return defaultValue;
  }
}

/**
 * Set organization setting value
 * @param {Object} db - Database connection or pool
 * @param {string} organizationId - Organization UUID
 * @param {string} settingKey - Setting key
 * @param {*} settingValue - Setting value (will be JSONB-ified)
 * @param {string} description - Setting description
 * @returns {Promise<void>}
 */
async function setOrganizationSetting(db, organizationId, settingKey, settingValue, description = null) {
  try {
    await db.query(
      `INSERT INTO organization_settings (organization_id, setting_key, setting_value, description, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (organization_id, setting_key)
       DO UPDATE SET
         setting_value = EXCLUDED.setting_value,
         description = COALESCE(EXCLUDED.description, organization_settings.description),
         updated_at = CURRENT_TIMESTAMP`,
      [organizationId, settingKey, JSON.stringify(settingValue), description]
    );
  } catch (error) {
    console.error(`Error setting organization setting ${settingKey}:`, error);
    throw error;
  }
}

/**
 * Get organization feature status
 * @param {Object} db - Database connection or pool
 * @param {string} organizationId - Organization UUID
 * @param {string} featureCode - Feature code
 * @returns {Promise<{isEnabled: boolean, config: object}>}
 */
async function getOrganizationFeature(db, organizationId, featureCode) {
  try {
    const result = await db.query(
      'SELECT is_enabled, config FROM organization_features WHERE organization_id = $1 AND feature_code = $2',
      [organizationId, featureCode]
    );

    if (result.rows.length === 0) {
      // Default: feature is enabled with empty config
      return { isEnabled: true, config: {} };
    }

    const row = result.rows[0];
    return {
      isEnabled: row.is_enabled,
      config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config || {}
    };
  } catch (error) {
    console.error(`Error getting organization feature ${featureCode}:`, error);
    return { isEnabled: true, config: {} };
  }
}

/**
 * Check if organization feature is enabled
 * @param {Object} db - Database connection or pool
 * @param {string} organizationId - Organization UUID
 * @param {string} featureCode - Feature code
 * @returns {Promise<boolean>}
 */
async function isFeatureEnabled(db, organizationId, featureCode) {
  const feature = await getOrganizationFeature(db, organizationId, featureCode);
  return feature.isEnabled;
}

/**
 * Get dashboard configuration for organization
 * @param {Object} db - Database connection or pool
 * @param {string} organizationId - Organization UUID
 * @returns {Promise<object>} Dashboard configuration
 */
async function getDashboardConfig(db, organizationId) {
  const defaultConfig = {
    layout: 'grid',
    visible_cards: ['tasks', 'assets', 'inventory', 'calendar', 'plant'],
    kpi_visibility: {
      pending_tasks: true,
      completed_tasks: true,
      open_cm_letters: true,
      in_progress_tasks: true
    },
    refresh_interval: 30,
    default_view: 'overview'
  };

  const config = await getOrganizationSetting(db, organizationId, 'dashboard', defaultConfig);
  return typeof config === 'string' ? JSON.parse(config) : config || defaultConfig;
}

/**
 * Get notifications configuration for organization
 * @param {Object} db - Database connection or pool
 * @param {string} organizationId - Organization UUID
 * @returns {Promise<object>} Notifications configuration
 */
async function getNotificationsConfig(db, organizationId) {
  const defaultConfig = {
    email_enabled: true,
    sms_enabled: false,
    channels: ['in_app', 'email'],
    rules: [],
    quiet_hours: {
      enabled: false,
      start: '22:00',
      end: '07:00',
      timezone: 'UTC'
    }
  };

  const config = await getOrganizationSetting(db, organizationId, 'notifications', defaultConfig);
  return typeof config === 'string' ? JSON.parse(config) : config || defaultConfig;
}

/**
 * Get reports configuration for organization
 * @param {Object} db - Database connection or pool
 * @param {string} organizationId - Organization UUID
 * @returns {Promise<object>} Reports configuration
 */
async function getReportsConfig(db, organizationId) {
  const defaultConfig = {
    templates: {
      pm_report: {
        enabled: true,
        custom_fields: [],
        format: 'pdf',
        include_charts: true,
        include_images: true
      },
      cm_report: {
        enabled: true,
        custom_fields: [],
        format: 'pdf',
        include_charts: true
      },
      inventory_report: {
        enabled: true,
        custom_fields: [],
        format: 'excel',
        include_low_stock: true
      }
    },
    default_format: 'pdf',
    auto_generate: {
      pm_monthly: false,
      cm_weekly: false
    },
    delivery: {
      email: true,
      storage: 'cloud',
      retention_days: 90
    }
  };

  const config = await getOrganizationSetting(db, organizationId, 'reports', defaultConfig);
  return typeof config === 'string' ? JSON.parse(config) : config || defaultConfig;
}

/**
 * Get tasks configuration for organization
 * @param {Object} db - Database connection or pool
 * @param {string} organizationId - Organization UUID
 * @returns {Promise<object>} Tasks configuration
 */
async function getTasksConfig(db, organizationId) {
  const defaultConfig = {
    default_priority: 'medium',
    auto_assign: false,
    require_photos: true,
    require_checklist: true,
    allow_early_completion: true,
    workflow: {
      pm_to_cm_auto_generate: true,
      cm_letter_auto_generate: true,
      approval_required: false
    },
    reminders: {
      enabled: true,
      days_before_due: [3, 1],
      channels: ['in_app', 'email']
    }
  };

  const config = await getOrganizationSetting(db, organizationId, 'tasks', defaultConfig);
  return typeof config === 'string' ? JSON.parse(config) : config || defaultConfig;
}

/**
 * Initialize default configurations for a new organization
 * @param {Object} db - Database connection or pool
 * @param {string} organizationId - Organization UUID
 * @returns {Promise<void>}
 */
async function initializeDefaultConfigurations(db, organizationId) {
  const defaultSettings = {
    dashboard: {
      layout: 'grid',
      visible_cards: ['tasks', 'assets', 'inventory', 'calendar', 'plant'],
      kpi_visibility: {
        pending_tasks: true,
        completed_tasks: true,
        open_cm_letters: true,
        in_progress_tasks: true
      },
      refresh_interval: 30,
      default_view: 'overview'
    },
    notifications: {
      email_enabled: true,
      sms_enabled: false,
      channels: ['in_app', 'email'],
      rules: [],
      quiet_hours: {
        enabled: false,
        start: '22:00',
        end: '07:00',
        timezone: 'UTC'
      }
    },
    reports: {
      templates: {
        pm_report: { enabled: true, format: 'pdf' },
        cm_report: { enabled: true, format: 'pdf' },
        inventory_report: { enabled: true, format: 'excel' }
      },
      default_format: 'pdf',
      auto_generate: { pm_monthly: false, cm_weekly: false },
      delivery: { email: true, storage: 'cloud', retention_days: 90 }
    },
    tasks: {
      default_priority: 'medium',
      auto_assign: false,
      require_photos: true,
      require_checklist: true,
      allow_early_completion: true,
      workflow: {
        pm_to_cm_auto_generate: true,
        cm_letter_auto_generate: true,
        approval_required: false
      },
      reminders: {
        enabled: true,
        days_before_due: [3, 1],
        channels: ['in_app', 'email']
      }
    },
    inventory: {
      low_stock_threshold: 10,
      auto_reorder: false,
      track_consumption: true,
      require_approval: false,
      categories: ['spare_parts', 'consumables', 'tools'],
      units: {
        default: 'pieces',
        allowed: ['pieces', 'liters', 'kilograms', 'meters']
      }
    },
    calendar: {
      default_view: 'month',
      working_hours: {
        start: '08:00',
        end: '17:00',
        days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
      },
      holidays: [],
      timezone: 'UTC',
      show_weekends: true
    },
    security: {
      password_policy: {
        min_length: 8,
        require_uppercase: true,
        require_lowercase: true,
        require_numbers: true,
        require_special: false,
        expiry_days: 90
      },
      session_timeout: 3600,
      two_factor_enabled: false,
      ip_whitelist: [],
      audit_log_retention_days: 365
    }
  };

  const descriptions = {
    dashboard: 'Dashboard layout and visibility preferences',
    notifications: 'Notification preferences and rules',
    reports: 'Report template and generation preferences',
    tasks: 'Task management preferences and workflow settings',
    inventory: 'Inventory management preferences',
    calendar: 'Calendar and scheduling preferences',
    security: 'Security and password policy settings'
  };

  // Insert all default settings
  for (const [key, value] of Object.entries(defaultSettings)) {
    await setOrganizationSetting(db, organizationId, key, value, descriptions[key]);
  }

  // Enable default features
  const defaultFeatures = [
    'dashboard',
    'tasks',
    'inventory',
    'calendar',
    'plant',
    'reports',
    'cm_letters',
    'checklist_templates',
    'notifications',
    'offline_sync',
    'multi_user',
    'audit_trail',
    'scada'
  ];

  for (const featureCode of defaultFeatures) {
    await db.query(
      `INSERT INTO organization_features (organization_id, feature_code, is_enabled, config, created_at, updated_at)
       VALUES ($1, $2, true, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (organization_id, feature_code) DO NOTHING`,
      [organizationId, featureCode]
    );
  }
}

module.exports = {
  getOrganizationSetting,
  setOrganizationSetting,
  getOrganizationFeature,
  isFeatureEnabled,
  getDashboardConfig,
  getNotificationsConfig,
  getReportsConfig,
  getTasksConfig,
  initializeDefaultConfigurations
};
