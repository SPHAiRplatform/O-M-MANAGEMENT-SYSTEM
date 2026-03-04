-- Migration: Multi-Tenant Step 1 - Create Organizations Table
-- This creates the core organizations table for multi-tenant support

CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL, -- URL-friendly identifier (e.g., 'smart-innovations-energy')
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    address TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_is_active ON organizations(is_active);

-- Add comments
COMMENT ON TABLE organizations IS 'Organizations (tenants) using the SPHAiRDigital system';
COMMENT ON COLUMN organizations.slug IS 'URL-friendly unique identifier for the organization';
