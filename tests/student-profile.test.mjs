import test from 'node:test';
import assert from 'node:assert/strict';

import {
  onRequestDelete,
  onRequestGet,
  onRequestPost,
  onRequestPut,
} from '../functions/api/student-profile.ts';

const TOKEN = 'profile-secret';

function request(method, path = '/api/student-profile', body, token = TOKEN) {
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');

  return new Request(`https://example.com${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function invalidJsonRequest() {
  return new Request('https://example.com/api/student-profile', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: '{',
  });
}

function env(db = createD1()) {
  return {
    STUDENT_PROFILE_API_TOKEN: TOKEN,
    STUDENT_PROFILE_DB: db,
  };
}

async function payload(response) {
  return response.json();
}

test('POST /api/student-profile creates a student profile with token auth', async () => {
  const db = createD1();
  const response = await onRequestPost({
    request: request('POST', '/api/student-profile', {
      student_id: 'r2l-001',
      display_name: 'Minh Anh',
      parent_name: 'Phuong',
      email: 'parent@example.com',
      cefr_level: 'a2',
      goals: ['retell better', 'speak more clearly'],
      metadata: { source: 'admin' },
    }),
    env: env(db),
  });
  const body = await payload(response);

  assert.equal(response.status, 201);
  assert.equal(body.ok, true);
  assert.equal(body.profile.student_id, 'R2L-001');
  assert.equal(body.profile.display_name, 'Minh Anh');
  assert.deepEqual(body.profile.goals, ['retell better', 'speak more clearly']);
  assert.deepEqual(body.profile.metadata, { source: 'admin' });
  assert.equal(db.rows.get('R2L-001').deleted_at, null);
});

test('GET /api/student-profile returns an active profile', async () => {
  const db = createD1([
    {
      student_id: 'R2L-002',
      display_name: 'Bao',
      parent_name: null,
      email: null,
      phone: null,
      cefr_level: 'a1',
      status: 'active',
      goals: '["read daily"]',
      notes: null,
      metadata: '{"source":"seed"}',
      created_at: '2026-06-23T00:00:00.000Z',
      updated_at: '2026-06-23T00:00:00.000Z',
      deleted_at: null,
    },
  ]);

  const response = await onRequestGet({
    request: request('GET', '/api/student-profile?student_id=r2l-002'),
    env: env(db),
  });
  const body = await payload(response);

  assert.equal(response.status, 200);
  assert.equal(body.profile.student_id, 'R2L-002');
  assert.deepEqual(body.profile.goals, ['read daily']);
  assert.deepEqual(body.profile.metadata, { source: 'seed' });
});

test('PUT /api/student-profile validates JSON and updates without changing student_id', async () => {
  const db = createD1([
    baseRow({ student_id: 'R2L-003', display_name: 'Old Name' }),
  ]);

  const response = await onRequestPut({
    request: request('PUT', '/api/student-profile?student_id=R2L-003', {
      student_id: 'SHOULD-NOT-CHANGE',
      display_name: 'New Name',
      status: 'paused',
      goals: ['prepare class'],
    }),
    env: env(db),
  });
  const body = await payload(response);

  assert.equal(response.status, 200);
  assert.equal(body.profile.student_id, 'R2L-003');
  assert.equal(body.profile.display_name, 'New Name');
  assert.equal(body.profile.status, 'paused');
  assert.deepEqual(body.profile.goals, ['prepare class']);
  assert.equal(db.rows.has('SHOULD-NOT-CHANGE'), false);
});

test('DELETE /api/student-profile archives instead of hard deleting', async () => {
  const db = createD1([
    baseRow({ student_id: 'R2L-004', display_name: 'Archive Me' }),
  ]);

  const response = await onRequestDelete({
    request: request('DELETE', '/api/student-profile?student_id=R2L-004'),
    env: env(db),
  });
  const body = await payload(response);
  const row = db.rows.get('R2L-004');

  assert.equal(response.status, 200);
  assert.equal(body.archived, true);
  assert.equal(row.status, 'archived');
  assert.match(row.deleted_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(db.deleteCalls, 0);

  const getResponse = await onRequestGet({
    request: request('GET', '/api/student-profile?student_id=R2L-004'),
    env: env(db),
  });
  assert.equal(getResponse.status, 404);
});

test('student profile endpoint rejects missing or wrong token', async () => {
  const missing = await onRequestGet({
    request: request('GET', '/api/student-profile?student_id=R2L-001', undefined, ''),
    env: env(),
  });
  const wrong = await onRequestGet({
    request: request('GET', '/api/student-profile?student_id=R2L-001', undefined, 'wrong'),
    env: env(),
  });

  assert.equal(missing.status, 401);
  assert.equal((await payload(missing)).error, 'unauthorized');
  assert.equal(wrong.status, 401);
  assert.equal((await payload(wrong)).error, 'unauthorized');
});

test('student profile endpoint rejects invalid JSON and invalid payloads', async () => {
  const badJson = await onRequestPost({
    request: invalidJsonRequest(),
    env: env(),
  });
  assert.equal(badJson.status, 400);
  assert.equal((await payload(badJson)).error, 'invalid_json');

  const badPayload = await onRequestPost({
    request: request('POST', '/api/student-profile', {
      student_id: '../bad',
      display_name: '',
      email: 'not-an-email',
      goals: new Array(13).fill('too many'),
    }),
    env: env(),
  });
  const body = await payload(badPayload);

  assert.equal(badPayload.status, 400);
  assert.equal(body.error, 'invalid_payload');
  assert.deepEqual(
    body.errors.sort(),
    ['invalid_display_name', 'invalid_email', 'invalid_goals', 'invalid_student_id'].sort(),
  );
});

test('POST /api/student-profile returns conflict for duplicate active profile', async () => {
  const db = createD1([
    baseRow({ student_id: 'R2L-005', display_name: 'Exists' }),
  ]);

  const response = await onRequestPost({
    request: request('POST', '/api/student-profile', {
      student_id: 'R2L-005',
      display_name: 'Exists Again',
    }),
    env: env(db),
  });
  const body = await payload(response);

  assert.equal(response.status, 409);
  assert.equal(body.error, 'student_profile_exists');
});

function baseRow(overrides = {}) {
  return {
    student_id: 'R2L-BASE',
    display_name: 'Student',
    parent_name: null,
    email: null,
    phone: null,
    cefr_level: null,
    status: 'active',
    goals: '[]',
    notes: null,
    metadata: '{}',
    created_at: '2026-06-23T00:00:00.000Z',
    updated_at: '2026-06-23T00:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

function createD1(seed = []) {
  const rows = new Map(seed.map((row) => [row.student_id, { ...row }]));
  return {
    rows,
    deleteCalls: 0,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              return executeFirst(rows, sql, values);
            },
            async run() {
              return executeRun(rows, sql, values, this);
            },
          };
        },
      };
    },
  };
}

function executeFirst(rows, sql, values) {
  if (!sql.includes('FROM student_profiles')) {
    throw new Error(`Unexpected first SQL: ${sql}`);
  }
  const studentId = values[0];
  const row = rows.get(studentId);
  if (!row || row.deleted_at) return null;
  return { ...row };
}

function executeRun(rows, sql, values, statement) {
  if (/\bDELETE\b/i.test(sql)) {
    statement.deleteCalls += 1;
  }

  if (sql.includes('INSERT INTO student_profiles')) {
    const [
      student_id,
      display_name,
      parent_name,
      email,
      phone,
      cefr_level,
      status,
      goals,
      notes,
      metadata,
      created_at,
      updated_at,
    ] = values;
    rows.set(student_id, {
      student_id,
      display_name,
      parent_name,
      email,
      phone,
      cefr_level,
      status,
      goals,
      notes,
      metadata,
      created_at,
      updated_at,
      deleted_at: null,
    });
    return { meta: { changes: 1 } };
  }

  if (sql.includes("SET status = 'archived'")) {
    const [deleted_at, updated_at, student_id] = values;
    const row = rows.get(student_id);
    if (!row || row.deleted_at) return { meta: { changes: 0 } };
    row.status = 'archived';
    row.deleted_at = deleted_at;
    row.updated_at = updated_at;
    return { meta: { changes: 1 } };
  }

  if (sql.includes('UPDATE student_profiles')) {
    const student_id = values.at(-1);
    const row = rows.get(student_id);
    if (!row || row.deleted_at) return { meta: { changes: 0 } };

    const setClause = sql.slice(sql.indexOf('SET ') + 4, sql.indexOf('WHERE'));
    const fields = setClause
      .split(',')
      .map((part) => part.trim().split(' = ')[0])
      .filter((field) => field !== 'updated_at');

    fields.forEach((field, index) => {
      row[field] = values[index];
    });
    row.updated_at = values.at(-2);
    return { meta: { changes: 1 } };
  }

  throw new Error(`Unexpected run SQL: ${sql}`);
}
