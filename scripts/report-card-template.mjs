#!/usr/bin/env node
/**
 * R2L Season Honors — certificate HTML template. PURE function, zero I/O
 * (no KV, no fs, no Chrome, no network) so it is unit-testable in isolation
 * and the visual layer can be reworked later without touching the data
 * plumbing in scripts/build-report-cards.mjs.
 *
 * Founder's words, verbatim: "Report cards just need to be a pdf file, it
 * must be beautiful, and must look like a certificate" — a Vietnamese
 * "giấy khen". "Beautiful" is an explicit acceptance criterion; a plain
 * data sheet fails this packet.
 *
 * Never-shame rule (AGENTS.md §5), enforced in this file, not by the caller:
 *   - Any zero stat is omitted entirely, never rendered as "0".
 *   - Pronunciation shows no percentage and no bar when sample_count < 3.
 *   - Zero lessons AND zero books => a different certificate: a warm
 *     "Thẻ khởi động" welcome card, the child's name, zero numbers.
 *   - No rank/position/percentile/comparison anywhere except the top-3
 *     ribbon (an explicit, spec-approved exception) — every other
 *     certificate is dignified and standalone; a parent can never infer
 *     their child came 11th.
 *
 * Reuse-first: this module owns no student-data reads. The caller
 * (scripts/build-report-cards.mjs) is responsible for sourcing every field
 * from functions/api/_read2lead-v2-state.js / _read2lead-honors.js and
 * handing this function a plain, pre-shaped data object.
 */

// Exported so the bite test (and any future caller) can assert against the
// exact same string this module renders, rather than a hand-typed copy that
// could silently drift from the real headline.
export const STARTER_HEADLINE_VI = 'Thẻ khởi động';

const RANK_RIBBON_LABEL_VI = { 1: 'HẠNG NHẤT', 2: 'HẠNG NHÌ', 3: 'HẠNG BA' };

// Gold / silver / bronze — bronze is a warm copper distinct from --gold so a
// rank-3 ribbon doesn't read as a duplicate of the page's own gold accent.
const RANK_COLORS = {
  1: { base: '#c88f38', light: '#f7dfa3', dark: '#9c6d24', ink: '#3a2a08' },
  2: { base: '#9fb0bd', light: '#e3ebf1', dark: '#6f7d88', ink: '#26313a' },
  3: { base: '#b96a3a', light: '#e2a878', dark: '#7c451f', ink: '#38200e' },
};

const A4_MM = { landscape: { w: 297, h: 210 }, portrait: { w: 210, h: 297 } };

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** dd/mm/yyyy from a 'YYYY-MM-DD' ISO date string; '' if unparseable. */
function formatDateVi(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!match) return '';
  const [, y, m, d] = match;
  return `${d}/${m}/${y}`;
}

function formatInt(value) {
  return new Intl.NumberFormat('vi-VN').format(Math.round(value));
}

/**
 * A hand-built laurel wreath (two mirrored arcs of leaves) around a central
 * emblem — the certificate's crest. Generated procedurally (trig, not
 * hand-typed coordinates) so both arcs are guaranteed symmetric.
 */
function buildCrestSvg({ size = 132 } = {}) {
  const cx = size / 2;
  const cy = size / 2;
  const ringR = size * 0.46;
  const leafCount = 7;
  const leafArcStart = -34; // degrees, measured from vertical (up = 0)
  const leafArcEnd = 118;

  function leaf(angleDeg, mirror) {
    const angle = (angleDeg * Math.PI) / 180;
    const dir = mirror ? -1 : 1;
    const x = cx + dir * Math.sin(angle) * ringR;
    const y = cy - Math.cos(angle) * ringR;
    const rotate = dir * angleDeg + (mirror ? 180 : 0);
    return `<ellipse cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" rx="9" ry="4.2"
      fill="url(#crestLeaf)" stroke="#7c531c" stroke-width="0.6"
      transform="rotate(${rotate.toFixed(1)} ${x.toFixed(2)} ${y.toFixed(2)})" />`;
  }

  const leaves = [];
  for (let i = 0; i < leafCount; i += 1) {
    const t = i / (leafCount - 1);
    const angle = leafArcStart + t * (leafArcEnd - leafArcStart);
    leaves.push(leaf(angle, false));
    leaves.push(leaf(angle, true));
  }

  return `
  <svg class="fx-crest" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"
       xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient id="crestLeaf" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f2cc7e" />
        <stop offset="1" stop-color="#c88f38" />
      </linearGradient>
      <radialGradient id="crestCore" cx="0.35" cy="0.3" r="0.8">
        <stop offset="0" stop-color="#2a4a63" />
        <stop offset="1" stop-color="#152c3f" />
      </radialGradient>
    </defs>
    ${leaves.join('')}
    <circle cx="${cx}" cy="${cy}" r="${size * 0.3}" fill="url(#crestCore)" stroke="#f2cc7e" stroke-width="2.5" />
    <circle cx="${cx}" cy="${cy}" r="${size * 0.3 - 5}" fill="none" stroke="#c88f38" stroke-width="1" opacity="0.8" />
    <path d="M ${cx} ${cy - 6} C ${cx - 3} ${cy - 9}, ${cx - 10} ${cy - 10}, ${cx - 14} ${cy - 7}
             L ${cx - 14} ${cy + 7} C ${cx - 10} ${cy + 4}, ${cx - 3} ${cy + 5}, ${cx} ${cy + 8} Z"
          fill="none" stroke="#f2cc7e" stroke-width="1.5" stroke-linejoin="round" />
    <path d="M ${cx} ${cy - 6} C ${cx + 3} ${cy - 9}, ${cx + 10} ${cy - 10}, ${cx + 14} ${cy - 7}
             L ${cx + 14} ${cy + 7} C ${cx + 10} ${cy + 4}, ${cx + 3} ${cy + 5}, ${cx} ${cy + 8} Z"
          fill="none" stroke="#f2cc7e" stroke-width="1.5" stroke-linejoin="round" />
    <path d="M ${cx} ${cy - 6} L ${cx} ${cy + 8}" stroke="#f2cc7e" stroke-width="1" opacity="0.85" />
    <path d="M ${cx - 10} ${cy - 3} L ${cx - 3} ${cy - 1.5} M ${cx - 10} ${cy + 0.5} L ${cx - 3} ${cy + 2}
             M ${cx + 3} ${cy - 1.5} L ${cx + 10} ${cy - 3} M ${cx + 3} ${cy + 2} L ${cx + 10} ${cy + 0.5}"
          stroke="#f2cc7e" stroke-width="0.8" opacity="0.55" stroke-linecap="round" />
    <path d="M ${cx} ${cy - 21} l 2.6 5.6 6 0.7 -4.4 4.1 1.1 6 -5.3 -3 -5.3 3 1.1 -6 -4.4 -4.1 6 -0.7 Z"
          fill="#f2cc7e" transform="translate(0,0)" opacity="0.95" />
  </svg>`;
}

/** One quarter-corner flourish; placed at all 4 corners via CSS rotation. */
function buildCornerFlourishSvg() {
  return `
  <svg class="fx-corner-svg" width="100%" height="100%" viewBox="0 0 120 120"
       preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M4 4 C 4 46, 4 74, 4 116 M4 4 C 46 4, 74 4, 116 4"
          fill="none" stroke="#c88f38" stroke-width="2.4" />
    <path d="M4 4 C 30 4, 4 30, 4 4 Z" fill="#c88f38" opacity="0" />
    <path d="M18 4 C 18 22, 22 30, 40 30" fill="none" stroke="#f2cc7e" stroke-width="1.6" />
    <path d="M4 18 C 22 18, 30 22, 30 40" fill="none" stroke="#f2cc7e" stroke-width="1.6" />
    <circle cx="4" cy="4" r="5" fill="#f2cc7e" />
    <circle cx="4" cy="4" r="2.1" fill="#152c3f" />
    <circle cx="30" cy="4" r="2.4" fill="#c88f38" />
    <circle cx="4" cy="30" r="2.4" fill="#c88f38" />
  </svg>`;
}

/** Top-3 medallion ribbon, colored by rank; omitted entirely otherwise. */
function buildRibbonSvg(rank) {
  const c = RANK_COLORS[rank];
  if (!c) return '';
  const label = RANK_RIBBON_LABEL_VI[rank] || '';
  return `
  <svg class="fx-ribbon-svg" width="152" height="192" viewBox="0 0 152 192"
       xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <linearGradient id="ribbonBody" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${c.light}" />
        <stop offset="1" stop-color="${c.base}" />
      </linearGradient>
      <linearGradient id="ribbonTail" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${c.base}" />
        <stop offset="1" stop-color="${c.dark}" />
      </linearGradient>
    </defs>
    <path d="M46 96 L46 186 L76 166 L106 186 L106 96 Z" fill="url(#ribbonTail)" stroke="${c.dark}" stroke-width="1.5" />
    <path d="M46 186 L60 150 L46 150 Z" fill="${c.dark}" />
    <path d="M106 186 L92 150 L106 150 Z" fill="${c.dark}" />
    <circle cx="76" cy="66" r="58" fill="url(#ribbonBody)" stroke="${c.dark}" stroke-width="3" />
    <circle cx="76" cy="66" r="48" fill="none" stroke="${c.ink}" stroke-width="1.4" opacity="0.55" />
    <text x="76" y="72" text-anchor="middle" font-family="'Manrope', sans-serif" font-weight="800"
          font-size="40" fill="${c.ink}">${rank}</text>
    <text x="76" y="140" text-anchor="middle" font-family="'Manrope', sans-serif" font-weight="700"
          font-size="13" letter-spacing="1.5" fill="${c.dark}">${escapeHtml(label)}</text>
  </svg>`;
}

/** Small round "official seal" beside the founder's signature. */
function buildSealSvg() {
  return `
  <svg class="fx-seal-svg" width="86" height="86" viewBox="0 0 86 86"
       xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="43" cy="43" r="40" fill="none" stroke="#c88f38" stroke-width="2" />
    <circle cx="43" cy="43" r="34" fill="none" stroke="#c88f38" stroke-width="1" stroke-dasharray="2 3" />
    <text x="43" y="30" text-anchor="middle" font-family="'Manrope', sans-serif" font-weight="700"
          font-size="9" letter-spacing="1.2" fill="#c88f38">READ2LEAD</text>
    <path d="M43 36 l2.6 5.6 6 0.7 -4.4 4.1 1.1 6 -5.3 -3 -5.3 3 1.1 -6 -4.4 -4.1 6 -0.7 Z" fill="#c88f38" />
    <text x="43" y="62" text-anchor="middle" font-family="'Manrope', sans-serif" font-weight="700"
          font-size="8" letter-spacing="1" fill="#c88f38">MÙA HÈ 2026</text>
  </svg>`;
}

/**
 * @typedef {object} CertificateStats
 * @property {number} [completedBooks]
 * @property {number} [completedPacks]
 * @property {number} [diamonds]
 * @property {number} [totalXp]
 * @property {number} [streakDays]
 * @property {string|null} [currentLevelLabel] Vietnamese rank title (e.g. 'Vàng').
 *
 * @typedef {object} CertificateData
 * @property {string} studentName Real child name, full diacritics.
 * @property {string} seasonNameVi e.g. 'Amazing Summer'
 * @property {string} seasonEmoji e.g. '🌞'
 * @property {string} [seasonFrom] ISO 'YYYY-MM-DD'
 * @property {string} [seasonTo] ISO 'YYYY-MM-DD'
 * @property {1|2|3|null} [honorsRank]
 * @property {CertificateStats} [stats]
 * @property {{percent: number|null, sample_count: number}} [pronunciation]
 */

/**
 * Render one certificate as a complete, self-contained HTML document string.
 * Pure: no I/O. Same data, same orientation -> byte-identical output.
 *
 * @param {CertificateData} data
 * @param {{orientation?: 'landscape'|'portrait'}} [options]
 * @returns {string}
 */
export function renderCertificateHtml(data, { orientation = 'landscape' } = {}) {
  const dims = A4_MM[orientation] || A4_MM.landscape;
  const stats = data?.stats || {};
  const pronunciation = data?.pronunciation || { percent: null, sample_count: 0 };
  const honorsRank = [1, 2, 3].includes(Number(data?.honorsRank)) ? Number(data.honorsRank) : null;

  const completedBooks = numberOrNull(stats.completedBooks);
  const completedPacks = numberOrNull(stats.completedPacks);
  const diamonds = numberOrNull(stats.diamonds);
  const totalXp = numberOrNull(stats.totalXp);
  const streakDays = numberOrNull(stats.streakDays);
  const currentLevelLabel = stats.currentLevelLabel ? String(stats.currentLevelLabel).trim() : '';
  const pronunciationPercent = Number(pronunciation.sample_count) >= 3 ? numberOrNull(pronunciation.percent) ?? 0 : null;
  const hasPronunciationSignal = Number(pronunciation.sample_count) >= 3;

  // Never-shame gate: zero lessons AND zero books -> a wholly different,
  // number-free welcome card. This check happens INSIDE the pure function
  // so no caller can accidentally skip it.
  const isStarter = !completedPacks && !completedBooks;

  const studentName = escapeHtml(data?.studentName || '');
  const seasonNameVi = escapeHtml(data?.seasonNameVi || '');
  const seasonEmoji = data?.seasonEmoji || '';
  const fromVi = formatDateVi(data?.seasonFrom);
  const toVi = formatDateVi(data?.seasonTo);

  const eyebrow = isStarter ? 'THẺ KHỞI ĐỘNG' : (honorsRank ? 'GIẤY KHEN' : 'PHIẾU KHEN THƯỞNG');

  const statChips = [];
  if (completedBooks) statChips.push({ label: 'Sách đã đọc', value: `${formatInt(completedBooks)} cuốn` });
  if (completedPacks) statChips.push({ label: 'Bài học hoàn thành', value: `${formatInt(completedPacks)} bài` });
  if (currentLevelLabel) statChips.push({ label: 'Cấp độ hiện tại', value: currentLevelLabel });
  if (streakDays) statChips.push({ label: 'Chuỗi ngày học', value: `${formatInt(streakDays)} ngày` });
  if (diamonds) statChips.push({ label: 'Kim cương tích lũy', value: `${formatInt(diamonds)} 💎` });
  if (totalXp) statChips.push({ label: 'Điểm kinh nghiệm', value: `${formatInt(totalXp)} XP` });
  if (hasPronunciationSignal) {
    statChips.push({ label: 'Phát âm trung bình', value: `${formatInt(pronunciationPercent)}%` });
  } else {
    statChips.push({ label: 'Phát âm trung bình', value: 'Cần thêm bài để đo chính xác', isText: true });
  }

  const chipsHtml = statChips
    .map(
      (chip) => `
      <div class="fx-chip${chip.isText ? ' fx-chip--text' : ''}">
        <span class="fx-chip-value">${escapeHtml(chip.value)}</span>
        <span class="fx-chip-label">${escapeHtml(chip.label)}</span>
      </div>`,
    )
    .join('');

  const seasonLine = isStarter
    ? `Mùa ${seasonEmoji} ${seasonNameVi}`.trim()
    : `Mùa ${seasonEmoji} ${seasonNameVi}${fromVi && toVi ? ` &middot; ${fromVi} – ${toVi}` : ''}`.trim();

  const bodyMain = isStarter
    ? `
      <p class="fx-subtitle">Chào mừng con đến với Mùa Phiêu Lưu 🗺️</p>
      <p class="fx-starter-copy">
        Hành trình đọc sách của con vừa mới bắt đầu. Mỗi trang sách, mỗi bài
        luyện nói là một bước phiêu lưu mới — Read2Lead sẽ luôn đồng hành
        cùng con trên chặng đường này.
      </p>`
    : `
      <p class="fx-subtitle">đã đồng hành cùng Read2Lead trong suốt mùa hè, luyện đọc và luyện nói mỗi ngày</p>
      <div class="fx-stats">${chipsHtml}</div>`;

  const ribbonHtml = !isStarter && honorsRank ? `<div class="fx-ribbon">${buildRibbonSvg(honorsRank)}</div>` : '';

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<title>Giấy khen — ${studentName}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css?family=Manrope:500,700,800|Inter:400,500,600&subset=vietnamese&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; }
  @page { size: A4 ${orientation}; margin: 0; }
  html, body {
    margin: 0; padding: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  body {
    font-family: 'Inter', 'Noto Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  }
  .fx-page {
    position: relative;
    width: ${dims.w}mm;
    height: ${dims.h}mm;
    overflow: hidden;
    background:
      radial-gradient(120% 100% at 50% -10%, #1d3f58 0%, #10273a 60%),
      linear-gradient(180deg, #10273a 0%, #0d2032 100%);
    color: #f5e6c8;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .fx-inner {
    position: relative;
    width: calc(100% - 20mm);
    height: calc(100% - 20mm);
    border: 1.4pt solid #c88f38;
    border-radius: 6mm;
    padding: ${orientation === 'landscape' ? '10mm 16mm' : '12mm 12mm'};
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    background: color-mix(in srgb, #17354a 55%, transparent);
  }
  .fx-inner::before {
    content: '';
    position: absolute;
    inset: 4mm;
    border: 0.6pt solid #f2cc7e;
    border-radius: 4mm;
    opacity: 0.6;
    pointer-events: none;
  }
  .fx-corner {
    position: absolute;
    width: 14mm;
    height: 14mm;
    pointer-events: none;
  }
  .fx-corner-svg { display: block; width: 100%; height: 100%; }
  .fx-corner--tl { top: 0; left: 0; }
  .fx-corner--tr { top: 0; right: 0; transform: scaleX(-1); }
  .fx-corner--bl { bottom: 0; left: 0; transform: scaleY(-1); }
  .fx-corner--br { bottom: 0; right: 0; transform: scale(-1, -1); }
  .fx-crest { display: block; margin: 0 auto 3mm; }
  .fx-eyebrow {
    font-family: 'Manrope', sans-serif;
    font-weight: 700;
    letter-spacing: 0.35em;
    font-size: 12pt;
    color: #f2cc7e;
    margin: 0 0 3mm;
  }
  .fx-name {
    font-family: 'Manrope', sans-serif;
    font-weight: 800;
    font-size: ${orientation === 'landscape' ? '34pt' : '30pt'};
    line-height: 1.12;
    color: #f5e6c8;
    margin: 0 0 4mm;
    max-width: 90%;
  }
  .fx-subtitle {
    font-size: 12.5pt;
    color: #d9c7a4;
    max-width: 78%;
    line-height: 1.55;
    margin: 0 0 6mm;
  }
  .fx-starter-copy {
    font-size: 12pt;
    color: #d9c7a4;
    max-width: 72%;
    line-height: 1.7;
    margin: 0;
  }
  .fx-season {
    font-size: 11pt;
    letter-spacing: 0.04em;
    color: #f2cc7e;
    margin: 0 0 5mm;
  }
  .fx-stats {
    display: flex;
    flex-wrap: wrap;
    align-items: stretch;
    justify-content: center;
    gap: 3mm;
    max-width: 100%;
    margin-bottom: 2mm;
  }
  .fx-chip {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-width: 30mm;
    padding: 3mm 4mm;
    border: 0.6pt solid rgba(242, 204, 126, 0.45);
    border-radius: 3mm;
    background: rgba(16, 39, 58, 0.35);
  }
  .fx-chip-value {
    font-family: 'Manrope', sans-serif;
    font-weight: 800;
    font-size: 13pt;
    color: #f2cc7e;
  }
  .fx-chip--text .fx-chip-value {
    font-size: 9.5pt;
    font-weight: 600;
    color: #d9c7a4;
  }
  .fx-chip-label {
    font-size: 8pt;
    color: #aa9673;
    margin-top: 1mm;
    letter-spacing: 0.02em;
  }
  .fx-ribbon {
    position: absolute;
    top: -6mm;
    right: 10mm;
    transform: rotate(6deg);
    filter: drop-shadow(0 3mm 3mm rgba(0,0,0,0.35));
  }
  .fx-ribbon-svg { display: block; width: 26mm; height: auto; }
  .fx-signoff {
    position: absolute;
    left: 12mm;
    right: 12mm;
    bottom: 8mm;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
  }
  .fx-signoff-seal { display: flex; flex-direction: column; align-items: center; gap: 1.5mm; }
  .fx-seal-svg { width: 18mm; height: 18mm; }
  .fx-signoff-caption { font-size: 7.5pt; color: #aa9673; }
  .fx-signoff-date {
    font-size: 9.5pt;
    color: #d9c7a4;
    align-self: center;
  }
  .fx-signoff-sign { display: flex; flex-direction: column; align-items: center; }
  .fx-signoff-name {
    font-family: 'Manrope', sans-serif;
    font-weight: 700;
    font-size: 16pt;
    color: #f5e6c8;
    transform: skewX(-8deg);
    letter-spacing: 0.02em;
  }
  .fx-signoff-line {
    width: 34mm;
    border-top: 0.8pt solid #c88f38;
    margin: 1.5mm 0 1mm;
  }
  .fx-signoff-title { font-size: 7.5pt; letter-spacing: 0.06em; color: #aa9673; }
</style>
</head>
<body>
  <div class="fx-page">
    <div class="fx-inner">
      <div class="fx-corner fx-corner--tl">${buildCornerFlourishSvg()}</div>
      <div class="fx-corner fx-corner--tr">${buildCornerFlourishSvg()}</div>
      <div class="fx-corner fx-corner--bl">${buildCornerFlourishSvg()}</div>
      <div class="fx-corner fx-corner--br">${buildCornerFlourishSvg()}</div>
      ${ribbonHtml}
      ${buildCrestSvg({ size: orientation === 'landscape' ? 118 : 108 })}
      <p class="fx-eyebrow">${eyebrow}</p>
      <h1 class="fx-name">${studentName}</h1>
      ${bodyMain}
      ${!isStarter ? `<p class="fx-season">${seasonLine}</p>` : ''}
      <div class="fx-signoff">
        <div class="fx-signoff-seal">
          ${buildSealSvg()}
        </div>
        <div class="fx-signoff-date">${isStarter ? seasonLine : `TP.HCM, ${toVi || fromVi}`}</div>
        <div class="fx-signoff-sign">
          <div class="fx-signoff-name">Felix</div>
          <div class="fx-signoff-line"></div>
          <div class="fx-signoff-title">NGƯỜI SÁNG LẬP READ2LEAD</div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
