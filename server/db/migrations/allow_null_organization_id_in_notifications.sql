DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE notifications
      ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
  ELSE
    ALTER TABLE notifications
      ALTER COLUMN organization_id DROP NOT NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_notifications_organization_id
  ON notifications(organization_id) WHERE organization_id IS NOT NULL;
