/** Stop an R2L level monitor without throwing when shape/version skew leaves `.stop` missing. */
export function safeStopMonitor(monitor: unknown): void {
  try {
    if (monitor && typeof (monitor as { stop?: unknown }).stop === 'function') {
      (monitor as { stop: () => void }).stop();
    }
  } catch {
    /* cleanup must never throw */
  }
}
