/**
 * Secure Update Utility
 * Handles remote updates for SPHAiRDigital
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class SecureUpdater {
  constructor(config = {}) {
    this.updateServerUrl = config.updateServerUrl || process.env.PLATFORM_UPDATE_SERVER_URL;
    this.serviceToken = config.serviceToken || process.env.PLATFORM_SERVICE_TOKEN;
    this.allowIPs = config.allowIPs || (process.env.PLATFORM_UPDATE_IPS ? 
      process.env.PLATFORM_UPDATE_IPS.split(',') : null);
  }

  /**
   * Verify update signature
   * @param {string} updateData - Update package data
   * @param {string} signature - Cryptographic signature
   * @returns {boolean}
   */
  verifySignature(updateData, signature) {
    try {
      const publicKey = process.env.PLATFORM_UPDATE_PUBLIC_KEY;
      if (!publicKey) {
        console.warn('[UPDATER] Public key not configured, skipping signature verification');
        return true; // Allow updates if key not configured (backward compatibility)
      }

      const verifier = crypto.createVerify('SHA256');
      verifier.update(updateData);
      verifier.end();
      
      const isValid = verifier.verify(publicKey, signature, 'base64');
      if (!isValid) {
        console.error('[UPDATER] Signature verification failed');
      }
      
      return isValid;
    } catch (error) {
      console.error('[UPDATER] Error verifying signature:', error);
      return false;
    }
  }

  /**
   * Create backup before update
   * @param {string} backupId - Unique backup identifier
   * @returns {Promise<string>} Path to backup
   */
  async createBackup(backupId) {
    const backupDir = path.join(__dirname, '../backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const backupPath = path.join(backupDir, `backup-${backupId}.tar.gz`);
    
    try {
      // Backup code
      const codeBackup = path.join(backupDir, `code-${backupId}.tar.gz`);
      await execAsync(`tar -czf ${codeBackup} -C ${path.join(__dirname, '..')} . --exclude=node_modules --exclude=uploads --exclude=logs --exclude=backups`);
      
      console.log(`[UPDATER] Backup created: ${backupPath}`);
      return backupPath;
    } catch (error) {
      console.error('[UPDATER] Error creating backup:', error);
      throw error;
    }
  }

  /**
   * Apply update package
   * @param {string} updatePackagePath - Path to update package
   * @returns {Promise<void>}
   */
  async applyUpdate(updatePackagePath) {
    try {
      const appDir = path.join(__dirname, '..');
      
      // Extract update package
      await execAsync(`tar -xzf ${updatePackagePath} -C ${appDir}`);
      
      // Install dependencies
      await execAsync('npm ci --only=production', { cwd: appDir });
      
      console.log('[UPDATER] Update applied successfully');
    } catch (error) {
      console.error('[UPDATER] Error applying update:', error);
      throw error;
    }
  }

  /**
   * Run database migrations
   * @param {Object} pool - Database connection pool
   * @returns {Promise<void>}
   */
  async runMigrations(pool) {
    try {
      const migrationsDir = path.join(__dirname, '../db/migrations');
      const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();

      for (const file of files) {
        const migrationPath = path.join(migrationsDir, file);
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        
        // Check if migration already run
        const checkResult = await pool.query(
          `SELECT * FROM platform_migrations WHERE name = $1`,
          [file]
        );

        if (checkResult.rows.length === 0) {
          console.log(`[UPDATER] Running migration: ${file}`);
          await pool.query(migrationSQL);
          
          // Record migration
          await pool.query(
            `INSERT INTO platform_migrations (name, applied_at) VALUES ($1, CURRENT_TIMESTAMP)`,
            [file]
          );
        }
      }

      console.log('[UPDATER] Migrations completed');
    } catch (error) {
      console.error('[UPDATER] Error running migrations:', error);
      throw error;
    }
  }

  /**
   * Rollback to previous version
   * @param {string} backupPath - Path to backup file
   * @returns {Promise<void>}
   */
  async rollback(backupPath) {
    try {
      const appDir = path.join(__dirname, '..');
      
      // Extract backup
      await execAsync(`tar -xzf ${backupPath} -C ${appDir}`);
      
      // Install dependencies
      await execAsync('npm ci --only=production', { cwd: appDir });
      
      console.log('[UPDATER] Rollback completed successfully');
    } catch (error) {
      console.error('[UPDATER] Error rolling back:', error);
      throw error;
    }
  }
}

module.exports = SecureUpdater;
