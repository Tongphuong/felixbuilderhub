import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QA_FILE = path.join(ROOT, 'public', 'assets', 'monsters', 'monster-geom-qa.json');

test('every body shape and arm style has symmetric alpha contact', () => {
  const qa = JSON.parse(fs.readFileSync(QA_FILE, 'utf8'));
  const bodyShapes = new Set(qa.rows.map((row) => row.bodyId.match(/body-[a-z]+([a-f])$/i)?.[1]));
  const armStyles = new Set(qa.rows.map((row) => row.armId.match(/arm-[a-z]+([a-e])$/i)?.[1]));

  assert.equal(bodyShapes.size, 6);
  assert.equal(armStyles.size, 5);
  assert.equal(qa.comboCount, bodyShapes.size * armStyles.size);

  for (const row of qa.rows) {
    assert.equal(row.left.contact, true, `${row.bodyId} + ${row.armId}: left arm lacks 4px contact`);
    assert.equal(row.right.contact, true, `${row.bodyId} + ${row.armId}: right arm lacks 4px contact`);
    assert.ok(
      Math.abs(row.leftGap - row.rightGap) <= 3,
      `${row.bodyId} + ${row.armId}: asymmetric gaps ${row.leftGap}/${row.rightGap}`,
    );
    // "Tay ngược" guard: the hand must end up OUTWARD of the shoulder on each
    // side — a backwards arm still touches the body, so contact alone is blind
    // to orientation.
    assert.equal(row.left.orientation_ok, true, `${row.bodyId} + ${row.armId}: LEFT arm points the wrong way`);
    assert.equal(row.right.orientation_ok, true, `${row.bodyId} + ${row.armId}: RIGHT arm points the wrong way`);
  }
});
