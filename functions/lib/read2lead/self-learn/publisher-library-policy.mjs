/** Source sequence and reading invitations. Completion here means exposure, never mastery. */
export const comparePublisherSource = (a,b) => a.source.collection_level-b.source.collection_level
  || a.source.month-b.source.month || a.source.story_number-b.source.story_number || a.id.localeCompare(b.id,'en');

export function validatePublisherSeries(lessons) {
  const sources=new Map(),slots=new Set();
  for(const lesson of lessons) {
    const s=lesson.source,slot=JSON.stringify([s.collection_id,s.edition_id,s.month,s.story_number]);
    if(sources.has(s.source_id)||slots.has(slot))throw Error('publisher_source_slot_conflict');
    sources.set(s.source_id,lesson);slots.add(slot);
  }
  for(const lesson of lessons) {
    const s=lesson.source,prior=sources.get(s.predecessor_source_id);
    // Missing predecessors can be reconciled later; known contradictory links cannot.
    if(prior&&(prior.source.collection_id!==s.collection_id||prior.source.collection_level!==s.collection_level
      ||prior.source.edition_id!==s.edition_id||comparePublisherSource(prior,lesson)>=0))throw Error('invalid_publisher_series_order');
  }
  return sources;
}

export function publisherSuggestions({lessons,groups,level,interestIds,favoriteIds,readings=[],sessions=[],limit=3}) {
  if(!/^L[0-5]$/.test(level)||!Number.isSafeInteger(limit)||limit<1||limit>10)throw Error('invalid_suggestion_request');
  const sources=validatePublisherSeries(lessons),completed=new Set(),seen=new Set(),finishedAt=new Map();
  const stamp=row=>Number.isFinite(Date.parse(row.updated_at))?Date.parse(row.updated_at):0;
  for(const row of [...readings,...sessions]) {
    seen.add(row.source_id);
    if(row.status==='complete') {
      completed.add(row.source_id);finishedAt.set(row.source_id,Math.max(finishedAt.get(row.source_id)||0,stamp(row)));
    }
  }
  const eligible=lesson=>{
    const visited=new Set();let previous=lesson.source.predecessor_source_id;
    while(previous!==null) {
      if(visited.has(previous)||!completed.has(previous)||!sources.has(previous))return false;
      visited.add(previous);previous=sources.get(previous).source.predecessor_source_id;
    }
    return true;
  };
  const interests=new Set(interestIds),favorites=new Set(favoriteIds);
  const themes=new Set(groups.filter(g=>interests.has(g.id)).flatMap(g=>g.themes));
  const continuation=(lesson,rows)=>rows.filter(row=>row.available&&row.lesson_id===lesson.id&&row.source_id===lesson.source.source_id
    &&row.version===lesson.version&&row.level===level&&row.status!=='complete')
    .sort((a,b)=>stamp(b)-stamp(a)||a.id.localeCompare(b.id,'en'))[0];
  return lessons.filter(l=>l.level===level&&eligible(l)).map(lesson=>({lesson,
    session:continuation(lesson,sessions),reading:continuation(lesson,readings),
    interested:themes.has(lesson.theme),favorite:favorites.has(lesson.id),completed:completed.has(lesson.source.source_id),seen:seen.has(lesson.source.source_id)
  })).sort((a,b)=>Number(!!(b.session||b.reading))-Number(!!(a.session||a.reading))
    ||Number(a.completed)-Number(b.completed)||Number(b.interested)-Number(a.interested)||Number(b.favorite)-Number(a.favorite)
    ||Number(a.seen)-Number(b.seen)||(a.completed&&b.completed?(finishedAt.get(a.lesson.source.source_id)||0)-(finishedAt.get(b.lesson.source.source_id)||0):0)
    ||comparePublisherSource(a.lesson,b.lesson))
    .slice(0,limit).map(row=>({lesson_id:row.lesson.id,
      reason:row.session?'publisher_continue_practice':row.reading?'publisher_continue_reading':row.completed?'same_level_reread':row.interested?'same_level_interest':row.favorite?'same_level_favorite':'same_level_new',
      ...(row.session?{session_id:row.session.id}:row.reading?{reading_id:row.reading.id}:{})}));
}
