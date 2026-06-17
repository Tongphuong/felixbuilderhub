/**
 * V2.1 feature flag plumbing (PR1 infra-only).
 *
 * `PUBLIC_R2L_V21` (Cloudflare Pages env, default "0") gates whether the hub
 * renders the V2.1 lesson UI for packs whose `schema_version === "2.1"`.
 *
 * The `*FromFlag` helpers take the raw flag value explicitly so the flag logic
 * can be unit-tested without an Astro/Vite `import.meta.env` build context
 * (plain `node --test` has no `import.meta.env`).
 */

type MaybeLesson = { schema_version?: unknown } | null | undefined;

/** True only when the raw flag value is exactly the string "1". */
export function isV21EnabledFromFlag(flagValue: unknown): boolean {
  return String(flagValue ?? '') === '1';
}

/** True only when the flag is on AND the pack reports `schema_version === "2.1"`. */
export function shouldRenderAsV21FromFlag(flagValue: unknown, lesson: MaybeLesson): boolean {
  if (!isV21EnabledFromFlag(flagValue)) return false;
  return String(lesson?.schema_version ?? '') === '2.1';
}

/** Reads `PUBLIC_R2L_V21` from the public build env (empty string when unset). */
function publicV21FlagValue(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env;
  return String(env?.PUBLIC_R2L_V21 ?? '');
}

export function isV21Enabled(): boolean {
  return isV21EnabledFromFlag(publicV21FlagValue());
}

export function shouldRenderAsV21(lesson: MaybeLesson): boolean {
  return shouldRenderAsV21FromFlag(publicV21FlagValue(), lesson);
}
