// Historical configuration compatibility only. New private QA uses explicit
// batch grants; monthly operating bills are not a build/activation dependency.
export const STORY_MONTHLY_CEILING_MICRO_USD = 40_000_000;
export const STORY_MAX_VOICE_TURNS = 8;
// Each question playback and each recorded answer is a separately reserved
// action. Twelve-question interviews need 24; eight more allow bounded retries.
// This is a validator ceiling, never an increase to an existing dollar grant.
export const STORY_MAX_BATCH_VOICE_ACTIONS = 32;

// SPEC_R2L_MINNY_VOICE_COST.md Packet B (approved by Phuong 2026-10-16).
// ONE monthly pool (UTC calendar month) for all enrolled students. It is a
// runaway safety stop, NOT a per-child allowance: nothing is reserved per
// mission, every action is debited when it is actually claimed. Amounts are
// measured cost plus margin; the 10k/day free neurons are ignored on purpose,
// so the meter over-counts. Addendum 2026-10-17: live-measured cost x 1.25. These are the ONLY place the numbers live.
export const STORY_POOL_MONTHLY_MICRO_USD = 15_000_000;
export const STORY_POOL_DEBIT_MICRO_USD = Object.freeze({
  cachedPlayback: 0,        // question/authored line served from saved audio
  freshSynthesis: 1_700,    // any text-to-speech actually generated (additive)
  authoredAnswerTurn: 700,// interview answer turn: grader only, fixed reply
  aiReplyTurn: 5_000,       // story_question/help/non-interview: grader + reply + safety
  retell: 700,               // picture retell (grader only, no reply/TTS)
});
// A new voice story is offered only while the pool has at least this much left
// this UTC month (SPEC_R2L_MINNY_VOICE_COST Packet B, Elon review: the interview
// has no tap path, so an empty pool must not strand a child).
export const STORY_POOL_MIN_REMAINING_MICRO_USD = 50_000;
// Marks an audio result whose synthesis was freshly generated (not replayed
// from saved audio). Symbol keys never serialize, so it cannot leak to clients.
export const STORY_SYNTHESIS_FRESH = Symbol.for('r2l.story.synthesis.fresh');
export function validateStoryBudget(config) {
  const integer = v => Number.isSafeInteger(v) && v >= 0;
  if (config?.scope === 'pool') {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(config.poolId || '') ||
        !integer(config.approvedVoiceMicroUsd) || config.approvedVoiceMicroUsd === 0 ||
        config.approvedVoiceMicroUsd > STORY_POOL_MONTHLY_MICRO_USD ||
        !Number.isSafeInteger(config.maxTurns) || config.maxTurns < STORY_MAX_BATCH_VOICE_ACTIONS ||
        config.maxTurns > 64 || Object.keys(config).sort().join(',') !== 'approvedVoiceMicroUsd,maxTurns,poolId,scope') {
      throw Error('voice_pool_budget_invalid');
    }
    // No up-front mission reserve: debits happen per claimed action.
    return { ...config, missionReserveMicroUsd: 0 };
  }
  if (config?.scope === 'batch') {
    const reserve = config.worstCaseTurnMicroUsd * config.maxTurns;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(config.batchId || '') ||
        typeof config.expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(config.expiresAt) ||
        !Number.isFinite(Date.parse(config.expiresAt)) || new Date(config.expiresAt).toISOString() !== config.expiresAt ||
        !integer(config.approvedVoiceMicroUsd) || config.approvedVoiceMicroUsd === 0 ||
        !integer(config.worstCaseTurnMicroUsd) || config.worstCaseTurnMicroUsd === 0 ||
        !Number.isSafeInteger(config.maxTurns) || config.maxTurns < 1 || config.maxTurns > STORY_MAX_BATCH_VOICE_ACTIONS ||
        !Number.isSafeInteger(reserve) || reserve > config.approvedVoiceMicroUsd) throw Error('voice_batch_budget_invalid');
    return { ...config, missionReserveMicroUsd: reserve };
  }
  if (config?.scope !== undefined) throw Error('voice_budget_scope_invalid');
  if (!config || !/^\d{4}-(0[1-9]|1[0-2])$/.test(config.month) || config.baselineReconciled !== true ||
      !integer(config.existingCostsMicroUsd) || !integer(config.approvedVoiceMicroUsd) ||
      config.approvedVoiceMicroUsd === 0 || config.existingCostsMicroUsd + config.approvedVoiceMicroUsd > STORY_MONTHLY_CEILING_MICRO_USD ||
      !integer(config.worstCaseTurnMicroUsd) || config.worstCaseTurnMicroUsd === 0 ||
      !Number.isSafeInteger(config.maxTurns) || config.maxTurns < 1 || config.maxTurns > STORY_MAX_VOICE_TURNS) {
    throw Error('voice_budget_not_reconciled');
  }
  return { ...config, missionReserveMicroUsd: config.worstCaseTurnMicroUsd * config.maxTurns };
}
