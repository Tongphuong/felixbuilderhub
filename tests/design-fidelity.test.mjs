// Bite tests (rule 28) for the fidelity harness scripts/design/fidelity.mjs.
// A harness that cannot fail looks exactly like a harness with nothing to complain about,
// so every check below is fed a known-BAD page and must flag THAT check by name; known-GOOD
// pages must pass everything (positive controls).
//
// Fast part (default): a synthetic mock + ~50 built-page variants served from a local http server
// in ONE browser launch, plus a second launch for the state-verification driver. Real-design part:
// the real home mock rendered against itself must give a pixel diff of exactly 0.
// Opt-in part (DESIGN_BITE_NAVY=1, scripts/design/bite-navy.sh): TODAY's navy home, served by
// scripts/r2l-release/rehearse.mjs, must FAIL the real home-first-visit contract.
// No Chrome: the test FAILS loudly, except when CI is set (then it skips with an explicit message).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { runFidelity, findChrome, InfraError, effectiveAnchors } from '../scripts/design/fidelity.mjs';
import { sampleBackdrop } from '../scripts/design/lib/text.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL_DESIGN = path.join(root, '_design', 'read2lead-dao-phieu-luu');
const FONTS_DIR = path.join(REAL_DESIGN, 'design-system', 'fonts');
const GOTO = path.join(root, 'scripts', 'design', 'drivers', 'goto-path.mjs');

let chromeMissing = null;
try { findChrome(); } catch (e) { chromeMissing = e; }
const skipNoChrome = t => {
  if (!chromeMissing) return false;
  if (process.env.CI) { t.skip('no Chrome binary found and CI is set: ' + chromeMissing.message); return true; }
  throw chromeMissing; // locally: FAIL loudly (rule 28b)
};

// ---- synthetic page factory ---------------------------------------------------------
const IMG = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
function page(o = {}) {
  const mk = id => (o.marks === false ? '' : ` data-design="${id}"`);
  const fontLink = o.fontsHref ? `<link rel="stylesheet" href="${o.fontsHref}">` : '';
  const top = o.topSmall
    ? `<header style="height:60px;padding:16px"><p${mk('t.top')} style="margin:0;width:150px;height:20px">Xin chào</p></header>`
    : `<header${mk('t.top')} style="height:60px;padding:16px"><p style="margin:0">Xin chào</p></header>`;
  const heroStyle = `height:${o.heroH || 200}px;padding:16px;${o.shift ? 'margin-top:' + o.shift + 'px;' : ''}${o.lowContrast ? 'color:#aaa;background:#fff;' : ''}${o.gradient === 'low' ? 'background:linear-gradient(#fff,#fff);color:#ccc;' : ''}${o.gradient === 'ok' ? 'background:linear-gradient(#17324D,#17324D);color:#fff;' : ''}`;
  const spacer = o.push ? `<div style="height:${o.push}px"></div>` : '';
  const hero = `${spacer}<main${mk('t.hero')} style="${heroStyle}">${o.heroBlank ? '' : o.heroRed ? '<div style="height:150px;background:#d33"></div>' : `<h2 style="margin:0${o.wrongFont ? ';font-family:Arial' : ''}">Đọc truyện nào</h2>`}</main>`;
  const pStyle = `display:block;height:${o.primaryH || 64}px;line-height:${o.primaryH || 64}px;background:#FFC83D;text-align:center`;
  const primary = o.noPrimary ? '' : `<a href="#" role="button"${mk('t.primary')} style="${pStyle}${o.primaryFont ? ';font-family:' + o.primaryFont : ''}">${o.ellipsisPrimary ? '<span style="display:block;margin:0 auto;width:40px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Mở truyện</span>' : 'Mở truyện'}</a>`
    + (o.dupPrimary ? `<a href="#" role="button"${mk('t.primary')} style="${pStyle}">Mở truyện</a>` : '');
  const footInner = {
    alt: `<img alt="Dành cho ba mẹ" width="1" height="1" src="${IMG}">`,
    tiny: '<p style="margin:0;font-size:8px">Dành cho ba mẹ</p>',
    clipzero: '<div style="width:0;height:0;overflow:hidden"><p style="margin:0">Dành cho ba mẹ</p></div>',
    same: '<p style="margin:0;color:#9BDDFF">Dành cho ba mẹ</p>',
    offscreen: '<p style="margin:0;position:absolute;left:-9999px">Dành cho ba mẹ</p>',
    opacity0: '<p style="margin:0;opacity:0">Dành cho ba mẹ</p>',
    clippath: '<p style="margin:0;clip-path:inset(100%)">Dành cho ba mẹ</p>',
    indent: '<p style="margin:0;width:100px;overflow:hidden;white-space:nowrap;text-indent:-9999px">Dành cho ba mẹ</p>',
  }[o.footMode] || '<p style="margin:0">Dành cho ba mẹ</p>';
  const foot = o.dropFoot ? '' : `<footer${mk('t.foot')} style="height:60px;padding:16px"${o.footMode === 'alt' ? ' aria-label="Dành cho ba mẹ"' : ''}>${footInner}</footer>`;
  const seq = o.swap ? [top, foot, hero, primary] : [top, hero, primary, foot];
  const chip = `<span class="chip" style="position:absolute;top:12px;right:8px;padding:0 6px;font-size:14px;line-height:20px${o.chipFont ? ';font-family:' + o.chipFont : ''}">3</span>`;
  const cols = o.cols ? `<div style="display:flex"><div${o.marks === false ? '' : ' data-design-col'} style="flex:1">a</div>${o.cols > 1 ? `<div data-design-col style="flex:1">b</div>` : ''}</div>` : '';
  const extra = (o.sunButton ? '<a href="#" style="display:block;height:48px;line-height:48px;background:#FFC83D;text-align:center">Thêm</a>' : '')
    + (o.sunGradient ? '<a href="#" style="display:block;width:20px;height:48px;background:linear-gradient(#FFC83D,#FFC83D)">g</a>' : '')
    + (o.sunOnclick ? '<div onclick="void 0" style="width:20px;height:48px;background:#FFC83D">o</div>' : '')
    + (o.sunCursor ? '<div style="width:20px;height:48px;background:#FFC83D;cursor:pointer">c</div>' : '')
    + (o.selectedTab ? '<div role="tablist"><a href="#" role="tab" aria-selected="true" style="display:inline-block;height:48px;line-height:48px;width:60px;background:#FFC83D">XP</a><a href="#" role="tab" aria-selected="false" style="display:inline-block;height:48px;line-height:48px;width:60px;background:#fff">Kim</a></div>' : '')
    + (o.pressedToggle ? '<div role="toolbar"><button type="button" aria-pressed="true" style="height:48px;width:60px;background:#FFC83D;font-family:inherit">Mũ</button><button type="button" style="height:48px;width:60px;background:#fff;font-family:inherit">Nón</button></div>' : '')
    + (o.radioGroup ? '<div role="radiogroup"><button type="button" role="radio" aria-checked="true" style="height:48px;width:60px;background:#FFC83D;font-family:inherit">Mũ</button><button type="button" role="radio" aria-checked="false" style="height:48px;width:60px;background:#fff;font-family:inherit">Nón</button></div>' : '')
    + (o.checkedInput ? '<label style="display:block;width:60px;height:48px;background:#FFC83D"><input type="checkbox" checked>Mũ</label>' : '')
    // ABUSE: a second sun ACTION wearing a selected-state attribute (Buffet HIGH, 2026-10-20)
    + (o.abuse === 'pressed-button' ? '<button type="button" aria-pressed="true" style="display:block;height:48px;line-height:48px;background:#FFC83D;text-align:center;width:100%;font-family:inherit">Mua ngay</button>' : '')
    + (o.abuse === 'current-link' ? '<a href="#" aria-current="true" style="display:block;height:48px;line-height:48px;background:#FFC83D;text-align:center;width:100%;font-family:inherit">Xoá hết</a>' : '')
    + (o.abuse === 'current-li-descendant' ? '<ul style="margin:0;padding:0;list-style:none"><li aria-current="step"><a href="#" style="display:block;height:48px;line-height:48px;background:#FFC83D;text-align:center;width:100%;font-family:inherit">Xoá hết</a></li></ul>' : '')
    + (o.abuse === 'submit-pressed' ? '<form><input type="submit" value="Gửi" aria-pressed="true" style="display:block;height:48px;line-height:48px;background:#FFC83D;text-align:center;width:100%;font-family:inherit;border:0"></form>' : '')
    + (o.abuse === 'submit-button-in-group' ? '<form><div role="toolbar"><button type="submit" aria-pressed="true" style="display:block;height:48px;line-height:48px;background:#FFC83D;text-align:center;width:100%;font-family:inherit">Gửi</button></div></form>' : '')
    + (o.abuse === 'toolbar-lone' ? '<div role="toolbar"><button type="button" aria-pressed="true" style="display:block;height:48px;line-height:48px;background:#FFC83D;text-align:center;width:100%;font-family:inherit">Mua ngay</button></div>' : '')
    + (o.abuse === 'toolbar-allsun' ? '<div role="toolbar"><button type="button" aria-pressed="true" style="display:block;height:48px;line-height:48px;background:#FFC83D;text-align:center;width:100%;font-family:inherit">Mua ngay</button><button type="button" aria-pressed="true" style="display:block;height:48px;line-height:48px;background:#FFC83D;text-align:center;width:100%;font-family:inherit">Xoá hết</button></div>' : '')
    + (o.abuse === 'toolbar-link' ? '<div role="toolbar"><a href="/buy" aria-current="true" style="display:block;height:48px;line-height:48px;background:#FFC83D;text-align:center;width:100%;font-family:inherit">Mua ngay</a></div>' : '')
    + (o.abuse === 'form-typeless' ? '<form><button aria-pressed="true" style="display:block;height:48px;line-height:48px;background:#FFC83D;text-align:center;width:100%;font-family:inherit">Gửi</button></form>' : '')
    + (o.abuse === 'tablist-two-selected' ? '<div role="tablist"><a href="#" role="tab" aria-selected="true" style="display:block;height:48px;line-height:48px;background:#FFC83D;text-align:center;width:100%;font-family:inherit">A</a><a href="#" role="tab" aria-selected="true" style="display:block;height:48px;line-height:48px;background:#FFC83D;text-align:center;width:100%;font-family:inherit">B</a><a href="#" role="tab" aria-selected="false" style="display:block;height:48px;background:#fff">C</a></div>' : '')
    + (o.abuse === 'tab-outside-tablist' ? '<a href="#" role="tab" aria-selected="true" style="display:block;height:48px;line-height:48px;background:#FFC83D;text-align:center;width:100%;font-family:inherit">Mua</a>' : '')
    + (o.plainButtonFont ? '<button type="button" style="height:48px;width:90px;font-family:' + o.plainButtonFont + '">Nút</button>' : '')
    + (o.unselectedSunTab ? '<div role="tablist"><a href="#" role="tab" aria-selected="false" style="display:inline-block;height:48px;line-height:48px;width:60px;background:#FFC83D">XP</a></div>' : '')
    + (o.sunBar ? '<div style="width:20px;height:10px;background:#FFC83D"></div>' : '')
    + (o.wide ? '<div style="width:900px;height:10px;background:red"></div>' : '')
    + (o.smallTap ? '<a href="#" style="display:block;height:30px">nhỏ xíu</a>' : '')
    + (o.anim === 'bad' ? '<div style="width:10px;height:10px;background:#000;animation:spin 1s linear infinite"></div>' : '')
    + (o.anim === 'safe' ? '<div class="s" style="width:10px;height:10px;background:#000"></div>' : '')
    + (o.animZero ? '<div style="width:10px;height:10px;background:#000;animation:fade 0s both"></div>' : '')
    // The mover steps 7px per frame and wraps at 289 (7 and 289 share no factor), so two samples differ unless EXACTLY a multiple of 289 frames
    // (~4.8 s at 60 Hz) lie between them. It used to step 3px and wrap at 120 = every 40 frames (~667 ms at 60 Hz): when load stretched the harness's
    // ~370 ms sample gap towards 667 ms the two samples were identical, the check saw "no motion" and this case flaked red. (R2L-MAINT-1 D6.)
    + (o.raf ? '<div id="m" style="width:10px;height:10px;background:#000"></div><script>let x=0;const d=document.getElementById("m");(function f(){x=(x+7)%289;d.style.marginLeft=x+"px";requestAnimationFrame(f)})()</script>' : '')
    + (o.svgLow ? '<svg width="200" height="40" style="display:block"><rect width="200" height="40" fill="#fff"/><text x="4" y="28" fill="#ddd" font-size="20">Sáng chói</text></svg>' : '')
    + (o.lineOverlap != null ? `<div style="position:relative"><p id="l1" style="margin:0;font:700 24px/24px sans-serif">Gg Ứỹ lọc</p><p id="l2" style="margin:0;font:700 24px/24px sans-serif">Ếg Ứỹ lọc</p></div><script>(function(){const c=document.createElement('canvas').getContext('2d');c.font='700 24px sans-serif';const m=c.measureText('Gg Ứỹ lọc'),n=c.measureText('Ếg Ứỹ lọc');const asc=n.actualBoundingBoxAscent,desc=m.actualBoundingBoxDescent;document.getElementById('l2').style.marginTop=((asc+desc-(${o.lineOverlap}))-24)+'px';})()</script>` : '')
    + (o.ellipsisPrimary ? '' : '')
    + (o.ellipsisName ? '<ul style="margin:0;padding:0;list-style:none"><li style="width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Bạn có một cái tên dài</li></ul>' : '')
    + (o.staticClip ? '<div style="position:relative;height:0"><p style="margin:0;position:relative;top:-70px;left:16px;width:200px;clip:rect(0,0,0,0)">Hiện dù có clip</p></div>' : '')
    + (o.srOnly ? '<div style="position:relative;height:0"><p style="margin:0;position:absolute;top:-70px;left:16px;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">Chỉ đọc</p></div>' : '')
    + (o.layoutOverlap ? '<div style="position:relative;height:0"><p style="position:absolute;top:-70px;left:16px;margin:0">Chồng chữ</p></div>' : '')
    + (o.layoutEscape ? '<div style="border:2px solid #17324D;width:120px;padding:4px"><button style="width:300px;height:48px;font-family:inherit">Nút tràn</button></div>' : '')
    + (o.layoutMidword ? '<div style="width:60px;word-break:break-all">Xin chào các bạn</div>' : '')
    + (o.layoutClipped ? '<div style="width:80px;height:24px;overflow:hidden;white-space:nowrap">Một dòng chữ rất dài bị cắt</div>' : '')
    + (o.layoutEllipsis ? '<div style="width:80px;height:24px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">Một dòng chữ rất dài bị cắt</div>' : '')
    + (o.belowFar ? '<div style="height:600px"></div><div style="height:300px;background:#d33"></div><i data-design="t.below" style="display:block;height:1px"></i>' : '')
    + (o.below === 'big' ? '<div style="height:600px;background:#d33"></div>' : '')
    + (o.below === 'small' ? '<div style="height:100px;background:#d33"></div>' : '')
    + (o.fakeMarks ? ['t.top', 't.hero', 't.primary', 't.foot'].map(id => `<i data-design="${id}" style="display:block;height:1px"></i>`).join('') : '');
  const stillCss = o.stillBad ? '.still main{padding:40px !important}' : '';
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width">${fontLink}
<style>body{margin:0;background:#9BDDFF;font:700 18px/1.3 'Nunito',sans-serif;color:#17324D}
h2,a[role=button],.chip{font-family:'Baloo 2',sans-serif}
@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@keyframes fade{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:no-preference){.s{animation:spin 1s linear infinite}}${stillCss}</style>
<body>${chip}${seq.join('')}${cols}${extra}</body></html>`;
}

// name -> [factory options, expectation]. Expectation: array = EXACT set of failing checks;
// {must, may} = `must` all fail, nothing outside must+may fails.
const V = {
  ok: [{}, []],
  'missing-text': [{ dropFoot: true }, ['texts', 'order', 'geometry', 'pixel-diff']],
  'wrong-order': [{ swap: true }, ['order', 'geometry', 'pixel-diff']],
  'two-primary': [{ dupPrimary: true }, { must: ['primary'], may: ['pixel-diff', 'geometry'] }],
  'no-primary': [{ noPrimary: true }, ['order', 'texts', 'primary', 'geometry', 'pixel-diff']],
  'short-primary': [{ primaryH: 40 }, { must: ['primary', 'tap>=48px'], may: ['pixel-diff', 'geometry'] }],
  'wrong-columns': [{ cols: 1 }, ['columns']],
  'right-columns': [{ cols: 2 }, []],
  overflow: [{ wide: true }, { must: ['no-h-scroll@360/390/768/1024/1280'], may: ['pixel-diff'] }],
  'low-contrast': [{ lowContrast: true }, ['contrast>=4.5', 'pixel-diff']],
  'small-tap': [{ smallTap: true }, ['tap>=48px']],
  'anim-running': [{ anim: 'bad' }, ['reduced-motion']],
  'anim-safe': [{ anim: 'safe' }, []],
  perturbed: [{ shift: 8 }, ['pixel-diff']],
  // --- sun rule: every clickable thing counts, non-interactive sun fills do not
  'two-sun-buttons': [{ sunButton: true }, ['primary', 'pixel-diff']],
  'sun-gradient-link': [{ sunGradient: true }, { must: ['primary'], may: ['pixel-diff'] }],
  'sun-onclick-div': [{ sunOnclick: true }, { must: ['primary'], may: ['pixel-diff'] }],
  'sun-cursor-div': [{ sunCursor: true }, { must: ['primary'], may: ['pixel-diff'] }],
  'sun-button-plus-sun-bar': [{ sunBar: true }, []],
  // --- blocker 1: below the fold
  'below-fold-huge': [{ below: 'big' }, ['height', 'pixel-diff']],
  'below-fold-small': [{ below: 'small' }, ['pixel-diff']], // height ok (<= 120px), but the extra area is DIFFED
  // --- blocker 2: text must be VISIBLE text nodes
  'text-alt-only': [{ footMode: 'alt' }, { must: ['texts'], may: ['pixel-diff'] }],
  'text-tiny-font': [{ footMode: 'tiny' }, { must: ['texts'], may: ['pixel-diff'] }],
  'text-clipped-zero': [{ footMode: 'clipzero' }, { must: ['texts'], may: ['pixel-diff'] }],
  'text-same-colour': [{ footMode: 'same' }, { must: ['texts'], may: ['pixel-diff'] }],
  'text-offscreen': [{ footMode: 'offscreen' }, { must: ['texts'], may: ['pixel-diff'] }],
  'text-opacity-0': [{ footMode: 'opacity0' }, { must: ['texts'], may: ['pixel-diff'] }],
  'text-clip-path': [{ footMode: 'clippath' }, { must: ['texts'], may: ['pixel-diff'] }],
  'text-indent-away': [{ footMode: 'indent' }, { must: ['texts'], may: ['pixel-diff'] }],
  // --- blocker 3: contrast cannot be skipped
  'gradient-low-contrast': [{ gradient: 'low' }, { must: ['contrast>=4.5'], may: ['pixel-diff'] }],
  'gradient-good-contrast': [{ gradient: 'ok' }, { must: [], may: ['pixel-diff'] }],
  'svg-low-contrast': [{ svgLow: true }, { must: ['contrast>=4.5'], may: ['pixel-diff'] }],
  // --- major 7: reduced motion
  'raf-motion': [{ raf: true }, { must: ['reduced-motion'], may: ['pixel-diff', 'still-twin'] }],
  'zero-duration-fade-allowed': [{ animZero: true }, { must: [], may: ['pixel-diff'] }],
  'still-twin-differs': [{ stillBad: true }, ['still-twin']],
  // --- major 10: geometry vs the mock
  'fake-1px-marks': [{ marks: false, fakeMarks: true }, { must: ['order', 'geometry', 'primary'], may: ['pixel-diff'] }],
  'section-far-off': [{ shift: 60 }, { must: ['geometry'], may: ['pixel-diff'] }],
  'section-wrong-height': [{ heroH: 100 }, { must: ['geometry'], may: ['pixel-diff'] }],
  'section-slightly-off': [{ shift: 8 }, ['pixel-diff']],
  // --- major 11: fonts
  'wrong-heading-font': [{ wrongFont: true }, { must: ['fonts'], may: ['pixel-diff'] }],
  'unmarked-copy-of-mock': [{ marks: false }, ['order', 'primary', 'geometry']],
};
V['below-far'] = [{ belowFar: true }, { must: ['height', 'order'], may: ['pixel-diff'] }];
V['below-far-viewport'] = [{ belowFar: true }, []]; // contract capture:viewport: the same page passes
V['pushed-below-fold'] = [{ push: 700 }, { must: ['order', 'primary', 'geometry'], may: ['pixel-diff', 'texts'] }]; // build pushes the content off the screen
V['viewport-mock-below-fold'] = [{}, []]; // the MOCK itself has primary/footer below the fold (viewport 300): fine
V['region-ok'] = [{}, []];
V['region-empty'] = [{ heroBlank: true }, { must: ['region:t.hero'], may: ['texts', 'pixel-diff', 'geometry'] }];
V['region-wrong'] = [{ heroRed: true }, { must: ['region:t.hero'], may: ['texts', 'pixel-diff', 'geometry'] }];
V['region-no-element'] = [{ marks: false }, { must: ['region:t.hero'], may: ['order', 'primary', 'geometry'] }];
V['small-order-default'] = [{ topSmall: true }, ['order']];
V['small-order-override'] = [{ topSmall: true }, []];
V['layout-overlap'] = [{ layoutOverlap: true }, { must: ['layout-sanity'], may: ['pixel-diff', 'contrast>=4.5'] }];
V['layout-escape'] = [{ layoutEscape: true }, { must: ['layout-sanity'], may: ['pixel-diff', 'fonts'] }];
V['layout-midword'] = [{ layoutMidword: true }, { must: ['layout-sanity'], may: ['pixel-diff'] }];
V['layout-clipped'] = [{ layoutClipped: true }, { must: ['layout-sanity'], may: ['pixel-diff'] }];
V['layout-ellipsis'] = [{ layoutEllipsis: true }, { must: [], may: ['pixel-diff'] }]; // ellipsis truncation is by design: passes
V['lines-overlap-5px'] = [{ lineOverlap: 5 }, { must: ['layout-sanity'], may: ['pixel-diff', 'contrast>=4.5', 'fonts'] }];
V['lines-gap-8px'] = [{ lineOverlap: -8 }, { must: [], may: ['pixel-diff', 'fonts'] }];
V['ellipsis-primary-label'] = [{ ellipsisPrimary: true }, { must: ['layout-sanity'], may: ['pixel-diff'] }];
V['ellipsis-bound-name-in-list'] = [{ ellipsisName: true }, { must: [], may: ['pixel-diff'] }];
V['static-clip-is-not-hidden'] = [{ staticClip: true }, { must: ['layout-sanity'], may: ['pixel-diff'] }];
V['sr-only-clip-is-hidden'] = [{ srOnly: true }, { must: [], may: ['pixel-diff'] }];
V['sun-selected-tab'] = [{ selectedTab: true }, { must: [], may: ['pixel-diff'] }];            // the active tab is sun in the mocks: not a second action
V['sun-pressed-toggle'] = [{ pressedToggle: true }, { must: [], may: ['pixel-diff'] }];
V['sun-unselected-tab'] = [{ unselectedSunTab: true }, { must: ['primary'], may: ['pixel-diff'] }]; // a sun toggle that is NOT selected is a second action
V['sun-radio-in-group'] = [{ radioGroup: true }, { must: [], may: ['pixel-diff'] }];
V['sun-checked-input'] = [{ checkedInput: true }, { must: [], may: ['pixel-diff', 'tap>=48px'] }];
// the exemption is abusable: each of these is a SECOND sun action and must fail the one-sun rule
for (const a of ['pressed-button', 'current-link', 'current-li-descendant', 'submit-pressed', 'submit-button-in-group', 'tab-outside-tablist', 'toolbar-lone', 'toolbar-allsun', 'toolbar-link', 'form-typeless', 'tablist-two-selected']) V['abuse-' + a] = [{ abuse: a }, { must: ['primary'], may: ['pixel-diff'] }];
// fonts: classes the design CSS sets in Baloo 2 (and the mock renders so) must be Baloo; any real button must be a design family
V['wrong-chip-font'] = [{ chipFont: 'Arial' }, { must: ['fonts'], may: ['pixel-diff'] }];
V['wrong-plain-button-font'] = [{ plainButtonFont: 'Arial' }, { must: ['fonts'], may: ['pixel-diff'] }];
V['nunito-plain-button'] = [{ plainButtonFont: "'Nunito'" }, { must: [], may: ['pixel-diff'] }];
V['wrong-button-font'] = [{ primaryFont: 'Arial' }, { must: ['fonts'], may: ['pixel-diff'] }];     // primary/secondary buttons must be Baloo 2
V['no-fonts'] = [{ noFontLink: true }, { must: ['fonts'], may: ['pixel-diff'] }];

const ANCHORS = { 't.top': 'Xin chào', 't.hero': 'Đọc truyện nào', 't.primary': 'Mở truyện', 't.foot': 'Dành cho ba mẹ' };
const BASE_CONTRACT = {
  release: 0, mock: { 390: 'mocks/m.html' }, viewport: { 390: 700 },
  order: ['t.top', 't.hero', 't.primary', 't.foot'],
  texts: ['Xin chào', 'Đọc truyện nào', 'Mở truyện', 'Dành cho ba mẹ'],
  primary: { id: 't.primary', text: 'Mở truyện', min_height: { 390: 64 } },
  anchors: ANCHORS,
  diff_ceiling: { 390: 0.001 },
};

const failed = r => r.checks.filter(c => !c.pass).map(c => c.name);
const expectSet = exp => (Array.isArray(exp) ? { must: exp, may: [] } : exp);

function startServer() {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/fonts.css') { res.writeHead(200, { 'content-type': 'text/css' }).end(fs.readFileSync(path.join(FONTS_DIR, 'fonts.css'))); return; }
    if (url.endsWith('.woff2') && fs.existsSync(path.join(FONTS_DIR, path.basename(url)))) { res.writeHead(200, { 'content-type': 'font/woff2' }).end(fs.readFileSync(path.join(FONTS_DIR, path.basename(url)))); return; }
    const name = url.slice(1);
    const html = (b) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><meta charset="utf-8"><body style="font:18px sans-serif">${b}`);
    if (name === 'home-ok') return html('<h1>Chào <span>Minh</span>!</h1><a href="#">Mở truyện</a>');
    if (name === 'home-wrong-state') return html('<h1>Chào <span>Minh</span>!</h1><a href="#">Đọc tiếp</a>');
    if (name === 'home-anon') return html('<h1>Chào mừng</h1><a href="#">Mở truyện</a>');
    const v = V[name];
    if (!v) { res.writeHead(404).end('nope'); return; }
    const o = { ...v[0], fontsHref: v[0].noFontLink ? null : '/fonts.css' };
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page(o));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, base: 'http://127.0.0.1:' + server.address().port })));
}

function writeBindingDesign(tmp) {
  const design = path.join(tmp, 'design');
  fs.mkdirSync(path.join(design, 'mocks'), { recursive: true });
  fs.writeFileSync(path.join(design, 'mocks', 'm.html'), '<!doctype html><meta charset="utf-8"><body style="font:20px sans-serif"><h1>Chào Minh!</h1><p>55</p><p>Mũ tiệc</p>');
  return design;
}
function writeFixtureDesign(tmp) {
  const design = path.join(tmp, 'design');
  fs.mkdirSync(path.join(design, 'mocks'), { recursive: true });
  fs.writeFileSync(path.join(design, 'mocks', 'm.html'), page({ marks: false, fontsHref: 'file://' + path.join(FONTS_DIR, 'fonts.css') }));
  return design;
}

test('fixture: harness verdicts on known-good and known-bad pages', async t => {
  if (skipNoChrome(t)) return;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-fid-'));
  const { server, base } = await startServer();
  try {
    const design = writeFixtureDesign(tmp);
    const contracts = path.join(tmp, 'contracts');
    fs.mkdirSync(contracts);
    const wr = (id, extra) => fs.writeFileSync(path.join(contracts, id + '.json'), JSON.stringify({ ...BASE_CONTRACT, id, built: { path: '/' + (extra.__path || id), state: 'first-visit' }, ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== '__path')) }));
    for (const name of Object.keys(V)) {
      const cols = name === 'wrong-columns' || name === 'right-columns' ? { layout: { 390: { columns: 2 } } } : {};
      const extra = { ...cols };
      if (name.startsWith('region-')) extra.regions = [{ id: 't.hero', mock_box: { 390: [0, 92, 390, 232] }, ceiling: 0.05 }];
      if (name === 'below-far-viewport' || name === 'pushed-below-fold' || name === 'viewport-mock-below-fold') extra.capture = 'viewport';
      if (name === 'viewport-mock-below-fold') extra.viewport = { 390: 300 };
      if (name === 'below-far') { extra.order = ['t.top', 't.hero', 't.primary', 't.foot', 't.below']; extra.anchors_exempt = { 't.below': 'marker below the fold' }; }
      if (name.startsWith('small-order')) { extra.anchors = { 't.hero': 'Đọc truyện nào', 't.primary': 'Mở truyện', 't.foot': 'Dành cho ba mẹ' }; extra.anchors_exempt = { 't.top': 'small label inside the header card' }; }
      if (name === 'small-order-override') extra.min_size = { 't.top': [100, 16] };
      wr(name, extra);
    }
    wr('no-anchors', { __path: 'ok', anchors: undefined });
    const A3 = { 't.top': 'Xin chào', 't.hero': 'Đọc truyện nào', 't.primary': 'Mở truyện' };
    wr('exempt-ok', { __path: 'ok', anchors: A3, anchors_exempt: { 't.foot': 'plain text row, no card' } });
    wr('exempt-no-reason', { __path: 'ok', anchors: A3, anchors_exempt: { 't.foot': '  ' } });
    wr('neither-anchored-nor-exempt', { __path: 'ok', anchors: A3 });
    wr('all-exempt', { __path: 'ok', anchors: undefined, anchors_exempt: Object.fromEntries(['t.top', 't.hero', 't.primary', 't.foot'].map(id => [id, 'full-screen background, text resolves to the page'])) });
    // per-width: base anchors say the hero is at the mock's box; the 390 override REMOVES it (null) and exempts it
    wr('width-null-removal', { __path: 'ok', anchors: { ...ANCHORS, 't.hero': 'Không có chữ này' }, anchors_390: { 't.hero': null }, anchors_exempt_390: { 't.hero': 'no card at this width' } });
    wr('width-override-text', { __path: 'ok', anchors: { ...ANCHORS, 't.hero': 'Không có chữ này' }, anchors_390: { 't.hero': 'Đọc truyện nào' } });
    wr('width-no-override-bad-anchor', { __path: 'ok', anchors: { ...ANCHORS, 't.hero': 'Không có chữ này' } });
    wr('partial-anchors', { __path: 'ok', anchors: { 't.top': 'Xin chào' } });
    const report = await runFidelity({ design, contracts, base, out: path.join(tmp, 'out'), composites: 'fail', 'state-driver': GOTO, 'require-anchors': true, concurrency: 10 });
    const by = Object.fromEntries(report.results.map(r => [r.contract, r]));

    for (const [name, [, exp]] of Object.entries(V)) {
      await t.test(name, () => {
        const { must, may } = expectSet(exp);
        const got = failed(by[name]);
        for (const m of must) assert.ok(got.includes(m), `${name}: "${m}" must FAIL but did not. checks: ${JSON.stringify(by[name].checks.map(c => [c.name, c.pass, c.detail]))}`);
        const extra = got.filter(g => !must.includes(g) && !may.includes(g));
        assert.deepEqual(extra, [], `${name}: unexpected failing checks. ${JSON.stringify(by[name].checks.filter(c => !c.pass))}`);
        if (Array.isArray(exp)) assert.deepEqual([...got].sort(), [...exp].sort(), name);
      });
    }
    await t.test('(ii) mock against itself: ok page has exactly 0 differing pixels and everything passes', () => {
      assert.equal(by.ok.diff.pixels, 0);
      assert.deepEqual(failed(by.ok), []);
    });
    await t.test('(iii) required text removed => the TEXT check fails and names the string', () => {
      const c = by['missing-text'].checks.find(x => x.name === 'texts');
      assert.equal(c.pass, false);
      assert.match(c.detail, /Dành cho ba mẹ/);
    });
    await t.test('B1 below the fold: height check fails when built is >10%/120px taller; a smaller overshoot is still counted by the diff', () => {
      assert.match(by['below-fold-huge'].checks.find(c => c.name === 'height').detail, /built page 1\d{3}px vs mock 700px/);
      assert.equal(by['below-fold-small'].checks.find(c => c.name === 'height').pass, true);
      assert.ok(by['below-fold-small'].diff.fraction > 0.05, 'the extra 100px must be inside the diff area');
    });
    await t.test('B3 gradient backdrop is measured by pixel sampling, not skipped', () => {
      const g = by['gradient-good-contrast'].checks.find(c => c.name === 'contrast>=4.5');
      assert.equal(g.pass, true);
      assert.match(g.detail, /[1-9]\d* via pixel sampling/);
      assert.match(by['gradient-low-contrast'].checks.find(c => c.name === 'contrast>=4.5').detail, /Đọc truyện nào/);
      assert.match(by['svg-low-contrast'].checks.find(c => c.name === 'contrast>=4.5').detail, /Sáng chói.*svg/);
    });
    await t.test('M7 behavioural motion: a requestAnimationFrame mover is caught by the two-sample check', () => {
      assert.match(by['raf-motion'].checks.find(c => c.name === 'reduced-motion').detail, /pixels still changing between samples/);
    });
    await t.test('M10 --require-anchors: a contract with no anchors, or an order id without one, FAILS', () => {
      assert.deepEqual(failed(by['no-anchors']), ['anchors-present']);
      assert.match(by['no-anchors'].checks.find(c => c.name === 'anchors-present').detail, /neither anchored nor exempt: t\.top/);
      assert.deepEqual(failed(by['partial-anchors']), ['anchors-present']);
      assert.match(by['partial-anchors'].checks.find(c => c.name === 'anchors-present').detail, /t\.hero/);
    });
    await t.test('anchors_exempt: an exempt id passes; no reason fails; neither anchored nor exempt fails; all-exempt is allowed and reported pixel-only', () => {
      assert.deepEqual(failed(by['exempt-ok']), []);
      assert.match(by['exempt-ok'].checks.find(c => c.name === 'anchors-present').detail, /3 anchored, 1 exempt/);
      assert.deepEqual(failed(by['exempt-no-reason']), ['anchors-present']);
      assert.match(by['exempt-no-reason'].checks.find(c => c.name === 'anchors-present').detail, /exempt without a reason: t\.foot/);
      assert.deepEqual(failed(by['neither-anchored-nor-exempt']), ['anchors-present']);
      assert.match(by['neither-anchored-nor-exempt'].checks.find(c => c.name === 'anchors-present').detail, /neither anchored nor exempt: t\.foot/);
      assert.deepEqual(failed(by['all-exempt']), []);
      assert.ok(by['all-exempt'].warnings.some(w => /geometry: pixel-only/.test(w)));
      assert.ok(by['exempt-ok'].anchorBoxes['t.hero'].h > 0);
      const md = fs.readFileSync(path.join(tmp, 'out', 'report.md'), 'utf8');
      assert.match(md, /Geometry NOT checked \(anchors_exempt, as in force at this width\):\n- t\.foot: plain text row, no card/);
      assert.match(md, /WARN geometry: pixel-only/);
      assert.match(md, /Anchored mock boxes \(x, y, w, h\):\n- t\.top: 0, 0, 390, 92/);
    });
    await t.test('per-width anchors: null removal and override take effect; an unresolvable base anchor still fails', () => {
      assert.deepEqual(failed(by['width-null-removal']), []);
      assert.deepEqual(failed(by['width-override-text']), []);
      assert.deepEqual(failed(by['width-no-override-bad-anchor']), ['geometry']);
      assert.match(by['width-no-override-bad-anchor'].checks.find(c => c.name === 'geometry').detail, /not found in the MOCK/);
      assert.match(fs.readFileSync(path.join(tmp, 'out', 'report.md'), 'utf8'), /- t\.hero: no card at this width/);
    });
    await t.test('capture:viewport: content below the fold does not fail height; without it the same page does', () => {
      assert.deepEqual(failed(by['below-far-viewport']), []);
      assert.equal(by['below-far-viewport'].checks.some(c => c.name === 'height'), false, 'no height check in viewport capture');
      assert.ok(failed(by['below-far']).includes('height'));
      assert.match(by['below-far'].checks.find(c => c.name === 'order').detail, /t\.below is 390x1px/);
      assert.equal(by['below-far-viewport'].diff.mockHeight, 700);
      assert.equal(by['below-far-viewport'].diff.builtHeight, 700);
    });
    await t.test('viewport skip direction: a build that PUSHES an on-screen section below the fold fails; a section the mock itself has below the fold may be there', () => {
      assert.match(by['pushed-below-fold'].checks.find(c => c.name === 'order').detail, /pushed below the fold: t\.hero.*the mock shows it on screen/);
      assert.match(by['pushed-below-fold'].checks.find(c => c.name === 'primary').detail, /primary pushed below the fold/);
      assert.match(by['pushed-below-fold'].checks.find(c => c.name === 'geometry').detail, /t\.hero: pushed below the fold/);
      assert.deepEqual(failed(by['viewport-mock-below-fold']), []);
    });
    await t.test('regions: a correct region passes; an EMPTY and a WRONG one fail; a missing element fails; reported in report.md', () => {
      assert.equal(by['region-ok'].checks.find(c => c.name === 'region:t.hero').pass, true);
      assert.match(by['region-empty'].checks.find(c => c.name === 'region:t.hero').detail, /region empty/);
      assert.match(by['region-wrong'].checks.find(c => c.name === 'region:t.hero').detail, /% differing/);
      assert.match(by['region-no-element'].checks.find(c => c.name === 'region:t.hero').detail, /no visible built element/);
      assert.match(fs.readFileSync(path.join(tmp, 'out', 'report.md'), 'utf8'), /Regions:\n- FAIL t\.hero/);
      assert.ok(fs.existsSync(path.join(tmp, 'out', 'region-empty-390.png')));
    });
    await t.test('min_size: a small labelled element fails the default 40x24 but passes with a per-id override', () => {
      assert.match(by['small-order-default'].checks.find(c => c.name === 'order').detail, /t\.top is 150x20px \(min 40x24/);
      assert.equal(by['small-order-override'].checks.find(c => c.name === 'order').pass, true);
    });
    await t.test('B layout-sanity: overlapping text, an escaping control, a mid-word break and clipped text each fail; ellipsis passes', () => {
      const d = n => by[n].checks.find(c => c.name === 'layout-sanity').detail;
      assert.match(d('layout-overlap'), /overlap p x footer|overlap footer x p|overlap .*Chồng chữ/);
      assert.match(d('layout-escape'), /escape button in div: sticks out of its card by right 1\d\dpx/);
      assert.match(d('layout-midword'), /word-split div: line break inside a word/);
      assert.match(d('layout-clipped'), /clipped div: text cut off by overflow/);
      assert.equal(by['layout-ellipsis'].checks.find(c => c.name === 'layout-sanity').pass, true);
      assert.equal(by.ok.checks.find(c => c.name === 'layout-sanity').pass, true);
      assert.match(by['layout-escape'].checks.find(c => c.name === 'layout-sanity').detail, /360px: .*layout-escape-layout-360\.png/);
      assert.ok(fs.existsSync(path.join(tmp, 'out', 'layout-escape-layout-360.png')), 'a screenshot of each failing width is saved');
      assert.match(fs.readFileSync(path.join(tmp, 'out', 'report.md'), 'utf8'), /Layout-sanity offenders:\n- @360px escape button/);
    });
    await t.test('LOW fixes: 5px line collisions fail, an 8px gap passes; truncated required text fails, a truncated list name passes; clip honoured only on tiny absolute boxes', () => {
      const d = n => by[n].checks.find(c => c.name === 'layout-sanity').detail;
      assert.match(d('lines-overlap-5px'), /overlap p#l1 x p#l2: .* by \d+x[3-7]px/);
      assert.equal(by['lines-gap-8px'].checks.find(c => c.name === 'layout-sanity').pass, true);
      assert.match(d('ellipsis-primary-label'), /clipped .*ellipsis on REQUIRED text/);
      assert.equal(by['ellipsis-bound-name-in-list'].checks.find(c => c.name === 'layout-sanity').pass, true);
      assert.match(d('static-clip-is-not-hidden'), /overlap/);
      assert.equal(by['sr-only-clip-is-hidden'].checks.find(c => c.name === 'layout-sanity').pass, true);
    });
    await t.test('sun rule: selected toggles are exempt, an unselected sun toggle and a second action are not; tabs/chips/links may be Nunito', () => {
      assert.equal(by['sun-selected-tab'].checks.find(c => c.name === 'primary').pass, true);
      assert.equal(by['sun-pressed-toggle'].checks.find(c => c.name === 'primary').pass, true);
      assert.match(by['sun-unselected-tab'].checks.find(c => c.name === 'primary').detail, /exactly 1 sun-filled clickable control, found 2/);
      assert.match(by['two-sun-buttons'].checks.find(c => c.name === 'primary').detail, /found 2/);
      assert.equal(by['sun-selected-tab'].checks.find(c => c.name === 'fonts').pass, true, 'the Nunito tabs are fine');
      assert.match(by['wrong-button-font'].checks.find(c => c.name === 'fonts').detail, /Arial, want Baloo 2/);
      for (const a of ['pressed-button', 'current-link', 'current-li-descendant', 'submit-pressed', 'submit-button-in-group', 'tab-outside-tablist', 'toolbar-lone', 'toolbar-allsun', 'toolbar-link', 'form-typeless', 'tablist-two-selected']) {
        assert.match(by['abuse-' + a].checks.find(c => c.name === 'primary').detail, /exactly 1 sun-filled clickable control, found [2-9]/, 'abuse ' + a);
      }
      assert.equal(by['sun-radio-in-group'].checks.find(c => c.name === 'primary').pass, true);
      assert.equal(by['sun-checked-input'].checks.find(c => c.name === 'primary').pass, true);
      assert.match(by['wrong-chip-font'].checks.find(c => c.name === 'fonts').detail, /span "3" uses Arial, want Baloo 2/);
      assert.match(by['wrong-plain-button-font'].checks.find(c => c.name === 'fonts').detail, /button "Nút" uses Arial, want Baloo 2 or Nunito/);
    });
    await t.test('still-twin runs BEFORE the region own-pixels hide/unhide (which used to leave the page 4-68px different)', () => {
      const names = by['region-ok'].checks.map(c => c.name);
      assert.ok(names.indexOf('still-twin') < names.indexOf('region:t.hero'), names.join(','));
      assert.equal(by['region-ok'].checks.find(c => c.name === 'still-twin').pass, true);
    });
    await t.test('A still-twin runs BEFORE the width cycle (a viewport cycle re-rasterises edges and used to make it fail falsely)', () => {
      const names = by.ok.checks.map(c => c.name);
      assert.ok(names.indexOf('still-twin') < names.indexOf('layout-sanity') && names.indexOf('still-twin') < names.findIndex(n => n.startsWith('no-h-scroll')), names.join(','));
      assert.equal(by.ok.checks.find(c => c.name === 'still-twin').pass, true);
      assert.equal(by['still-twin-differs'].checks.find(c => c.name === 'still-twin').pass, false, 'a real .still layout change still fails');
    });
    await t.test('a failing contract writes a composite, report.json and report.md; verdict is false', () => {
      assert.equal(report.ok, false);
      for (const f of ['report.json', 'report.md', 'missing-text-390.png']) assert.ok(fs.existsSync(path.join(tmp, 'out', f)), f);
      assert.match(fs.readFileSync(path.join(tmp, 'out', 'report.md'), 'utf8'), /FAIL missing-text @ 390px/);
    });
  } finally {
    await new Promise(r => server.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('M8 state verification (default driver): wrong state, anonymous, unreachable states FAIL as state-driver; the right state passes', async t => {
  if (skipNoChrome(t)) return;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-state-'));
  const { server, base } = await startServer();
  try {
    const design = writeFixtureDesign(tmp);
    const contracts = path.join(tmp, 'contracts');
    fs.mkdirSync(contracts);
    const mk = (id, p, state, label) => fs.writeFileSync(path.join(contracts, id + '.json'), JSON.stringify({
      id, release: 0, mock: { 390: 'mocks/m.html' }, viewport: { 390: 700 }, built: { path: p, state },
      order: [], texts: [], primary: { id: 'x', text: label, min_height: { 390: 1 } }, diff_ceiling: { 390: 1 },
    }));
    mk('state-ok', '/home-ok', 'first-visit', 'Mở truyện');
    mk('state-wrong', '/home-wrong-state', 'first-visit', 'Mở truyện');
    mk('state-anon', '/home-anon', 'first-visit', 'Mở truyện');
    mk('state-mid-on-first-visit-page', '/home-ok', 'mid-story', 'Đọc tiếp');
    mk('state-reward', '/home-ok', 'reward', 'Xong hôm nay');
    mk('state-rank-up', '/home-ok', 'rank-up', 'x');
    const report = await runFidelity({ design, contracts, base, out: path.join(tmp, 'out'), composites: 'fail', greetingWaitMs: 400, concurrency: 6 });
    const sd = id => report.results.find(r => r.contract === id).checks.find(c => c.name === 'state-driver');
    assert.equal(sd('state-ok').pass, true);
    assert.equal(sd('state-wrong').pass, false); assert.match(sd('state-wrong').detail, /wrong state: expected a visible "Mở truyện"/);
    assert.equal(sd('state-anon').pass, false); assert.match(sd('state-anon').detail, /not logged in/);
    assert.equal(sd('state-mid-on-first-visit-page').pass, false); assert.match(sd('state-mid-on-first-visit-page').detail, /wrong state/);
    assert.equal(sd('state-reward').pass, false); assert.match(sd('state-reward').detail, /not implemented/);
    assert.equal(sd('state-rank-up').pass, false); assert.match(sd('state-rank-up').detail, /not implemented/);
  } finally {
    await new Promise(r => server.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('m14 a contract whose width-keyed fields disagree with its mocks is rejected (exit-2 class error)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-width-'));
  try {
    const good = { ...BASE_CONTRACT, id: 'w', built: { path: '/', state: 'first-visit' } };
    const run = async c => { fs.rmSync(path.join(tmp, 'c'), { recursive: true, force: true }); fs.mkdirSync(path.join(tmp, 'c')); fs.writeFileSync(path.join(tmp, 'c', 'w.json'), JSON.stringify(c)); return runFidelity({ design: REAL_DESIGN, contracts: path.join(tmp, 'c'), base: 'http://x.invalid', out: path.join(tmp, 'o') }); };
    await assert.rejects(run({ ...good, viewport: { 390: 700, 1280: 800 } }), e => e instanceof InfraError && /"viewport" widths/.test(e.message));
    await assert.rejects(run({ ...good, diff_ceiling: {} }), e => e instanceof InfraError && /"diff_ceiling" widths/.test(e.message));
    await assert.rejects(run({ ...good, reference: { 1280: 'x.png' } }), e => e instanceof InfraError && /"reference" widths/.test(e.message));
    await assert.rejects(run({ ...good, anchors_exempt: { 't.top': 'also exempt' } }), e => e instanceof InfraError && /BOTH anchors and anchors_exempt at 390px: t\.top/.test(e.message));
    await assert.rejects(run({ ...good, anchors_390: { 't.foot': 'x' }, anchors_exempt: { 't.foot': 'r' } }), e => e instanceof InfraError && /BOTH anchors and anchors_exempt at 390px: t\.foot/.test(e.message));
    await assert.rejects(run({ ...good, anchors_exempt_390: { 't.top': 'r' } }), e => e instanceof InfraError && /BOTH .* at 390px: t\.top/.test(e.message));
    await assert.rejects(run({ ...good, anchors_1280: { 't.top': 'x' } }), e => e instanceof InfraError && /"anchors_1280" is for a width with no mock/.test(e.message));
    await assert.rejects(run({ ...good, anchors_exempt_1280: {} }), e => e instanceof InfraError && /"anchors_exempt_1280" is for a width with no mock/.test(e.message));
    await assert.rejects(run({ ...good, texts_1280: ['x'] }), e => e instanceof InfraError && /texts_1280/.test(e.message));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('per-width anchors: override replaces, null removes, exemptions override; both-at-one-width is a contract error', () => {
  const c = { anchors: { a: 'A', b: 'B' }, anchors_exempt: { x: 'why' }, anchors_390: { a: 'A390', b: null }, anchors_exempt_390: { b: 'moved to exempt at 390', x: null } };
  assert.deepEqual(effectiveAnchors(c, 390), { anchors: { a: 'A390' }, exempt: { b: 'moved to exempt at 390' } });
  assert.deepEqual(effectiveAnchors(c, 1280), { anchors: { a: 'A', b: 'B' }, exempt: { x: 'why' } });
});

test('region/crop helpers: uniform crops are "empty", resize keeps content, identical crops diff 0', async () => {
  const { compareRegion, stddev, cropPng } = await import('../scripts/design/lib/regions.mjs');
  const mk = (w, h, f) => { const p = new PNG({ width: w, height: h }); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p.data.set(f(x, y), (y * w + x) * 4); return PNG.sync.write(p); };
  const checker = mk(40, 40, (x, y) => ((x >> 2) + (y >> 2)) % 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
  const blank = mk(40, 40, () => [200, 200, 200, 255]);
  assert.ok(stddev(cropPng(checker, { x: 0, y: 0, w: 40, h: 40 })) > 100);
  assert.ok(stddev(cropPng(blank, { x: 0, y: 0, w: 40, h: 40 })) < 1);
  const box = { x: 0, y: 0, w: 40, h: 40 };
  assert.equal(compareRegion(checker, checker, box, box, 0.01).pass, true);
  const empty = compareRegion(checker, blank, box, box, 0.5);
  assert.equal(empty.pass, false); assert.match(empty.problems.join('|'), /region empty/);
  // built element twice as big as the mock box: resized back before diffing
  const big = mk(80, 80, (x, y) => ((x >> 3) + (y >> 3)) % 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
  assert.equal(compareRegion(checker, big, box, { x: 0, y: 0, w: 80, h: 80 }, 0.05).pass, true);
});

test('r2l driver sample data: values come from the mocks, shapes are preserved', async () => {
  const { SAMPLE, sampleProgress, sampleBoards, sampleSession } = await import('../scripts/design/drivers/r2l.mjs');
  const fmt = n => new Intl.NumberFormat('vi-VN').format(n);
  const mock1280 = fs.readFileSync(path.join(REAL_DESIGN, 'mocks', '01-home-1280.html'), 'utf8').replace(/<[^>]+>/g, ' ');
  for (const row of [...SAMPLE.leaderboard.xp, ...SAMPLE.leaderboard.diamonds]) { assert.ok(mock1280.includes(row.display_name), row.display_name); assert.ok(mock1280.includes(fmt(row.total)), fmt(row.total)); }
  assert.ok(mock1280.includes('Chào ' + SAMPLE.child.name));
  assert.ok(mock1280.includes(SAMPLE.story.title));
  const rew = fs.readFileSync(path.join(REAL_DESIGN, 'mocks', '04-reward-390.html'), 'utf8').replace(/<[^>]+>/g, ' ');
  assert.ok(rew.includes('+' + SAMPLE.reward.diamonds) && rew.includes('+' + SAMPLE.reward.xp));
  // shape preservation: unknown keys survive, only values change
  const p = sampleProgress({ ok: true, extra: 1, progress: { foo: 'bar', current_pack: { x: 1 } }, read2lead_state: { keep: 1, diamonds: 270, rank_ladder: { label_vi: 'Đồng', tier_color: '#f00' } } }, 'first-visit');
  assert.equal(p.extra, 1); assert.equal(p.progress.foo, 'bar'); assert.equal(p.read2lead_state.keep, 1);
  assert.equal(p.read2lead_state.diamonds, 55); assert.equal(p.progress.student_name, 'Minh'); assert.equal(p.read2lead_state.rank_ladder.tier_color, '#f00'); assert.equal(p.read2lead_state.rank_ladder.stars, 2);
  // the pack and session are REAL (from the API); only the title/level VALUES are replaced, and nothing is fabricated
  assert.equal(p.progress.current_pack.x, 1); assert.equal(p.progress.current_pack.story_title, 'The Sky Is Blue!'); assert.equal(p.progress.current_pack.level, 'L1');
  const real = sampleProgress({ progress: { current_pack: { story_session: { stage: 'read', complete: false } } }, read2lead_state: {} }, 'mid-story');
  assert.deepEqual(real.progress.current_pack.story_session, { stage: 'read', complete: false });
  assert.equal(sampleProgress({ progress: {}, read2lead_state: {} }, 'mid-story').progress.current_pack ?? null, null, 'no pack is invented');
  assert.equal(sampleProgress({ progress: { current_pack: { story_title: 'x' } }, read2lead_state: {} }, 'no-story').progress.current_pack, null, 'no-story is the one fabricated state');
  const av = { monster: { body: 'x' } };
  const b = sampleBoards({ ok: true, boards: { xp: { leaders: [], participants: 0, own: { rank: 3, display_name: 'Linh' } }, diamonds: { leaders: [{ rank: 1, display_name: 'An', total: 1, avatar: av, is_self: false }] } } });
  assert.deepEqual(b.boards.xp.leaders.map(r => [r.rank, r.display_name, r.total]), [[1, 'Hoang', 1080], [2, 'Hieuenzo', 900], [3, 'Percy', 890]]);
  assert.equal(b.boards.xp.leaders[0].avatar, av, 'avatar shape borrowed from a real row');
  assert.equal(b.boards.diamonds.leaders[0].total, 39444); assert.equal(b.boards.xp.own.rank, null);
  const sess = sampleSession({ ok: true, view: { session: { id: 's', awarded: { diamonds: 5, xp: 1 }, pictureRetell: { status: 'complete', award: { diamonds: 200 } } } } });
  assert.deepEqual([sess.view.session.awarded.diamonds, sess.view.session.awarded.xp, sess.view.session.pictureRetell.award.diamonds], [35, 20, 0]);
});

test('data-binding expectations: the alternate sample expects its own values and the mock values must be gone', async () => {
  const { SAMPLE, loadSample, bindingExpectations } = await import('../scripts/design/drivers/r2l.mjs');
  const alt = loadSample(path.join(root, 'scripts', 'design', 'fixtures', 'mock-sample-alt.json'));
  // every alternate value really differs from the mock's (otherwise the bite proves nothing)
  assert.notEqual(alt.child.name, SAMPLE.child.name); assert.notEqual(alt.child.diamonds, SAMPLE.child.diamonds); assert.notEqual(alt.child.streak_days, SAMPLE.child.streak_days);
  assert.notEqual(alt.reward.diamonds, SAMPLE.reward.diamonds); assert.notEqual(alt.reward.xp, SAMPLE.reward.xp);
  for (const kind of ['xp', 'diamonds']) alt.leaderboard[kind].forEach((r, i) => { assert.notEqual(r.total, SAMPLE.leaderboard[kind][i].total); });
  const home = bindingExpectations(alt, 'first-visit', SAMPLE);
  assert.ok(home.expect.includes('Chào Bảo!') && home.expect.includes('187') && home.expect.includes('9 ngày') && home.expect.includes('Red Apples Fall') && home.expect.includes('2.310') && home.expect.includes('52.718'));
  assert.ok(home.absent.includes('Chào Minh!') && home.absent.includes('55') && home.absent.includes('1.080') && home.absent.includes('39.444'));
  const rw = bindingExpectations(alt, 'reward', SAMPLE);
  assert.deepEqual(rw.expect, ['+47', '+28', '“Red Apples Fall”']); assert.deepEqual(rw.absent, ['+35', '+20', '“The Sky Is Blue!”']);
  assert.deepEqual(bindingExpectations(SAMPLE, 'reward').absent, [], 'no absent list against itself');
});

test('data-binding check: a page that binds the values passes; one that hard-codes the mock values FAILS (rule 28)', async t => {
  if (skipNoChrome(t)) return;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-bind-'));
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const name = u.searchParams.get('name'), dia = u.searchParams.get('dia');
    const alt = u.searchParams.get('alt') === '1';
    const body = u.pathname === '/bound2' ? (alt ? '<h1>Chào Bảo!</h1><p>187</p>' : '<h1>Chào Minh!</h1><p>55</p>')
      : u.pathname === '/hard2' ? '<h1>Chào Minh!</h1><p>55</p>'
      : u.pathname === '/bound' ? `<h1>Chào ${name}!</h1><p>${dia}</p>` : '<h1>Chào Minh!</h1><p>55</p>';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><meta charset="utf-8"><body style="font:20px sans-serif">${body}`);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const design = writeBindingDesign(tmp);
    fs.writeFileSync(path.join(tmp, 'driver.mjs'), `export default async (page, c, base) => { await page.goto(base + c.built.path); return { dataBinding: { expect: ['Chào Bảo!', '187'], absent: ['Chào Minh!', '55'] } }; };\n`);
    const contracts = path.join(tmp, 'c'); fs.mkdirSync(contracts);
    const mk = (id, p) => fs.writeFileSync(path.join(contracts, id + '.json'), JSON.stringify({ ...BASE_CONTRACT, id, anchors: undefined, built: { path: p, state: 'first-visit' } }));
    mk('bound', '/bound?name=Bảo&dia=187'); mk('hardcoded', '/hard?name=Bảo&dia=187');
    const base = 'http://127.0.0.1:' + server.address().port;
    const bo = await runFidelity({ design, contracts, base, out: path.join(tmp, 'o1'), 'state-driver': path.join(tmp, 'driver.mjs'), 'binding-only': true });
    const by = Object.fromEntries(bo.results.map(r => [r.contract, r]));
    assert.deepEqual(by.bound.checks.map(c => [c.name, c.pass]), [['state-driver', true], ['data-binding', true]]);
    assert.equal(by.hardcoded.checks.find(c => c.name === 'data-binding').pass, false);
    assert.match(by.hardcoded.checks.find(c => c.name === 'data-binding').detail, /does not show: "Chào Bảo!", "187"; still shows the OLD value \(hard-coded\?\): "Chào Minh!", "55"/);
    assert.equal(by.bound.checks.length, 2, 'binding-only skips every other check');
    // also part of a normal full run
    const full = await runFidelity({ design, contracts, base, out: path.join(tmp, 'o2'), only: 'hardcoded', 'state-driver': path.join(tmp, 'driver.mjs') });
    assert.ok(full.results[0].checks.some(c => c.name === 'data-binding' && !c.pass));
    // AUTOMATIC second pass: the driver offers an alternate sample; a normal run (no --binding-only) loads the page with it
    fs.writeFileSync(path.join(tmp, 'alt-driver.mjs'), `export default async (page, c, base, ctx) => { const alt = !!(ctx.opts && ctx.opts.sample); await page.goto(base + c.built.path + (alt ? '&alt=1' : '')); return alt ? { dataBinding: { expect: ['Chào Bảo!', '187'], absent: ['Chào Minh!', '55'] } } : { dataBinding: { expect: ['Chào Minh!', '55'] }, altSample: 'ALT.json' }; };\n`);
    const c2 = path.join(tmp, 'c2'); fs.mkdirSync(c2);
    fs.writeFileSync(path.join(tmp, 'plain.mjs'), `export default async (page, c, base) => { await page.goto(base + c.built.path); };\n`);
    const mk2 = (id, p, extra = {}) => fs.writeFileSync(path.join(c2, id + '.json'), JSON.stringify({ ...BASE_CONTRACT, id, anchors: undefined, built: { path: p, state: 'first-visit' }, ...extra }));
    mk2('auto-bound', '/bound2?x=1', { data_bound: ['Minh'] }); mk2('auto-hard', '/hard2?x=1', { data_bound: ['Minh'] }); mk2('auto-nodriver', '/bound2?x=1', { data_bound: ['Minh'] });
    const autoRun = await runFidelity({ design, contracts: c2, base, out: path.join(tmp, 'o4'), 'state-driver': path.join(tmp, 'alt-driver.mjs') });
    const ab = Object.fromEntries(autoRun.results.map(r => [r.contract, r]));
    assert.match(ab['auto-bound'].checks.find(c => c.name === 'data-binding').detail, /alternate-sample pass/);
    assert.equal(ab['auto-bound'].checks.find(c => c.name === 'data-binding').pass, true, 'a page that binds follows the alternate sample');
    assert.equal(ab['auto-hard'].checks.find(c => c.name === 'data-binding').pass, false, 'a hard-coded page FAILS in a NORMAL run');
    // a contract with data_bound values and a driver that offers no alternate sample: FAIL "binding not run"
    const noAlt = await runFidelity({ design, contracts: c2, base, out: path.join(tmp, 'o5'), only: 'auto-nodriver', 'state-driver': path.join(tmp, 'plain.mjs') });
    assert.match(noAlt.results[0].checks.find(c => c.name === 'data-binding').detail, /binding not run/);
    // a driver that gives no expectations cannot silently pass --binding-only
    const none = await runFidelity({ design, contracts, base, out: path.join(tmp, 'o3'), only: 'bound', 'state-driver': path.join(tmp, 'plain.mjs'), 'binding-only': true });
    assert.match(none.results[0].checks.find(c => c.name === 'data-binding').detail, /provided no dataBinding/);
  } finally { await new Promise(r => server.close(r)); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('region edge energy: a blank box inside the backdrop rays FAILS clearly, a different-but-real subject passes', async () => {
  const { compareRegion, edgeEnergy, cropPng, EDGE_MIN_RATIO } = await import('../scripts/design/lib/regions.mjs');
  const W = 150;
  // backdrop: green with lighter diagonal rays (non-zero stddev, some edges), like the rank-up burst
  const rays = (x, y) => (((x + y) >> 4) % 3 === 0 ? [46, 139, 78, 255] : [35, 122, 65, 255]);
  const disc = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 < r * r;
  const subject = (x, y, cx = 75, cy = 75) => {
    if (disc(x, y, cx - 18, cy - 10, 8) || disc(x, y, cx + 18, cy - 10, 8)) return [20, 40, 60, 255]; // eyes
    if (Math.abs(x - cx) < 14 && y > cy + 12 && y < cy + 20) return [200, 40, 60, 255]; // mouth
    if (Math.abs(x - cx) < 40 && Math.abs(y - cy) < 36) return [235, 235, 235, 255]; // body
    return null;
  };
  const mk = f => { const p = new PNG({ width: W, height: W }); for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) p.data.set(f(x, y), (y * W + x) * 4); return PNG.sync.write(p); };
  const mock = mk((x, y) => subject(x, y) || rays(x, y));
  const blank = mk((x, y) => rays(x, y));                       // the monster box emptied: only rays remain
  const other = mk((x, y) => subject(x, y, 80, 70) || rays(x, y)); // a different real subject, a little off
  const box = { x: 0, y: 0, w: W, h: W };
  const em = edgeEnergy(cropPng(mock, box)), eb = edgeEnergy(cropPng(blank, box)), eo = edgeEnergy(cropPng(other, box));
  assert.ok(eb / em < 0.5 * EDGE_MIN_RATIO + 0.2, `blank ratio ${(eb / em).toFixed(2)}`);
  assert.ok(eo / em > 0.8, `real-other ratio ${(eo / em).toFixed(2)}`);
  const rBlank = compareRegion(mock, blank, box, box, 1.0);
  assert.equal(rBlank.pass, false); assert.match(rBlank.problems.join('|'), /region empty: built crop has only \d+% of the mock's edge energy/);
  assert.ok(rBlank.builtSd > 4, 'the blank box is NOT uniform (rays), so the stddev check alone would pass it');
  assert.equal(compareRegion(mock, other, box, box, 1.0).pass, true);
});

test('D r2l driver is idempotent on a used rehearsal server (existing pack reused; previous_pack_needs_review resolved)', async () => {
  const { ensurePack } = await import('../scripts/design/drivers/r2l.mjs');
  let generates = 0, current = null, mode = 'ok';
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/api/read2lead-progress')) return res.end(JSON.stringify({ ok: true, progress: { current_pack: current } }));
    generates++;
    if (mode === 'review') return res.end(JSON.stringify({ ok: false, error: 'previous_pack_needs_review', lesson_link: '/read2lead/lesson?code=X&pack_id=p9' }));
    if (mode === 'fail') return res.end(JSON.stringify({ ok: false, error: 'boom' }));
    current = { pack_id: 'p1' };
    res.end(JSON.stringify({ ok: true, pack_id: 'p1' }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal(await ensurePack(base, 'C'), 'p1'); assert.equal(generates, 1);
    assert.equal(await ensurePack(base, 'C'), 'p1'); assert.equal(generates, 1, 'second run reuses the existing pack, nothing generated');
    current = null; mode = 'review';
    assert.equal(await ensurePack(base, 'C'), 'p9', 'previous_pack_needs_review resolves to the pack it names');
    mode = 'fail';
    await assert.rejects(ensurePack(base, 'C'), /could not generate a real pack/);
  } finally { await new Promise(r => server.close(r)); }
});

const pct95 = (have, price) => Math.round((have / price) * 100) >= 95;
test('Release-2 samples: values come from the mocks, real shapes are kept, alt differs everywhere', async () => {
  const D = await import('../scripts/design/drivers/r2l.mjs');
  const { SAMPLE, loadSample, sampleLeaderboardFull, sampleLibrary, sampleGifts, sampleCompanion, bindingExpectations, ALT_SAMPLE_PATH } = D;
  const text = f => fs.readFileSync(path.join(REAL_DESIGN, 'mocks', f), 'utf8').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const fmt = n => new Intl.NumberFormat('vi-VN').format(n);
  const lb = text('06-leaderboard-1280.html');
  assert.equal(SAMPLE.leaderboard_full.xp.length, 11);
  for (const [name, total] of SAMPLE.leaderboard_full.xp) { assert.ok(lb.includes(name), name); assert.ok(lb.includes(fmt(total) + ' XP'), name + ' ' + total); }
  assert.ok(lb.includes('Minhdt Con đây!') || /Minhdt[^#]*Con đây!/.test(lb));
  const lib = text('07-library-1280.html');
  for (const st of SAMPLE.library.stories) assert.ok(lib.includes(st.title), st.title);
  assert.ok(lib.includes(`${SAMPLE.library.counts.stories} câu chuyện · ${SAMPLE.library.counts.books} quyển sách`));
  const shop = text('08-shop-1280.html');
  assert.ok(shop.includes(String(SAMPLE.shop.diamonds)));
  for (const g of SAMPLE.shop.gifts.slice(0, 4)) {
    assert.ok(shop.includes(g.name_vi), g.name_vi);
    // the one deliberate difference: the mock says 60 for the near-miss gift (55/60 = 92%), but the product's near-miss rule starts at 95%, so the sample uses 57
    if (g.id !== 'pencils') assert.ok(shop.includes(`${g.price_diamonds} kim cương`), g.name_vi);
    else assert.ok(shop.includes('60 kim cương') && g.price_diamonds === 57 && pct95(SAMPLE.shop.diamonds, g.price_diamonds));
  }
  assert.ok(shop.includes('46%'));
  // shapes: leaderboard keeps avatar / extra keys, the child sits at its rank with is_self, the other board is untouched
  const av = { monster: { body: 'x' } };
  const lbj = sampleLeaderboardFull({ ok: true, version: 'v', boards: { xp: { leaders: [{ rank: 1, display_name: 'a', total: 1, avatar: av, is_self: false, extra: 1 }], participants: 1, own: { rank: null, display_name: 'Linh', avatar: av, total: 0, is_self: true } }, diamonds: { leaders: [], participants: 0 } } });
  assert.equal(lbj.version, 'v'); assert.equal(lbj.boards.xp.leaders.length, 11); assert.equal(lbj.boards.xp.leaders[7].is_self, true); assert.equal(lbj.boards.xp.leaders[7].display_name, 'Minhdt');
  assert.equal(lbj.boards.xp.leaders[0].avatar, av); assert.equal(lbj.boards.xp.leaders[0].extra, 1); assert.equal(lbj.boards.xp.own.rank, 8); assert.equal(lbj.boards.xp.participants, 11);
  assert.equal(lbj.boards.diamonds.leaders.length, 3, 'the other tab gets the home sample');
  const libj = sampleLibrary({ books: [{ id: 'old' }], stories: [{ id: 'old' }], counts: { stories: 1095, books: 36, other: 1 }, extra: 'keep' });
  assert.equal(libj.extra, 'keep'); assert.equal(libj.counts.stories, 48); assert.equal(libj.counts.other, 1); assert.equal(libj.stories.length, 5);
  assert.deepEqual(Object.keys(libj.stories[0]).sort(), ['audio', 'bookId', 'id', 'number', 'pages', 'title']);
  assert.ok(Array.isArray(libj.stories[0].audio) && libj.stories[0].audio.length === 1 && libj.stories[3].audio.length === 0, 'audio availability = audio[] non-empty');
  const gj = sampleGifts({ ok: true, items: [{ id: 'sticker', name_vi: 'Sticker', emoji: 'x', image_key: null, image_url: null, price_diamonds: 1000, limit_total: null, redeemed_count: 0, active: true, can_afford: false, available: true, progress_percent: 27 }], diamonds: 270, redemptions: [], gift_goal: null });
  assert.equal(gj.diamonds, 55); assert.equal(gj.gift_goal, 'sticker'); assert.equal(gj.items.find(i => i.id === 'sticker').progress_percent, 46); assert.equal(gj.items.find(i => i.id === 'pencils').progress_percent, 96); // 55/57: clears the product's 95% near-miss rule
  assert.deepEqual(gj.redemptions.map(r => [r.gift_id, r.status]), [['bookmark', 'delivered'], ['gift_box', 'requested']]);
  assert.ok(gj.items.every(i => i.can_afford === (i.price_diamonds <= 55)));
  assert.ok(!gj.items.some(i => i.id === 'bookmark'), 'a received gift is ONE card (its received card), not also an ordinary item');
  assert.ok(gj.items.some(i => i.id === 'gift_box'), 'the pending gift stays an item (pinned in-flight)');
  const g390 = sampleGifts({ ok: true, items: [{ id: 'sticker' }], diamonds: 270, redemptions: [], gift_goal: null }, SAMPLE, 390);
  assert.ok(!g390.items.some(i => i.id === 'gift_box') && !g390.redemptions.some(r => r.status === 'requested'), 'the mock shows no pending card at 390');
  assert.deepEqual(g390.items.map(i => i.id), ['sticker', 'pencils', 'picture_book', 'teddy']);
  assert.equal(sampleCompanion({ ok: true, read2lead_state: { keep: 1, student_name: 'Linh' } }).read2lead_state.keep, 1);
  // alternate sample: every R2 value differs (otherwise the binding pass proves nothing)
  const alt = loadSample(ALT_SAMPLE_PATH);
  alt.leaderboard_full.xp.forEach(([n, t], i) => { assert.notEqual(n, SAMPLE.leaderboard_full.xp[i][0]); assert.notEqual(t, SAMPLE.leaderboard_full.xp[i][1]); });
  alt.library.stories.forEach((st, i) => assert.notEqual(st.title, SAMPLE.library.stories[i].title));
  alt.shop.gifts.forEach((g, i) => { assert.notEqual(g.name_vi, SAMPLE.shop.gifts[i].name_vi); assert.notEqual(g.price_diamonds, SAMPLE.shop.gifts[i].price_diamonds); });
  assert.notEqual(alt.shop.diamonds, SAMPLE.shop.diamonds);
  const e = bindingExpectations(alt, 'shop-goal', SAMPLE);
  assert.ok(e.expect.includes('88') && e.expect.includes('Thước kẻ') && e.expect.includes('150 kim cương') && e.expect.includes('59%') && e.expect.includes('62') && e.expect.includes('Còn thiếu 4 kim cương'));
  assert.ok(e.absent.includes('55') && e.absent.includes('Sticker') && e.absent.includes('120 kim cương') && e.absent.includes('65') && e.absent.includes('Còn thiếu 2 kim cương'));
  // prices only on ordinary cards (the received and pending cards show none), so they are never expected; and no collision with the mock's numbers
  assert.ok(!e.expect.includes('70 kim cương') && !e.expect.includes('300 kim cương'), 'received (Cục tẩy 70) and pending (Quà bất ngờ 300) show no price');
  assert.ok(!e.expect.some(x => e.absent.includes(x)), 'no string is both expected and gone');
  const e390 = bindingExpectations(alt, 'shop-goal', SAMPLE, 390);
  assert.ok(!e390.expect.includes('Quà bất ngờ') && !e390.expect.includes('Đang chờ Coach Felix duyệt'), 'the pending card exists only at 1280');
  const le = bindingExpectations(alt, 'leaderboard-xp', SAMPLE);
  assert.ok(le.expect.includes('Quyên') && le.expect.includes('2.310 XP') && le.expect.includes('#8') && le.absent.includes('Hoang') && le.absent.includes('1.080 XP'));
  const libx = bindingExpectations(alt, 'library', SAMPLE);
  assert.ok(libx.expect.includes('64 câu chuyện · 8 quyển sách') && libx.expect.includes('Quyển 6 · Bài 7') && libx.expect.includes('Quyển 5') && libx.absent.includes('Quyển 2 · Bài 4') && libx.absent.includes('Quyển 1') && libx.absent.includes('A Forest Adventure'));
  // home: rank chip, rank-progress card and level tag follow the sample
  const hm = bindingExpectations(alt, 'first-visit', SAMPLE);
  assert.ok(hm.expect.includes('Vàng ★') && hm.expect.includes('Sắp lên Vàng ★★') && hm.expect.includes('1 / 3 ★') && hm.expect.includes('L2') && hm.expect.includes('#'.slice(1) + '9 ngày'));
  assert.ok(hm.absent.includes('Bạc ★★') && hm.absent.includes('Sắp lên Bạc ★★★') && hm.absent.includes('2 / 3 ★') && hm.absent.includes('L1') && hm.absent.includes('3 ngày'));
  assert.ok(!bindingExpectations(alt, 'mid-story', SAMPLE).expect.includes('L2'), 'the level tag is first-visit only');
  assert.deepEqual(bindingExpectations(alt, 'rank-up', SAMPLE), { expect: ['Vàng ★'], absent: ['Bạc ★★★'] });
  // shop: goal price/percent/remaining, the nearly-affordable gift, status strings
  const sp = bindingExpectations(alt, 'shop-goal', SAMPLE);
  for (const x of ['62', 'Còn thiếu 4 kim cương', 'Sắp đổi được!', '✓ Đã nhận quà', 'Đang chờ Coach Felix duyệt', 'Đặt làm mục tiêu ★', '92 kim cương']) assert.ok(sp.expect.includes(x), x);
  for (const x of ['65', 'Còn thiếu 2 kim cương', '57 kim cương', '60 kim cương', 'Còn thiếu 5 kim cương']) assert.ok(sp.absent.includes(x), x); // the last two are the MOCK's own strings (data_bound in the contract)
});

test('region own-pixels: an element that renders nothing fails even when the backdrop edges look like the mock (rule 28)', async t => {
  const { ownPixelFraction, OWN_MIN_FRACTION } = await import('../scripts/design/lib/regions.mjs');
  // unit: the fraction of the box that changes when the element is hidden
  const mk = f => { const p = new PNG({ width: 60, height: 60 }); for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) p.data.set(f(x, y), (y * 60 + x) * 4); return PNG.sync.write(p); };
  const stripes = (x, y) => (((x + y) >> 3) % 2 ? [46, 139, 78, 255] : [35, 122, 65, 255]);
  const withSubject = mk((x, y) => ((x - 30) ** 2 + (y - 30) ** 2 < 400 ? [235, 235, 235, 255] : stripes(x, y)));
  const without = mk(stripes);
  const box = { x: 0, y: 0, w: 60, h: 60 };
  assert.ok(ownPixelFraction(withSubject, without, box) > 0.15, 'a real subject changes a lot when hidden');
  assert.equal(ownPixelFraction(without, without, box), 0, 'an element that renders nothing changes nothing');
  assert.equal(OWN_MIN_FRACTION, 0.005);
  // integration: mock = stripes + disc, built = stripes + an EMPTY element: edge energy, stddev and diff all pass, own pixels must fail
  if (skipNoChrome(t)) return;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-own-'));
  const band = '<style>body{margin:0;height:300px;background:repeating-linear-gradient(45deg,#237A41 0 8px,#2E8B4E 8px 16px)}</style>';
  const disc = 'position:absolute;left:100px;top:60px;width:180px;height:180px;border-radius:50%';
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    const body = u === '/ok' ? `<div data-design="t.m" style="${disc};background:#eee"></div>` : u === '/blank' ? `<div data-design="t.m" style="${disc}"></div>` : '';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><meta charset="utf-8">${band}${body}`);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const design = path.join(tmp, 'design'); fs.mkdirSync(path.join(design, 'mocks'), { recursive: true });
    fs.writeFileSync(path.join(design, 'mocks', 'band.html'), `<!doctype html><meta charset="utf-8">${band}<div style="${disc};background:#eee"></div>`);
    const contracts = path.join(tmp, 'c'); fs.mkdirSync(contracts);
    for (const id of ['ok', 'blank']) fs.writeFileSync(path.join(contracts, id + '.json'), JSON.stringify({
      id, release: 0, mock: { 390: 'mocks/band.html' }, viewport: { 390: 300 }, built: { path: '/' + id, state: 'first-visit' }, order: [], texts: [],
      regions: [{ id: 't.m', mock_box: { 390: [100, 60, 180, 180] }, ceiling: 1.0 }], diff_ceiling: { 390: 1 }, capture: 'viewport',
    }));
    const report = await runFidelity({ design, contracts, base: 'http://127.0.0.1:' + server.address().port, out: path.join(tmp, 'o'), 'state-driver': GOTO });
    const by = Object.fromEntries(report.results.map(r => [r.contract, r.checks.find(c => c.name === 'region:t.m')]));
    assert.equal(by.ok.pass, true, by.ok.detail);
    assert.equal(by.blank.pass, false);
    assert.match(by.blank.detail, /hiding the element changes only 0\.0% of its box/);
    assert.ok(!/edge energy/.test(by.blank.detail) && !/uniform/.test(by.blank.detail), 'the OTHER empty checks pass: only own-pixels catches it: ' + by.blank.detail);
  } finally { await new Promise(r => server.close(r)); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('every data_bound value is bound or declared unbound with a reason (classifyDataBound)', async () => {
  const { classifyDataBound } = await import('../scripts/design/lib/binding.mjs');
  const c = { data_bound: ['Chào Minh!', '55', 'Đã đọc', '2 / 21'], unbound: { 'Đã đọc': 'no such data', '2 / 21': '   ' } };
  const r = classifyDataBound(c, { expect: ['Chào Bảo!', '187'], absent: ['Chào Minh!', '55'] });
  assert.deepEqual(r.bound, ['Chào Minh!', '55']); assert.deepEqual(r.declared, ['Đã đọc']); assert.deepEqual(r.undeclared, ['2 / 21']); assert.deepEqual(r.noReason, ['2 / 21']);
  const empty = classifyDataBound({ data_bound: ['Chào Minh!'] }, { expect: [], absent: [] });
  assert.deepEqual(empty.undeclared, ['Chào Minh!'], 'empty expectations bind nothing');
  assert.deepEqual(classifyDataBound({ data_bound: ['1.080 XP'] }, { expect: ['2.310 XP'], absent: ['1.080 XP'] }).bound, ['1.080 XP']);
  assert.deepEqual(classifyDataBound({ data_bound: ['[Tên quà] Sticker'] }, { expect: [], absent: ['Sticker'] }).bound, ['[Tên quà] Sticker'], 'placeholder prefix of a bound name');
  assert.deepEqual(classifyDataBound({ data_bound: ['oan'] }, { expect: ['Hoang'], absent: [] }).undeclared, ['oan'], 'a short expectation that merely sits inside the value ("oan" in "Hoang") covers nothing');
  assert.deepEqual(classifyDataBound({ data_bound: ['Hoang'] }, { expect: ['oan'], absent: [] }).undeclared, ['Hoang'], 'and the reverse: "oan" does not cover "Hoang"');
  assert.deepEqual(classifyDataBound({ data_bound: ['Bộ 1 · Quyển 2 · Bài 4'] }, { expect: [], absent: ['Quyển 2 · Bài 4'] }).bound, ['Bộ 1 · Quyển 2 · Bài 4'], 'a whole run of " · " parts covers the composite');
  assert.deepEqual(classifyDataBound({ data_bound: ['Bộ 1 · Quyển 2 · Bài 4'] }, { expect: [], absent: ['Quyển 2 · Bà'] }).undeclared, ['Bộ 1 · Quyển 2 · Bài 4'], 'a partial part is no cover');
  assert.deepEqual(classifyDataBound({ data_bound: ['Bộ 1 · Quyển 2 · Bài 4'] }, { expect: [], absent: ['Bộ 1'] }).undeclared, ['Bộ 1 · Quyển 2 · Bài 4'], 'one part of three ("Bộ 1") is under half: no cover');
  assert.deepEqual(classifyDataBound({ data_bound: ['55'] }, { expect: ['5'], absent: [] }).undeclared, ['55'], 'a 1-character expectation does not cover everything');
});

test('data_bound coverage in the harness: empty expectations FAIL; an unbound value with a reason passes, without a reason fails', async t => {
  if (skipNoChrome(t)) return;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-unbound-'));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><meta charset="utf-8"><body style="font:20px sans-serif"><h1>Chào Bảo!</h1><p>187</p><p>Mũ tiệc</p>'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const design = writeBindingDesign(tmp);
    const mkDriver = (name, db) => fs.writeFileSync(path.join(tmp, name + '.mjs'), `export default async (page, c, base, ctx) => { await page.goto(base + '/x'); return { dataBinding: ${JSON.stringify(db)}, altSample: ctx.opts.sample ? undefined : 'ALT.json' }; };\n`);
    mkDriver('empty', { expect: [], absent: [] });
    mkDriver('good', { expect: ['Chào Bảo!', '187'], absent: ['Chào Minh!', '55'] });
    const run = async (id, driver, extra) => {
      const dir = path.join(tmp, 'c-' + id); fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify({ ...BASE_CONTRACT, id, anchors: undefined, built: { path: '/x', state: 'first-visit' }, ...extra }));
      const rep = await runFidelity({ design, contracts: dir, base: 'http://127.0.0.1:' + server.address().port, out: path.join(tmp, 'o-' + id), 'state-driver': path.join(tmp, driver + '.mjs') });
      return rep.results[0].checks.find(c => c.name === 'data-binding');
    };
    const e = await run('e1', 'empty', { data_bound: ['Chào Minh!'] });
    assert.equal(e.pass, false); assert.match(e.detail, /data_bound value not bound and not declared unbound: "Chào Minh!"/);
    const okBound = await run('e2', 'good', { data_bound: ['Chào Minh!', '55', 'Mũ tiệc'], unbound: { 'Mũ tiệc': 'catalogue part name' } });
    assert.equal(okBound.pass, true, okBound.detail); assert.match(okBound.detail, /data_bound: 2 bound, 1 declared unbound/);
    const noReason = await run('e3', 'good', { data_bound: ['Chào Minh!', '55', 'Mũ tiệc'], unbound: { 'Mũ tiệc': '' } });
    assert.equal(noReason.pass, false); assert.match(noReason.detail, /not bound and not declared unbound: "Mũ tiệc"/); assert.match(noReason.detail, /unbound without a reason: "Mũ tiệc"/);
    const elsewhere = await run('e5', 'good', { data_bound: ['Chào Minh!', '55', 'Chỉ ở 1280'] });
    assert.equal(elsewhere.pass, true, 'a data_bound value THIS width\'s mock does not show is not required here: ' + elsewhere.detail);
    const missing = await run('e4', 'good', { data_bound: ['Chào Minh!', '55', 'Mũ tiệc'] });
    assert.equal(missing.pass, false); assert.match(missing.detail, /not declared unbound: "Mũ tiệc"/);
  } finally { await new Promise(r => server.close(r)); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('data-binding token matching: no hits inside longer numbers or words', async () => {
  const { containsToken } = await import('../scripts/design/lib/text.mjs');
  assert.equal(containsToken('Sách 1.200 kim cương', '200 kim cương'), false, '"200" is the tail of 1.200');
  assert.equal(containsToken('Sách 1.200 kim cương', '1.200 kim cương'), true);
  assert.equal(containsToken('Quyển 10 · Bài 3', 'Quyển 1'), false); assert.equal(containsToken('Quyển 1 · Bài 3', 'Quyển 1'), true);
  assert.equal(containsToken('#11 Mina', '#1'), false); assert.equal(containsToken('#1 Hoang #11', '#1'), true);
  assert.equal(containsToken('1.160 kim cương', '60 kim cương'), false);
  assert.equal(containsToken('Còn 62 kim cương', '65'), false);
  assert.equal(containsToken('Quyên Quyển', 'Quyên'), true); assert.equal(containsToken('Quyênx', 'Quyên'), false);
  assert.equal(containsToken('Chào Bảo! 187', '187'), true); assert.equal(containsToken('1.187', '187'), false); assert.equal(containsToken('1187', '187'), false);
  assert.equal(containsToken('3 ngày', '3 ngày'), true); assert.equal(containsToken('13 ngày', '3 ngày'), false);
  assert.equal(containsToken('xin chào', ''), true);
  assert.equal(containsToken('Bạc ★★★', 'Bạc ★★'), false, 'symbol run: ★★ is not the head of ★★★');
  assert.equal(containsToken('Bạc ★★', 'Bạc ★★'), true); assert.equal(containsToken('Bạc ★★ · 3 ngày', 'Bạc ★★'), true);
  assert.equal(containsToken('★★★ Bạc', '★★'), false); assert.equal(containsToken('Hạng ★', '★'), true); assert.equal(containsToken('#1 Hoang', '#1'), true);
});

test('companion: the next-option step accepts the "→" text button AND the icon button named "Lựa chọn tiếp"', async t => {
  if (skipNoChrome(t)) return;
  const { previewHatOption2 } = await import('../scripts/design/drivers/r2l.mjs');
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: findChrome() });
  try {
    for (const next of ['<button id="n">→</button>', '<button id="n" aria-label="Lựa chọn tiếp"><svg width="10" height="10"></svg></button>']) {
      const page = await browser.newPage();
      await page.setContent(`<body><button>Thân</button><button>Mũ</button>${next}<span id="c">1 / 21</span><span id="u" hidden>Chưa lưu</span><script>
        document.getElementById('n').onclick=()=>{document.getElementById('c').textContent='2 / 21';document.getElementById('u').hidden=false};</script>`);
      await previewHatOption2(page);
      assert.equal(await page.textContent('#c'), '2 / 21', next);
      await page.close();
    }
    const page = await browser.newPage();
    await page.setContent('<body><button>Mũ</button><button>Quay lại</button>');
    await assert.rejects(previewHatOption2(page), /no next-option button/);
    await page.close();
  } finally { await browser.close(); }
});

test('R1 regression (opt-in: DESIGN_R1_URL=<rehearsal url of a Release-1 build>): still-twin passes on every R1 contract again', async t => {
  if (!process.env.DESIGN_R1_URL) return t.skip('set DESIGN_R1_URL to the URL of a rehearsal server running the Release-1 build (main 87c7080)');
  if (skipNoChrome(t)) return;
  const contracts = process.env.DESIGN_CONTRACTS || path.resolve(root, '..', '..', '..', '..', '_ops', 'specs', 'design-contracts', 'r2l-island');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-r1-'));
  try {
    fs.mkdirSync(path.join(tmp, 'c'));
    for (const id of ['home-empty', 'home-first-visit', 'home-mid-story', 'rank-up', 'reward']) fs.copyFileSync(path.join(contracts, id + '.json'), path.join(tmp, 'c', id + '.json'));
    const rep = await runFidelity({ design: REAL_DESIGN, contracts: path.join(tmp, 'c'), base: process.env.DESIGN_R1_URL, out: process.env.DESIGN_OUT || path.join(tmp, 'o'), 'state-driver': path.join(root, 'scripts', 'design', 'drivers', 'r2l.mjs'), concurrency: 3 });
    for (const r of rep.results) assert.equal(r.checks.find(c => c.name === 'still-twin').pass, true, `${r.contract}@${r.width}: ${r.checks.find(c => c.name === 'still-twin').detail}`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('pixel sampler: dominant background wins over heavy glyph pixels', () => {
  const png = new PNG({ width: 20, height: 10 });
  for (let i = 0; i < 200; i++) { const dark = i % 20 < 12; png.data.set(dark ? [0, 0, 0, 255] : [250, 250, 250, 255], i * 4); }
  // 60% of the pixels are glyph-coloured (black); the background is white, and must still be picked
  const bg = sampleBackdrop(PNG.sync.read(PNG.sync.write(png)), { x: 0, y: 0, w: 20, h: 10 }, [0, 0, 0]);
  assert.ok(bg[0] > 240);
  assert.equal(sampleBackdrop(PNG.sync.read(PNG.sync.write(png)), { x: 100, y: 100, w: 5, h: 5 }, [0, 0, 0]), null);
});

test('(ii) REAL design: the real home mock rendered against itself gives a pixel diff of exactly 0', async t => {
  if (skipNoChrome(t)) return;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-self-'));
  try {
    fs.mkdirSync(path.join(tmp, 'c'));
    fs.writeFileSync(path.join(tmp, 'c', 'self.json'), JSON.stringify({
      id: 'home-self', release: 0,
      mock: { 390: 'mocks/01-home-390.html', 1280: 'mocks/01-home-1280.html' },
      viewport: { 390: 1600, 1280: 1000 }, built: { path: '/', state: 'first-visit' },
      order: [], texts: [], diff_ceiling: { 390: 0.0001, 1280: 0.0001 },
    }));
    const report = await runFidelity({
      design: REAL_DESIGN, contracts: path.join(tmp, 'c'), base: 'http://unused.invalid', out: path.join(tmp, 'out'),
      'state-driver': path.join(root, 'scripts', 'design', 'drivers', 'mock-self.mjs'),
    });
    for (const r of report.results) {
      assert.equal(r.diff.pixels, 0, `${r.width}px mock-vs-mock must be identical`);
      for (const n of ['pixel-diff', 'height', 'fonts', 'texts', 'contrast>=4.5', 'reduced-motion', 'still-twin'].filter(n => r.checks.some(c => c.name === n)))
        assert.equal(r.checks.find(c => c.name === n).pass, true, `${r.width}px ${n}: ${r.checks.find(c => c.name === n).detail}`);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('(i) REAL navy home FAILS the real home-first-visit contract (opt-in: DESIGN_BITE_NAVY=1)', async t => {
  if (process.env.DESIGN_BITE_NAVY !== '1') return t.skip('set DESIGN_BITE_NAVY=1 (needs a dist/ build + ~/work/r2l-releases/v105-20261019); run scripts/design/bite-navy.sh');
  if (skipNoChrome(t)) return;
  const contracts = process.env.DESIGN_CONTRACTS || path.resolve(root, '..', '..', '..', '..', '_ops', 'specs', 'design-contracts', 'r2l-island');
  const candidate = process.env.R2L_CANDIDATE || path.join(os.homedir(), 'work', 'r2l-releases', 'v105-20261019');
  const proc = spawn('node', [path.join(root, 'scripts', 'r2l-release', 'rehearse.mjs'), '--candidate', candidate, '--repo', root, '--serve'], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const info = await new Promise((resolve, reject) => {
      let buf = '';
      proc.stdout.on('data', d => { buf += d; const m = /"url":\s*"([^"]+)"/.exec(buf); if (m && buf.includes('}')) resolve(JSON.parse(buf)); });
      proc.on('exit', c => reject(new Error('rehearse exited ' + c)));
      setTimeout(() => reject(new Error('rehearse did not start')), 60000);
    });
    const out = process.env.DESIGN_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'design-navy-'));
    const report = await runFidelity({ design: REAL_DESIGN, contracts, base: info.url, out, only: 'home-first-visit', token: 'b'.repeat(32) });
    assert.equal(report.ok, false);
    for (const r of report.results) {
      const f = failed(r);
      assert.ok(f.includes('order'), `${r.width}: contract order must fail, got ${f}`);
      assert.ok(f.includes('primary'), `${r.width}: primary must fail`);
      assert.ok(f.includes('pixel-diff'), `${r.width}: diff ceiling must fail`);
      assert.ok(!f.includes('state-driver'), `${r.width}: the navy home IS the first-visit state; the state check must pass, got ${f}`);
    }
  } finally { proc.kill('SIGTERM'); }
});
