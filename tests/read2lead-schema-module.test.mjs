import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import schema from '../schemas/read2lead-self-learn/lesson.v1.1.schema.mjs';

test('Pages-compatible lesson schema equals the canonical JSON without dropped validation rules',()=>{
 const canonical=JSON.parse(readFileSync(new URL('../schemas/read2lead-self-learn/lesson.v1.1.schema.json',import.meta.url),'utf8'));
 assert.deepEqual(schema,canonical);
});
