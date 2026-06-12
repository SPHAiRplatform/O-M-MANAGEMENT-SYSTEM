/**
 * Sync Route Tests
 *
 * Guards the fix where the bulk /api/sync endpoint stopped faking success for
 * checklist_submit and unknown operation types. Faking success would let the
 * client delete a queued operation that was never actually applied, silently
 * losing the technician's work. These types must now fail loudly instead.
 *
 * The real client never posts to /api/sync (syncManager replays each operation
 * against its original endpoint), but the endpoint exists and must be safe if
 * anything ever calls it.
 */

const express = require('express');
const request = require('supertest');

// Bypass real authentication — inject a fake authenticated session.
jest.mock('../../middleware/auth', () => ({
  requireAuth: (req, res, next) => {
    req.session = { userId: 'test-user', role: 'technician' };
    next();
  }
}));

// getDb(req, pool) returns req.db || pool, so passing a mock pool is enough.
const syncRouter = require('../../routes/sync');

function buildApp(mockPool) {
  const app = express();
  app.use(express.json());
  app.use('/api', syncRouter(mockPool));
  return app;
}

// A pool whose query() succeeds — proves that task_* ops still work and that
// failures for the bad types come from the route logic, not the DB.
const okPool = {
  query: jest.fn().mockResolvedValue({ rows: [{ id: 'task-1', status: 'in_progress' }] })
};

describe('POST /api/sync', () => {
  beforeEach(() => {
    okPool.query.mockClear();
  });

  test('rejects an empty/missing operations array with 400', async () => {
    const res = await request(buildApp(okPool)).post('/api/sync').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/operations array/i);
  });

  test('checklist_submit is reported as a failure, not a fake success', async () => {
    const res = await request(buildApp(okPool))
      .post('/api/sync')
      .send({ operations: [{ id: 'op-1', type: 'checklist_submit', data: { foo: 'bar' } }] });

    expect(res.status).toBe(200); // batch endpoint returns 200 with per-op results
    expect(res.body.synced).toBe(0);
    expect(res.body.failed).toBe(1);
    expect(res.body.results).toHaveLength(0);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].operationId).toBe('op-1');
    expect(res.body.errors[0].error).toMatch(/checklist-responses/i);
  });

  test('unknown operation types are reported as failures, not fake successes', async () => {
    const res = await request(buildApp(okPool))
      .post('/api/sync')
      .send({ operations: [{ id: 'op-2', type: 'totally_made_up', data: {} }] });

    expect(res.body.synced).toBe(0);
    expect(res.body.failed).toBe(1);
    expect(res.body.errors[0].error).toMatch(/unsupported sync operation type/i);
  });

  test('a supported task operation still succeeds', async () => {
    const res = await request(buildApp(okPool))
      .post('/api/sync')
      .send({
        operations: [
          { id: 'op-3', type: 'task_start', method: 'PATCH', url: '/tasks/abc/start' }
        ]
      });

    expect(res.body.synced).toBe(1);
    expect(res.body.failed).toBe(0);
    expect(res.body.results[0].success).toBe(true);
    expect(okPool.query).toHaveBeenCalled();
  });

  test('a failing type does not poison sibling operations in the same batch', async () => {
    const res = await request(buildApp(okPool))
      .post('/api/sync')
      .send({
        operations: [
          { id: 'good', type: 'task_start', method: 'PATCH', url: '/tasks/abc/start' },
          { id: 'bad', type: 'checklist_submit', data: {} }
        ]
      });

    expect(res.body.synced).toBe(1);
    expect(res.body.failed).toBe(1);
    expect(res.body.results.map(r => r.operationId)).toContain('good');
    expect(res.body.errors.map(e => e.operationId)).toContain('bad');
  });
});
