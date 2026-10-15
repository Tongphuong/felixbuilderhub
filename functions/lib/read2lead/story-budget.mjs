// Historical configuration compatibility only. New private QA uses explicit
// batch grants; monthly operating bills are not a build/activation dependency.
export const STORY_MONTHLY_CEILING_MICRO_USD = 40_000_000;
export const STORY_MAX_VOICE_TURNS = 8;
// Each question playback and each recorded answer is a separately reserved
// action. Twelve-question interviews need 24; eight more allow bounded retries.
// This is a validator ceiling, never an increase to an existing dollar grant.
export const STORY_MAX_BATCH_VOICE_ACTIONS = 32;
export function validateStoryBudget(config) {
  const integer = v => Number.isSafeInteger(v) && v >= 0;
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
