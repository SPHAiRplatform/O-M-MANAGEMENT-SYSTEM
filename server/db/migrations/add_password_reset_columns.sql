-- Migration: Add password reset columns to users table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'password_reset_token'
  ) THEN
    ALTER TABLE users ADD COLUMN password_reset_token VARCHAR(64);
    ALTER TABLE users ADD COLUMN password_reset_expires TIMESTAMP;
    CREATE INDEX idx_users_reset_token ON users(password_reset_token) WHERE password_reset_token IS NOT NULL;
    RAISE NOTICE 'Added password_reset_token and password_reset_expires to users';
  END IF;
END $$;
