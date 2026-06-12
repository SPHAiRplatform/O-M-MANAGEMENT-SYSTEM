/**
 * Checklist Response Idempotency Tests
 *
 * Guards the fix that makes POST /checklist-responses idempotent per task.
 *
 * When a technician submits offline and reconnects, the client replays the
 * submission. If the response already reached the server (e.g. the network
 * dropped after the insert but before the ack), replaying it MUST NOT create a
 * second response row or deduct inventory a second time. The route detects an
 * existing response for the task and returns it as a success no-op instead.
 */

const express = require('express');
const request = require('supertest');

// The POST /checklist-responses route does not include requireAuth in its
// middleware chain (auth is enforced upstream); it reads req.session directly.
// So we inject the session via the first middleware in the chain instead —
// removeUnexpectedFields — which we mock below to seed an admin session. Admin
// role skips the task-assignment lookup, keeping the test on the idempotency path.
jest.mock('../../middleware/auth', () => ({
  requireAuth: (req, res, next) => next(),
  isTechnician: () => false
}));

// --- Mock input validation so we can send a minimal body without fighting the
//     UUID/JSONB validators. The idempotency logic runs after validation. ---
jest.mock('../../middleware/inputValidation', () => {
  const passthroughChain = () => {
    const mw = (req, res, next) => next();
    mw.optional = () => mw;
    mw.withMessage = () => mw;
    return mw;
  };
  return {
    // First middleware in the route chain — seed the authenticated session here.
    removeUnexpectedFields: () => (req, res, next) => {
      req.session = { userId: 'admin-user', role: 'admin' };
      next();
    },
    validateUUID: passthroughChain,
    validateJSONB: passthroughChain,
    validateString: passthroughChain,
    validateDateTime: passthroughChain,
    handleValidationErrors: (req, res, next) => next()
  };
});

// --- Mock external side-effects so they can't interfere. ---
jest.mock('../../utils/notifications', () => ({ notifyTaskFlagged: jest.fn() }));
jest.mock('../../utils/organizationFilter', () => ({
  getOrganizationIdFromRequest: () => 'org-1'
}));

// validateChecklistResponse should NOT be reached on the duplicate path; mock it
// so we can assert it was never called.
const validation = require('../../utils/validation');
jest.spyOn(validation, 'validateChecklistResponse');

const checklistRouter = require('../../routes/checklistResponses');

function buildApp(mockPool) {
  const app = express();
  app.use(express.json());
  app.use('/checklist-responses', checklistRouter(mockPool));
  return app;
}

const TASK_ID = '11111111-1111-1111-1111-111111111111';
const TEMPLATE_ID = '22222222-2222-2222-2222-222222222222';

const baseBody = {
  task_id: TASK_ID,
  checklist_template_id: TEMPLATE_ID,
  response_data: { section1: { item1: { status: 'pass' } } },
  inspected_by: 'Tech One'
};

describe('POST /checklist-responses idempotency', () => {
  beforeEach(() => {
    validation.validateChecklistResponse.mockClear();
  });

  test('returns a duplicate no-op when a response already exists for the task', async () => {
    // Route query sequence on the duplicate path:
    //   1) SELECT task  -> task row (with overall_status)
    //   2) SELECT template -> template row
    //   3) SELECT existing response -> ONE row  => short-circuit
    const mockPool = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: TASK_ID, overall_status: 'pass', task_type: 'PM' }] })
        .mockResolvedValueOnce({ rows: [{ id: TEMPLATE_ID, checklist_structure: { sections: [] }, validation_rules: null }] })
        .mockResolvedValueOnce({ rows: [{ id: 'existing-response-id' }] })
    };

    const res = await request(buildApp(mockPool)).post('/checklist-responses').send(baseBody);

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    expect(res.body.validation.isValid).toBe(true);
    expect(res.body.validation.overallStatus).toBe('pass');

    // Critically: it must NOT validate or insert on the duplicate path.
    expect(validation.validateChecklistResponse).not.toHaveBeenCalled();

    // Only the three SELECTs above — no INSERT, no inventory UPDATE.
    expect(mockPool.query).toHaveBeenCalledTimes(3);
    const calledSql = mockPool.query.mock.calls.map(c => String(c[0]).toUpperCase());
    expect(calledSql.some(sql => sql.includes('INSERT INTO CHECKLIST_RESPONSES'))).toBe(false);
    expect(calledSql.some(sql => sql.includes('UPDATE INVENTORY_ITEMS'))).toBe(false);
  });

  test('does not short-circuit when no existing response is found (proceeds to validation)', async () => {
    // Make validation fail fast so the test stops right after the guard, proving
    // the guard let execution continue rather than returning the duplicate no-op.
    validation.validateChecklistResponse.mockReturnValue({
      isValid: false,
      errors: [{ itemId: 'x', error: 'required' }]
    });

    const mockPool = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: TASK_ID, overall_status: null, task_type: 'PM' }] })
        .mockResolvedValueOnce({ rows: [{ id: TEMPLATE_ID, checklist_structure: { sections: [] }, validation_rules: null }] })
        .mockResolvedValueOnce({ rows: [] }) // no existing response
    };

    const res = await request(buildApp(mockPool)).post('/checklist-responses').send(baseBody);

    // Validation ran (guard did not short-circuit) and rejected the body.
    expect(validation.validateChecklistResponse).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validation failed/i);
  });
});
