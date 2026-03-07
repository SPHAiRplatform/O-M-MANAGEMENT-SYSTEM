-- Migration: Add Multiple Roles Support
-- Wraps all constraints and columns in IF NOT EXISTS checks to prevent errors on re-run

DO 
$$
BEGIN

  -- Add roles JSONB column if it does not exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'roles'
  ) THEN
    ALTER TABLE users ADD COLUMN roles JSONB DEFAULT '[]'::jsonb;
  END IF;

  -- Add check constraint only if it does not exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_roles_is_array'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT check_roles_is_array
    CHECK (jsonb_typeof(roles) = 'array');
  END IF;

END
$$
;

-- Add index if it does not exist
CREATE INDEX IF NOT EXISTS idx_users_roles ON users USING gin(roles);
