DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tracker_status_requests' AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE tracker_status_requests
      ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
  ELSE
    ALTER TABLE tracker_status_requests
      ALTER COLUMN organization_id DROP NOT NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_tracker_status_requests_organization_id
  ON tracker_status_requests(organization_id) WHERE organization_id IS NOT NULL;
