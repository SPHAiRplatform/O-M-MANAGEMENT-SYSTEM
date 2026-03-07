DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'plant_map_structure' AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE plant_map_structure
      ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
  ELSE
    ALTER TABLE plant_map_structure
      ALTER COLUMN organization_id DROP NOT NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_plant_map_structure_organization_id
  ON plant_map_structure(organization_id) WHERE organization_id IS NOT NULL;
