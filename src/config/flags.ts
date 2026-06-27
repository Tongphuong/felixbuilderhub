export const R2L_V3 = import.meta.env.PUBLIC_R2L_V3 === '1';

/** V3 gate: env flag OR client-side ?v3=1 preview override. */
export function isV3Enabled(): boolean {
  if (import.meta.env.PUBLIC_R2L_V3 === '1') return true;
  if (typeof window !== 'undefined') {
    return new URLSearchParams(window.location.search).get('v3') === '1';
  }
  return false;
}

/** Unified profile gate: env flag OR client-side ?profile=1 preview override. */
export function isProfileEnabled(): boolean {
  if (import.meta.env.PUBLIC_R2L_PROFILE === '1') return true;
  if (typeof window !== 'undefined') {
    return new URLSearchParams(window.location.search).get('profile') === '1';
  }
  return false;
}
