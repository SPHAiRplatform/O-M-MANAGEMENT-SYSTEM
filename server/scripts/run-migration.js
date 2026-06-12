require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const migrationFile = args[0] || 'add_task_pause_resume.sql';

// Allow credentials to be passed as environment variables or command line args
// Format: node run-migration.js migration.sql --user=postgres --password=mypass --host=localhost --port=5432 --database=solar_om_db
const config = {
  host: process.env.DB_HOST || args.find(arg => arg.startsWith('--host='))?.split('=')[1] || 'localhost',
  port: parseInt(process.env.DB_PORT || args.find(arg => arg.startsWith('--port='))?.split('=')[1] || '5432'),
  database: process.env.DB_NAME || args.find(arg => arg.startsWith('--database='))?.split('=')[1] || 'solar_om_db',
  user: process.env.DB_USER || args.find(arg => arg.startsWith('--user='))?.split('=')[1] || 'postgres',
  password: process.env.DB_PASSWORD || args.find(arg => arg.startsWith('--password='))?.split('=')[1] || 'postgres',
};

// SSL for managed databases (DigitalOcean, AWS RDS, etc.) — mirror the main app's
// pool config in index.js so migrations connect the same way the server does.
// Without this, this script fails against SSL-requiring managed Postgres.
if (process.env.DB_SSL === 'true') {
  config.ssl = {
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    ca: process.env.DB_SSL_CA ? fs.readFileSync(process.env.DB_SSL_CA, 'utf8') : undefined,
  };
}

console.log('Database configuration:');
console.log(`  Host: ${config.host}`);
console.log(`  Port: ${config.port}`);
console.log(`  Database: ${config.database}`);
console.log(`  User: ${config.user}`);
console.log(`  Password: ${config.password ? '***' : '(not set)'}`);
console.log('');

const pool = new Pool(config);

async function runMigration() {
  try {
    const migrationPath = path.join(__dirname, '../db/migrations', migrationFile);
    
    if (!fs.existsSync(migrationPath)) {
      console.error(`Migration file not found: ${migrationPath}`);
      process.exit(1);
    }
    
    const migration = fs.readFileSync(migrationPath, 'utf8');
    console.log(`Running migration: ${migrationFile}`);
    await pool.query(migration);
    console.log('Migration applied successfully');
    await pool.end();
  } catch (error) {
    console.error('Error applying migration:', error.message);
    console.error('\nIf you need to specify database credentials, use:');
    console.error('  node run-migration.js migration.sql --user=youruser --password=yourpass --host=localhost --port=5432 --database=yourdb');
    console.error('\nOr set environment variables: DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, DB_NAME');
    await pool.end();
    process.exit(1);
  }
}

runMigration();
