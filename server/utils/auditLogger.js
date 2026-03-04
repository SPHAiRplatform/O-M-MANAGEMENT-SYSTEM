/**
 * Audit logger - organization-scoped, minimal payload for security and cost.
 * Only log important actions: auth failures, user lifecycle, task create/delete, org enter/exit.
 * req may be null for login_failed (no session yet); then pass { ip } and details with username.
 */
async function logAudit(pool, req, { action, entityType, entityId, details }) {
  try {
    const hasReq = req && typeof req === 'object';
    const session = hasReq && req.session ? req.session : null;

    // Skip audit logging for system_owner actions entirely
    if (session?.role === 'system_owner') return;

    const tenantContext = hasReq && req.tenantContext ? req.tenantContext : null;
    const orgId = tenantContext?.organizationId ?? session?.selectedOrganizationId ?? session?.organizationId ?? null;
    const ip = (hasReq && (req.ip || req.connection?.remoteAddress)) || null;

    await pool.query(`
      INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, organization_id, details, ip_address)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
    `, [
      session?.userId ?? null,
      session?.username || session?.fullName || (details && details.username) || 'System',
      action,
      entityType,
      entityId ?? null,
      orgId,
      JSON.stringify(details && typeof details === 'object' ? details : {}),
      ip
    ]);
  } catch (error) {
    console.error('[Audit] Write failed:', error.message);
  }
}

/** Actions we audit (for reference and filters) */
const AUDIT_ACTIONS = {
  LOGIN_FAILED: 'login_failed',
  USER_CREATED: 'user_created',
  USER_DEACTIVATED: 'user_deactivated',
  USER_DELETED: 'user_deleted',
  TASK_CREATED: 'task_created',
  TASK_DELETED: 'task_deleted',
  TASK_BULK_DELETED: 'task_bulk_deleted',
  ORG_ENTERED: 'org_entered',
  ORG_EXITED: 'org_exited',
};

const AUDIT_ENTITY_TYPES = {
  AUTH: 'auth',
  USER: 'user',
  TASK: 'task',
  ORGANIZATION: 'organization',
};

module.exports = {
  logAudit,
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
};
