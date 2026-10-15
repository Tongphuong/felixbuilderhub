/** Only same-origin, fixed reading paths. Never carry arbitrary next/return URLs. */
export function speakingReturnPath(search, storedCode = '') {
  const input = new URLSearchParams(search);
  const output = new URLSearchParams({ from: 'speaking' });
  if (input.has('t')) { output.set('t', input.get('t') || ''); return '/r2l/start?' + output; }
  const code = input.has('code') ? input.get('code') || '' : input.has('access_code') ? input.get('access_code') || '' : storedCode;
  if (code || input.has('code') || input.has('access_code')) output.set('code', code);
  return '/read2lead?' + output;
}

/** Legacy honors links use the new board; explicit identity always wins. */
export function leaderboardReturnPath(search, storedCode = '') {
  const input = new URLSearchParams(search), output = new URLSearchParams();
  if (input.has('t')) output.set('t', input.get('t') || '');
  else if (input.has('code')) output.set('code', input.get('code') || '');
  else if (input.has('access_code')) output.set('code', input.get('access_code') || '');
  else if (storedCode) output.set('code', storedCode);
  return '/read2lead/leaderboard' + (output.size ? '?' + output : '');
}
