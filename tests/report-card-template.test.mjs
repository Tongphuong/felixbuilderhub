import test from 'node:test';
import assert from 'node:assert/strict';

import { renderCertificateHtml, STARTER_HEADLINE_VI } from '../scripts/report-card-template.mjs';

/**
 * Bite tests for the never-shame rule (AGENTS.md §5), enforced INSIDE
 * renderCertificateHtml() so no caller can accidentally bypass it:
 *   - a zero stat is omitted entirely, never rendered as "0"
 *   - pronunciation with < 3 samples shows no "%" and no bar
 *   - zero packs AND zero books renders the "Thẻ khởi động" welcome card
 *     with no numeric stats at all
 *   - no rank/position/comparison anywhere except the top-3 ribbon
 */

const SEASON = { seasonNameVi: 'Amazing Summer', seasonEmoji: '🌞', seasonFrom: '2026-07-01', seasonTo: '2026-08-31' };

/**
 * Plain visible text only — strips <style> (CSS uses "%" for gradients/widths
 * constantly) and <svg> (decorative fills/sizes use "%"/hex colors like
 * "#10273a", which false-positive against a naive "#\d" or "%" scan) before
 * stripping remaining tags. Assertions about what a PARENT would actually see
 * on the printed page run against this, not the raw HTML/CSS source.
 */
function visibleText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&middot;/g, '·')
    .replace(/\s+/g, ' ');
}

function fullData(overrides = {}) {
  return {
    studentName: 'Nguyễn Minh Ánh',
    ...SEASON,
    honorsRank: null,
    stats: {
      completedBooks: 12,
      completedPacks: 8,
      diamonds: 3200,
      totalXp: 420,
      streakDays: 5,
      currentLevelLabel: 'Vàng',
    },
    pronunciation: { percent: 82, sample_count: 6 },
    ...overrides,
  };
}

function zeroData(overrides = {}) {
  return {
    studentName: 'Minhdt',
    ...SEASON,
    honorsRank: null,
    stats: {
      completedBooks: 0,
      completedPacks: 0,
      diamonds: 0,
      totalXp: 0,
      streakDays: 0,
      currentLevelLabel: null,
    },
    pronunciation: { percent: null, sample_count: 0 },
    ...overrides,
  };
}

test('renders a complete document with the child\'s real name, full diacritics', () => {
  const html = renderCertificateHtml(fullData(), { orientation: 'landscape' });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Nguyễn Minh Ánh/);
  assert.match(html, /ươ|ề|ệ|ạ|ự/); // deliberately checks a Vietnamese diacritic string, not just ASCII
});

test('both orientations set the correct @page size and are pure (identical input -> identical output)', () => {
  const landscape = renderCertificateHtml(fullData(), { orientation: 'landscape' });
  const portrait = renderCertificateHtml(fullData(), { orientation: 'portrait' });
  assert.match(landscape, /@page \{ size: A4 landscape; margin: 0; \}/);
  assert.match(portrait, /@page \{ size: A4 portrait; margin: 0; \}/);
  assert.notEqual(landscape, portrait);

  const again = renderCertificateHtml(fullData(), { orientation: 'landscape' });
  assert.equal(landscape, again, 'same data + same orientation must render byte-identical output (pure function)');
});

test('a populated student certificate never renders a standalone "0" stat', () => {
  const html = renderCertificateHtml(fullData({ stats: { ...fullData().stats, streakDays: 0, totalXp: 0 } }));
  // No stat chip may show a bare zero value.
  assert.doesNotMatch(html, />0 ngày</);
  assert.doesNotMatch(html, />0 XP</);
  // streakDays=0 must not appear as a chip at all (label absent too).
  assert.doesNotMatch(html, /Chuỗi ngày học/);
  assert.doesNotMatch(html, /Điểm kinh nghiệm/);
});

test('pronunciation with fewer than 3 samples shows no percentage — the encouragement line instead', () => {
  const html = renderCertificateHtml(fullData({ pronunciation: { percent: 40, sample_count: 2 } }));
  assert.doesNotMatch(visibleText(html), /%/);
  assert.match(html, /Cần thêm bài để đo chính xác/);
});

test('pronunciation with >= 3 samples shows the real percentage', () => {
  const html = renderCertificateHtml(fullData({ pronunciation: { percent: 91, sample_count: 3 } }));
  assert.match(html, /91%/);
  assert.doesNotMatch(html, /Cần thêm bài để đo chính xác/);
});

test('BITE: zero packs AND zero books -> Thẻ khởi động, no %, no standalone 0 stat, name still shown', () => {
  const html = renderCertificateHtml(zeroData());
  assert.match(html, new RegExp(STARTER_HEADLINE_VI, 'i'));
  assert.match(html, /Minhdt/);
  assert.doesNotMatch(visibleText(html), /%/);
  assert.doesNotMatch(html, /<div class="fx-stats">/); // the whole stats band is absent, not just zeroed
  // No performance stat (packs/books/diamonds/xp/streak/pronunciation) is
  // visible anywhere — the only surviving digit is the "2" in the
  // "READ2LEAD" brand name in the footer signature block, which is not a
  // stat and cannot shame a child by itself.
  assert.doesNotMatch(visibleText(html).replace(/read2lead/gi, ''), /\d/);
  assert.doesNotMatch(html, /<div class="fx-ribbon">/); // no rank even if honorsRank were (impossibly) set
});

test('zero books but nonzero packs is NOT the starter card (only both-zero triggers it)', () => {
  const html = renderCertificateHtml(zeroData({ stats: { ...zeroData().stats, completedPacks: 2 } }));
  assert.doesNotMatch(html, new RegExp(STARTER_HEADLINE_VI, 'i'));
  assert.match(html, /Bài học hoàn thành/);
});

test('the top-3 ribbon appears ONLY for a real honorsRank 1/2/3, never implies rank otherwise', () => {
  const noRank = renderCertificateHtml(fullData({ honorsRank: null }));
  const rank1 = renderCertificateHtml(fullData({ honorsRank: 1 }));
  const rank2 = renderCertificateHtml(fullData({ honorsRank: 2 }));
  const rank3 = renderCertificateHtml(fullData({ honorsRank: 3 }));

  assert.doesNotMatch(noRank, /<div class="fx-ribbon">/);
  assert.match(rank1, /<div class="fx-ribbon">/);
  assert.match(rank1, /HẠNG NHẤT/);
  assert.match(rank2, /HẠNG NHÌ/);
  assert.match(rank3, /HẠNG BA/);

  // Eyebrow differs (GIẤY KHEN for honors vs PHIẾU KHEN THƯỞNG otherwise),
  // but that alone cannot leak a specific numeric rank/position/percentile.
  assert.match(noRank, />PHIẾU KHEN THƯỞNG</);
  assert.match(rank1, />GIẤY KHEN</);
  assert.doesNotMatch(noRank, /HẠNG/);
});

test('an invalid/out-of-range honorsRank (e.g. 4, 0, negative) is treated as no rank', () => {
  for (const bad of [0, 4, -1, 'first', undefined]) {
    const html = renderCertificateHtml(fullData({ honorsRank: bad }));
    assert.doesNotMatch(html, /<div class="fx-ribbon">/, `honorsRank=${bad} must not render a ribbon`);
  }
});

test('escapes HTML-significant characters in the student name (defensive, even though names are trusted KV data)', () => {
  const html = renderCertificateHtml(fullData({ studentName: '<b>Ánh</b> & "Con"' }));
  assert.doesNotMatch(html, /<b>Ánh<\/b>/);
  assert.match(html, /&lt;b&gt;/);
  assert.match(html, /&amp;/);
});

test('season dates are omitted from the starter card (zero numbers on the page)', () => {
  const html = renderCertificateHtml(zeroData());
  assert.doesNotMatch(html, /01\/07\/2026/);
  assert.doesNotMatch(html, /31\/08\/2026/);
});
