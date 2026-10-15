// Shared existing configuration lookup; importing it cannot start a provider job.
export function resolveOpenAIApiKey(env = {}) {
  return String(env.OPENAI_API_KEY || env.READ2LEAD_OPENAI_API_KEY || '').trim();
}
