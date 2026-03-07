/**
 * Script to create a super admin user
 * Usage: node server/scripts/create-superadmin.js
 */

const fs = require('fs');
const bcrypt = require('bcrypt');
const fs = require('fs');
const { Pool } = require('pg');
require('dotenv').config({ path: './server/.env' });
// Also try loading from current dir (when run inside Docker container)
require('dotenv').config();

// SSL config for managed databases (DigitalOcean, AWS RDS, etc.)
function getSslConfig() {
  if (process.env.DB_SSL !== 'true') return undefined;
  return {
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    ca: process.env.DB_SSL_CA ? fs.readFileSync(process.env.DB_SSL_CA, 'utf8') : undefined,
  };
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'solar_om_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  ssl: getSslConfig(),
});

async function createSuperAdmin() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const username = process.env.SUPERADMIN_USERNAME || 'superadmin';
    const email = process.env.SUPERADMIN_EMAIL || 'superadmin@example.com';
    const fullName = 'Super Administrator';
    const password = process.env.SUPERADMIN_PASSWORD || process.env.DEFAULT_USER_PASSWORD || 'changeme';
    const roles = ['super_admin'];
    const role = 'super_admin'; // Primary role for backward compatibility

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Check if roles column exists
    const columnCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'roles'
    `);
    const hasRolesColumn = columnCheck.rows.length > 0;

    // Check if user already exists
    const existingUser = await client.query(
      'SELECT id, username FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (existingUser.rows.length > 0) {
      // Update existing user to super_admin
      console.log(`User ${username} already exists. Updating to super_admin...`);
      
      if (hasRolesColumn) {
        await client.query(
          `UPDATE users 
           SET role = $1, 
               roles = $2::jsonb,
               password_hash = $3,
               full_name = $4,
               is_active = true,
               updated_at = CURRENT_TIMESTAMP
           WHERE username = $5 OR email = $6`,
          [role, JSON.stringify(roles), passwordHash, fullName, username, email]
        );
      } else {
        await client.query(
          `UPDATE users 
           SET role = $1, 
               password_hash = $2,
               full_name = $3,
               is_active = true,
               updated_at = CURRENT_TIMESTAMP
           WHERE username = $4 OR email = $5`,
          [role, passwordHash, fullName, username, email]
        );
      }
      console.log(`✓ User ${username} updated to super_admin successfully!`);
    } else {
      // Create new user
      let result;
      if (hasRolesColumn) {
        result = await client.query(
          `INSERT INTO users (username, email, full_name, role, roles, password_hash, is_active)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, true)
           RETURNING id, username, email, full_name, role, roles`,
          [username, email, fullName, role, JSON.stringify(roles), passwordHash]
        );
      } else {
        result = await client.query(
          `INSERT INTO users (username, email, full_name, role, password_hash, is_active)
           VALUES ($1, $2, $3, $4, $5, true)
           RETURNING id, username, email, full_name, role`,
          [username, email, fullName, role, passwordHash]
        );
      }

      console.log('✓ Super admin user created successfully!');
      console.log('User details:');
      console.log(`  Username: ${result.rows[0].username}`);
      console.log(`  Email: ${result.rows[0].email}`);
      console.log(`  Full Name: ${result.rows[0].full_name}`);
      console.log(`  Role: ${result.rows[0].role}`);
      if (result.rows[0].roles) {
        console.log(`  Roles: ${JSON.stringify(result.rows[0].roles)}`);
      }
      console.log(`  Password: ${password}`);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating super admin:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the script
createSuperAdmin()
  .then(() => {
    console.log('\n✓ Script completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
