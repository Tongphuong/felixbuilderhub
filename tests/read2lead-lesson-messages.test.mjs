// The lesson API's error `message` strings are shown VERBATIM to children by lesson.astro, so they must be Vietnamese WITH diacritics.
// Pins each of the five messages (and that the status + error codes did not change).
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/read2lead-lesson.js';

const kv = (store = {}) => ({ get: async (k) => (k in store ? store[k] : null), put: async (k, v) => { store[k] = JSON.parse(v); } });
const call = async (query, env) => {
  const res = await onRequestGet({ request: new Request('https://x.test/api/read2lead-lesson' + query, { headers: { 'CF-Connecting-IP': '203.0.113.7' } }), env });
  return { status: res.status, body: await res.json() };
};

test('no KV binding: 500 config_error, Vietnamese message', async () => {
  const r = await call('?code=AB&pack_id=p', {});
  assert.equal(r.status, 500); assert.equal(r.body.error, 'config_error');
  assert.equal(r.body.message, 'Hệ thống chưa cấu hình mã học sinh.');
});
test('missing params: 400 missing_params', async () => {
  const r = await call('?code=AB', { READ2LEAD_CODES: kv() });
  assert.equal(r.status, 400); assert.equal(r.body.error, 'missing_params');
  assert.equal(r.body.message, 'Thiếu mã học sinh hoặc mã bài.');
});
test('unknown code: 404 code_not_found', async () => {
  const r = await call('?code=NOPE&pack_id=p', { READ2LEAD_CODES: kv() });
  assert.equal(r.status, 404); assert.equal(r.body.error, 'code_not_found');
  assert.equal(r.body.message, 'Mã học sinh không tồn tại.');
});
test('known code, unknown pack: 404 pack_not_found', async () => {
  const r = await call('?code=KID&pack_id=p', { READ2LEAD_CODES: kv({ KID: { progress: {} } }) });
  assert.equal(r.status, 404); assert.equal(r.body.error, 'pack_not_found');
  assert.equal(r.body.message, 'Không tìm thấy bài này trong mã học sinh.');
});
test('pack still being generated: 409 generation_in_progress', async () => {
  const r = await call('?code=KID&pack_id=p1', { READ2LEAD_CODES: kv({ KID: { progress: { current_pack: { pack_id: 'p1', status: 'generation_in_progress' } } } }) });
  assert.equal(r.status, 409); assert.equal(r.body.error, 'generation_in_progress');
  assert.equal(r.body.message, 'Bài vẫn đang được tạo. Vui lòng đợi thêm một chút.');
});
test('no message the kid can see is unaccented ASCII Vietnamese', async () => {
  const msgs = [];
  for (const [q, env] of [['?code=AB&pack_id=p', {}], ['?code=AB', { READ2LEAD_CODES: kv() }], ['?code=NOPE&pack_id=p', { READ2LEAD_CODES: kv() }], ['?code=KID&pack_id=p', { READ2LEAD_CODES: kv({ KID: { progress: {} } }) }]]) msgs.push((await call(q, env)).body.message);
  for (const m of msgs) assert.match(m, /[À-ỹ]/, `"${m}" has no diacritics`);
});
