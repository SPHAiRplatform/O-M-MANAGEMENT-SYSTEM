-- Optional: composite index for efficient org-scoped audit log listing
-- Run this if you have many audit rows and list by organization_id often
CREATE INDEX IF NOT EXISTS idx_audit_log_org_created 
  ON audit_log(organization_id, created_at DESC) 
  WHERE organization_id IS NOT NULL;
