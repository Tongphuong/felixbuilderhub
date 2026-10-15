#!/usr/bin/env python3
"""Join a reviewed story index to original media, without guessing page offsets."""
import argparse,calendar,copy,hashlib,json,re,importlib.util
from pathlib import Path

def recover_numbered_aliases(library,inventory):
    spec=importlib.util.spec_from_file_location('book_library',Path(__file__).with_name('read2lead-book-library.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    aliases={}
    for row in inventory['members']:
        if row.get('kind')!='audio':continue
        level,month,day=module.location(row)
        if level not in (1,2,3) or type(month) is not int or not 1<=month<=12 or type(day) is not int or not 1<=day<=31:continue
        key=(f'c{level}-b{month:02d}',row['sha256']);aliases.setdefault(key,set()).add(day)
    for b in library['books']:
        for track in b['tracks']:
            if track['day'] is not None:continue
            candidates=aliases.get((b['id'],track['media']),set())
            if len(candidates)>1:raise ValueError('conflicting_audio_aliases')
            if candidates:
                track['day']=next(iter(candidates));track['title']=f"{b['id']}-s{track['day']:02d}"
    return library

def story_library(library,index,inventory=None):
    result=copy.deepcopy(library)
    if inventory is not None:recover_numbered_aliases(result,inventory)
    books={b['id']:b for b in result['books']}
    if index.get('format')!='read2lead-story-index-v1':raise ValueError('invalid_story_index')
    stories=[];seen=set();used_pages=set()
    for row in index['stories']:
        book=books.get(row['bookId']);day=row['number']
        if not book or type(day) is not int or not 1<=day<=calendar.monthrange(2025,book['month'])[1]:raise ValueError('invalid_story_identity')
        sid=f"{book['id']}-s{day:02d}"
        if row['id']!=sid or sid in seen or row['pdf']!=book['pdf']:raise ValueError('story_identity_conflict')
        if not isinstance(row['title'],str) or not row['title'].strip() or len(row['title'])>200 or not row.get('evidence'):raise ValueError('unreviewed_story')
        pages=row['pages']
        if not isinstance(pages,list) or (pages and (len(pages)!=2 or any(type(p) is not int or not 4<=p<book['pages'] for p in pages) or pages[1]!=pages[0]+1)):raise ValueError('invalid_story_pages')
        for p in pages:
            key=(book['id'],p)
            if key in used_pages:raise ValueError('overlapping_story_pages')
            used_pages.add(key)
        tracks=sorted((t for t in book['tracks'] if t['day']==day),key=lambda t:(not bool(re.match(r'^[bB]\d+[sS]\d+',t['title'])),t['title'],t['media']))
        audio=list(dict.fromkeys(t['media'] for t in tracks))
        if any(result['media'].get(h,{}).get('mime')!='audio/mpeg' for h in audio):raise ValueError('invalid_story_audio')
        stories.append(dict(id=sid,bookId=book['id'],number=day,title=row['title'],pages=pages,audio=audio,
                            pageStatus='present' if pages else 'missing_from_scan',audioMatching='source_book_and_story_number' if audio else 'missing'))
        seen.add(sid)
    expected={f"{b['id']}-s{n:02d}" for b in books.values() for n in range(1,calendar.monthrange(2025,b['month'])[1]+1)}
    if seen!=expected:raise ValueError('incomplete_story_index')
    result['stories']=sorted(stories,key=lambda s:s['id']);result['matching']='reviewed_story_pages_and_numbered_audio'
    result['counts'].update(stories=len(stories),readableStories=sum(bool(s['pages']) for s in stories),storiesWithAudio=sum(bool(s['audio']) for s in stories),readAndListenStories=sum(bool(s['pages'] and s['audio']) for s in stories))
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--library',required=True);p.add_argument('--index',required=True);p.add_argument('--output',required=True);p.add_argument('--inventory');a=p.parse_args()
    result=story_library(json.loads(Path(a.library).read_text()),json.loads(Path(a.index).read_text()),json.loads(Path(a.inventory).read_text()) if a.inventory else None)
    data=json.dumps(result,ensure_ascii=False,separators=(',',':')).encode();Path(a.output).write_bytes(data)
    print(json.dumps({'manifestSha256':hashlib.sha256(data).hexdigest(),'counts':result['counts']}))
