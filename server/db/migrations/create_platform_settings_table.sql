-- Migration: Create platform_settings table for system-wide configuration
-- Used by system owner for e.g. Contact Developer (feedback) email

CREATE TABLE IF NOT EXISTS platform_settings (
    setting_key VARCHAR(100) PRIMARY KEY,
    setting_value TEXT,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE platform_settings IS 'System-wide settings (e.g. feedback/contact developer email). System owner only.';
