-- Migration: Add organization_id to tracker_cycles and tracker_cycle_history
-- This ensures each organization has its own independent cycle tracking

DO $$
BEGIN
  -- Add organization_id to tracker_cycles
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tracker_cycles' AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE tracker_cycles ADD COLUMN organization_id UUID REFERENCES organizations(id);

    -- Set existing records to the default organization
    UPDATE tracker_cycles SET organization_id = '00000000-0000-0000-0000-000000000001'
    WHERE organization_id IS NULL;

    -- Drop old unique constraint and create new one scoped by organization
    ALTER TABLE tracker_cycles DROP CONSTRAINT IF EXISTS unique_task_cycle;
    ALTER TABLE tracker_cycles ADD CONSTRAINT unique_task_cycle_org UNIQUE (task_type, cycle_number, organization_id);

    -- Create index for organization-scoped queries
    CREATE INDEX IF NOT EXISTS idx_tracker_cycles_org_id ON tracker_cycles(organization_id);
    CREATE INDEX IF NOT EXISTS idx_tracker_cycles_org_task ON tracker_cycles(organization_id, task_type);

    RAISE NOTICE 'Added organization_id to tracker_cycles';
  END IF;

  -- Add organization_id to tracker_cycle_history (if table exists)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'tracker_cycle_history'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'tracker_cycle_history' AND column_name = 'organization_id'
    ) THEN
      ALTER TABLE tracker_cycle_history ADD COLUMN organization_id UUID REFERENCES organizations(id);

      -- Set existing records to the default organization
      UPDATE tracker_cycle_history SET organization_id = '00000000-0000-0000-0000-000000000001'
      WHERE organization_id IS NULL;

      -- Create index
      CREATE INDEX IF NOT EXISTS idx_cycle_history_org_id ON tracker_cycle_history(organization_id);

      RAISE NOTICE 'Added organization_id to tracker_cycle_history';
    END IF;
  END IF;
END $$;
