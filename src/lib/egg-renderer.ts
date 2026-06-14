function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function eggSvgMarkup(): string {
  // Egg shape: Sbed "Big Egg" from game-icons.net (CC BY 3.0)
  // Credit at public/assets/eggs/CREDITS.md + site /credits page.
  // Sparkles + warm glow decoratively added by Read2Lead team (CC0).
  return `
    <svg viewBox="0 0 512 600" class="r2l-egg-svg" aria-hidden="true">
      <defs>
        <radialGradient id="r2l-egg-shell-glow" cx="0.5" cy="0.55" r="0.5">
          <stop offset="0" stop-color="#fef3c7"></stop>
          <stop offset="0.7" stop-color="#fbbf24"></stop>
          <stop offset="1" stop-color="#d97706"></stop>
        </radialGradient>
      </defs>
      <ellipse cx="256" cy="540" rx="160" ry="22" fill="#000" opacity="0.12"></ellipse>
      <path
        fill="url(#r2l-egg-shell-glow)"
        stroke="#92400e"
        stroke-width="8"
        stroke-linejoin="round"
        d="M256 16C166 16 76 196 76 316c0 90 60 180 180 180s180-90 180-180c0-120-90-300-180-300z"
      ></path>
      <ellipse cx="200" cy="190" rx="32" ry="48" fill="#ffffff" opacity="0.55" transform="rotate(-18 200 190)"></ellipse>
      <circle cx="170" cy="340" r="14" fill="#ffffff" opacity="0.35"></circle>
      <g class="r2l-egg-sparkles" aria-hidden="true">
        <circle cx="100" cy="120" r="6" fill="#fde68a"></circle>
        <circle cx="420" cy="200" r="8" fill="#fef3c7"></circle>
        <circle cx="80" cy="380" r="5" fill="#fcd34d"></circle>
      </g>
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
