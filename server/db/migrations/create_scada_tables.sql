-- SCADA Integration Tables
-- Creates tables for SCADA API connections, time-series data, and alarms

-- SCADA API connection configurations (managed by system owner)
CREATE TABLE IF NOT EXISTS scada_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  provider VARCHAR(100) DEFAULT 'custom',
  base_url TEXT NOT NULL,
  api_key_encrypted TEXT,
  auth_type VARCHAR(50) DEFAULT 'api_key',
  auth_config JSONB DEFAULT '{}',
  poll_interval_minutes INTEGER DEFAULT 5 CHECK (poll_interval_minutes >= 1 AND poll_interval_minutes <= 1440),
  field_mapping JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  status VARCHAR(20) DEFAULT 'disconnected',
  last_sync_at TIMESTAMP,
  last_error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- SCADA data points (time-series)
CREATE TABLE IF NOT EXISTS scada_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES scada_connections(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  timestamp TIMESTAMP NOT NULL,
  data_type VARCHAR(100) NOT NULL,
  device_id VARCHAR(255),
  value NUMERIC,
  unit VARCHAR(20),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

-- SCADA alarms and events
CREATE TABLE IF NOT EXISTS scada_alarms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES scada_connections(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  device_id VARCHAR(255),
  device_name VARCHAR(255),
  alarm_code VARCHAR(100),
  message TEXT NOT NULL,
  occurred_at TIMESTAMP NOT NULL,
  resolved_at TIMESTAMP,
  acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_scada_connections_org ON scada_connections(organization_id);
CREATE INDEX IF NOT EXISTS idx_scada_data_org_time ON scada_data(organization_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_scada_data_connection_time ON scada_data(connection_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_scada_data_type_time ON scada_data(organization_id, data_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_scada_data_device ON scada_data(device_id, timestamp DESC) WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scada_alarms_org_time ON scada_alarms(organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_scada_alarms_unresolved ON scada_alarms(organization_id, severity)
  WHERE resolved_at IS NULL;

-- Enable RLS
ALTER TABLE scada_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE scada_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE scada_alarms ENABLE ROW LEVEL SECURITY;

-- RLS Policies with DROP IF EXISTS to prevent errors on re-run
DROP POLICY IF EXISTS scada_connections_organization_isolation ON scada_connections;
CREATE POLICY scada_connections_organization_isolation ON scada_connections
  USING (
    organization_id = COALESCE(
      current_setting('app.current_organization_id', true)::UUID,
      '00000000-0000-0000-0000-000000000000'::UUID
    )
    OR current_setting('app.current_user_role', true) = 'system_owner'
  );

DROP POLICY IF EXISTS scada_data_organization_isolation ON scada_data;
CREATE POLICY scada_data_organization_isolation ON scada_data
  USING (
    organization_id = COALESCE(
      current_setting('app.current_organization_id', true)::UUID,
      '00000000-0000-0000-0000-000000000000'::UUID
    )
    OR current_setting('app.current_user_role', true) = 'system_owner'
  );

DROP POLICY IF EXISTS scada_alarms_organization_isolation ON scada_alarms;
CREATE POLICY scada_alarms_organization_isolation ON scada_alarms
  USING (
    organization_id = COALESCE(
      current_setting('app.current_organization_id', true)::UUID,
      '00000000-0000-0000-0000-000000000000'::UUID
    )
    OR current_setting('app.current_user_role', true) = 'system_owner'
  );

-- Comments
COMMENT ON TABLE scada_connections IS 'SCADA API connection configurations per organization';
COMMENT ON TABLE scada_data IS 'Time-series SCADA data points (power, energy, status)';
COMMENT ON TABLE scada_alarms IS 'SCADA alarms and events from connected systems';
