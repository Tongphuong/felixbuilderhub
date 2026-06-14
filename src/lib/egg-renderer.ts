function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function eggSvgMarkup(): string {
  return `
    <svg viewBox="0 0 200 240" class="r2l-egg-svg" aria-hidden="true">
      <defs>
        <linearGradient id="r2l-egg-shell-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fffdf4"></stop>
          <stop offset="1" stop-color="#fde68a"></stop>
        </linearGradient>
      </defs>
      <ellipse cx="100" cy="140" rx="76" ry="96" fill="url(#r2l-egg-shell-gradient)" stroke="#d97706" stroke-width="4"></ellipse>
      <ellipse cx="74" cy="103" rx="17" ry="26" fill="#ffffff" opacity="0.62" transform="rotate(24 74 103)"></ellipse>
      <circle cx="66" cy="150" r="10" fill="#f59e0b" opacity="0.35"></circle>
      <circle cx="132" cy="178" r="14" fill="#fb7185" opacity="0.28"></circle>
      <circle cx="122" cy="116" r="8" fill="#38bdf8" opacity="0.3"></circle>
    </svg>
  `;
}

export function renderEggHtml(
  name: string,
  level = 'L1',
  packsUntilLevelUp = 0,
): string {
  const safeName = escapeHtml(name || 'con');
  const safeLevel = escapeHtml(level);
  const packs = Math.max(0, Math.floor(Number(packsUntilLevelUp) || 0));
  return `
    <button
      type="button"
      class="r2l-egg-shell"
      data-r2l-egg
      data-level="${safeLevel}"
      data-packs-until-hatch="${packs}"
      aria-label="Quả trứng của ${safeName}"
    >
      ${eggSvgMarkup()}
      <span class="r2l-egg-greeting">Chào ${safeName}! Khi con học lên Bạc, trứng sẽ nở.</span>
    </button>
  `;
}
