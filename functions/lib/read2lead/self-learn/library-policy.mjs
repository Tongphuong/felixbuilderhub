/** Transparent editorial interests and same-level suggestions; never an assessment or promotion rule. */
import { validId } from '../../../../src/lib/read2lead/self-learn/session-contract.mjs';
const exact = (v,keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k=>Object.hasOwn(v,k));
const text = v => typeof v === 'string' && v === v.trim() && v.length > 0 && [...v].length <= 100 && !/[\u0000-\u001f\u007f]/u.test(v);
export function validateLibraryInterests(source, lessons) {
  if (!exact(source,['format','purpose','groups']) || source.format !== 1 || source.purpose !== 'read2lead-synthetic-library-interests' || !Array.isArray(source.groups) || source.groups.length !== 6 || !Array.isArray(lessons) || !lessons.length) throw Error('invalid_library_interests');
  const ids = new Set(), themes = new Set();
  for (const g of source.groups) {
    if (!exact(g,['id','label_vi','themes']) || !validId(g.id) || ids.has(g.id) || !text(g.label_vi) || !Array.isArray(g.themes) || !g.themes.length || g.themes.length > 30 || g.themes.some(t=>!text(t) || themes.has(t)) || new Set(g.themes).size !== g.themes.length) throw Error('invalid_library_interests');
    ids.add(g.id); g.themes.forEach(t=>themes.add(t));
  }
  if (lessons.some(l=>!themes.has(l?.theme))) throw Error('unmapped_library_theme');
  return structuredClone(source.groups);
}
export function librarySuggestions({ lessons, groups, level, interestIds, favoriteIds, seenIds, limit = 3 }) {
  if (!/^L[0-5]$/.test(level) || !Number.isSafeInteger(limit) || limit < 1 || limit > 10) throw Error('invalid_suggestion_request');
  const selected = new Set(interestIds), favorites = new Set(favoriteIds), seen = new Set(seenIds);
  const wantedThemes = new Set(groups.filter(g=>selected.has(g.id)).flatMap(g=>g.themes));
  return lessons.filter(l=>l.level===level).map(l=>({ lesson_id:l.id, interested:wantedThemes.has(l.theme), favorite:favorites.has(l.id), seen:seen.has(l.id) }))
    .sort((a,b)=>Number(b.interested)-Number(a.interested) || Number(b.favorite)-Number(a.favorite) || Number(a.seen)-Number(b.seen) || a.lesson_id.localeCompare(b.lesson_id,'en'))
    .slice(0,limit).map(l=>({ lesson_id:l.lesson_id, reason:l.interested ? 'same_level_interest' : l.favorite ? 'same_level_favorite' : l.seen ? 'same_level_reread' : 'same_level_new' }));
}
