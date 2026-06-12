import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ENGINE_PATH = 'public/scripts/r2l-recorder.js';

/** Content-hashed URL so fresh lesson HTML never pairs with a stale cached engine. */
export function r2lRecorderScriptSrc() {
  const bytes = readFileSync(ENGINE_PATH);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  return `/scripts/r2l-recorder.js?v=${hash}`;
}
