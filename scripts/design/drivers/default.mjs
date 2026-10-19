// Default state driver for the fidelity harness.
//
// Contract: export default async function (page, contract, base, ctx)
//   page     Playwright page, viewport already set to the contract's width x height
//   contract the parsed contract JSON
//   base     the built site's origin (no trailing slash)
//   ctx      { width, designDir, opts } where opts = { token, loginUrl, ... } from the CLI
//
// It must leave `page` showing the contract's `built.state`, or THROW. A driver that
// cannot reach a state must not silently "succeed": the harness records the throw as
// a FAIL (`state-driver`) for that contract, so a wrong or unreachable state can never
// read as a pass or degrade into a confusing "missing ids" failure.
//
// What this default does:
//   1. LOGIN (when --token or --login-url is given): GET the magic link
//      (default `${base}/r2l/start/?t=${token}`) so the session cookie is set.
//   2. NAVIGATE to contract.built.path when it is a URL path (starts with "/").
//   3. VERIFY the state: first-visit / mid-story / empty are checked (logged in; the state's
//      primary label is visible and the other states' labels are not). Forcing the state on the
//      fixture account is a TODO. Reward and rank-up are not implemented and throw.
import { stateProbe } from '../lib/in-page.mjs';

// Each home state is identified by the label of its one primary button.
export const PRIMARY_LABEL = { 'first-visit': 'Mở truyện', 'mid-story': 'Đọc tiếp', empty: 'Mở thư viện', 'no-story': 'Mở thư viện' };

export default async function defaultDriver(page, contract, base, ctx = {}) {
  const opts = ctx.opts || {};
  const state = contract.built && contract.built.state;
  if (!['first-visit', 'mid-story', 'empty', 'no-story', 'reward', 'rank-up'].includes(state)) throw new Error(`default driver: unknown built.state "${state}"`);
  if (state === 'reward') {
    // TODO(next packet): drive one full story mission until stage=reward
    // (pattern: scratchpad v104/mission.mjs); the view is rendered by the story-voice script.
    throw new Error('default driver: state "reward" is not implemented yet (TODO hook)');
  }
  if (state === 'rank-up') {
    // TODO(next packet): finish a mission on an account one XP short of the next star so the
    // RankUpModal opens.
    throw new Error('default driver: state "rank-up" is not implemented yet (TODO hook)');
  }

  const loginUrl = opts.loginUrl || (opts.token ? `${base}/r2l/start/?t=${encodeURIComponent(opts.token)}` : null);
  if (loginUrl) {
    await page.goto(loginUrl, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle').catch(() => {});
  }

  const p = contract.built && contract.built.path;
  if (!p || !p.startsWith('/')) {
    throw new Error(`default driver: contract "${contract.id}" built.path is "${p}" (not a URL path); pass --state-driver for this state`);
  }
  await page.goto(base + p, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle').catch(() => {});

  await verifyHomeState(page, contract, state, opts);
}

// Logged in + the state's primary label visible + the other states' labels absent. Throws otherwise.
export async function verifyHomeState(page, contract, state, opts = {}) {
  // The home renders asynchronously after the session loads: poll (default up to 8s, opts.greetingWaitMs) for the logged-in greeting.
  let probe = await page.evaluate(stateProbe);
  const deadline = Date.now() + Number(opts.greetingWaitMs ?? 8000);
  while (!probe.greeting && !probe.entryForm && Date.now() < deadline) { await page.waitForTimeout(250); probe = await page.evaluate(stateProbe); }
  if (probe.entryForm || !probe.greeting) {
    throw new Error(`not logged in (url ${probe.url}, code-entry form ${probe.entryForm ? 'visible' : 'absent'}, greeting ${probe.greeting ? '"' + probe.greeting + '"' : 'absent'}); pass --token or --login-url`);
  }
  const want = PRIMARY_LABEL[state];
  const has = l => probe.labels.some(t => t.includes(l));
  if (contract.primary && contract.primary.text && !contract.primary.text.includes(want)) {
    throw new Error(`contract ${contract.id}: primary.text "${contract.primary.text}" does not match the "${state}" state label "${want}"`);
  }
  if (!has(want)) throw new Error(`wrong state: expected a visible "${want}" button for "${state}" but found [${probe.labels.slice(0, 8).join(' | ')}]`);
  const group = l => (l === 'no-story' ? 'empty' : l);
  for (const [other, label] of Object.entries(PRIMARY_LABEL)) {
    if (group(other) !== group(state) && has(label)) throw new Error(`wrong state: a "${label}" button (state "${other}") is visible while expecting "${state}"`);
  }
  // TODO(next packet): force the state on the fixture account (it is only VERIFIED here).
}
