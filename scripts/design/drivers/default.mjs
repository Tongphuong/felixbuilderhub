// Default state driver for the fidelity harness.
//
// Contract: export default async function (page, contract, base, ctx)
//   page     Playwright page, viewport already set to the contract's width x height
//   contract the parsed contract JSON
//   base     the built site's origin (no trailing slash)
//   ctx      { width, opts } where opts = { token, loginUrl, ... } from the CLI
//
// It must leave `page` showing the contract's `built.state`, or THROW. A driver that
// cannot reach a state must not silently "succeed": the harness records the throw as
// a FAIL for that contract, so an unreachable state can never read as a pass.
//
// What this default does:
//   1. LOGIN (when --token or --login-url is given): GET the magic link
//      (default `${base}/r2l/start/?t=${token}`) so the session cookie is set.
//   2. NAVIGATE to contract.built.path when it is a URL path (starts with "/").
//   3. STATE: first-visit / mid-story / empty are navigation-only here (the fixture
//      account decides the state; see TODO). Reward and rank-up are not implemented.

export default async function defaultDriver(page, contract, base, ctx = {}) {
  const opts = ctx.opts || {};
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

  const state = contract.built.state;
  switch (state) {
    case 'first-visit':
      // TODO(next packet): assert/force "fresh assigned story, not started" on the fixture
      // account (e.g. via the synthetic-fixture API) instead of trusting the account.
      return;
    case 'mid-story':
      // TODO(next packet): put the fixture account mid-story (story started, page > 1).
      return;
    case 'empty':
      // TODO(next packet): fixture account with NO assigned story.
      return;
    case 'reward':
      // TODO(next packet): drive one full story mission until stage=reward
      // (pattern: scratchpad v104/mission.mjs); the view comes from src/scripts/read2lead-story-voice.mjs.
      throw new Error('default driver: state "reward" is not implemented yet (TODO hook)');
    case 'rank-up':
      // TODO(next packet): finish a mission on an account one XP short of the next star so the
      // RankUpModal opens (src/components/read2lead/v3/rank/RankUpModal.astro).
      throw new Error('default driver: state "rank-up" is not implemented yet (TODO hook)');
    default:
      throw new Error(`default driver: unknown built.state "${state}"`);
  }
}
