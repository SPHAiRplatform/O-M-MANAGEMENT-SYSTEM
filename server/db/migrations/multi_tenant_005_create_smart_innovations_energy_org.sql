-- Migration: Multi-Tenant Step 5 - Create/Update Smart Innovations Energy Organization
-- This creates/updates the default organization for Smart Innovations Energy
-- All existing data will be assigned to this organization

-- Update existing organization with the fixed UUID to use correct name
-- The organization already exists with ID 00000000-0000-0000-0000-000000000001
UPDATE organizations 
SET 
  name = 'Smart Innovations Energy',
  slug = 'smart-innovations-energy',
  is_active = true,
  updated_at = CURRENT_TIMESTAMP
WHERE id = '00000000-0000-0000-0000-000000000001'::UUID;

-- If no rows were updated (organization doesn't exist), create it
INSERT INTO organizations (id, name, slug, is_active, created_at, updated_at)
SELECT 
  '00000000-0000-0000-0000-000000000001'::UUID,
  'Smart Innovations Energy',
  'smart-innovations-energy',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM organizations WHERE id = '00000000-0000-0000-0000-000000000001'::UUID
);

-- Add comment
COMMENT ON TABLE organizations IS 'Organizations (tenants) using the SPHAiRDigital system. Default organization: Smart Innovations Energy (id: 00000000-0000-0000-0000-000000000001)';
