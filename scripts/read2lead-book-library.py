#!/usr/bin/env python3
"""Package original books/recordings for authenticated reading, not graded lessons."""
import argparse, hashlib, json, re, subprocess
from pathlib import Path

PART_BYTES = 8 * 1024 * 1024

def location(member):
    name = member['member']
    hints = member.get('hints', {})
    level, month, day = (hints.get(k) for k in ('collection_level_hint','month_hint','story_number_hint'))
    m = re.search(r'(?:PDF|Audio) Level ([123])', name, re.I)
    if m: level = int(m[1])
    m = re.search(r'Audio Level [123]/\s*(\d+)/', name, re.I)
    if m: month = int(m[1])
    m = re.search(r'Book\s*(\d+)\.pdf$', name, re.I)
    if m: month = int(m[1])
    base = Path(name).name
    for pattern in [r'^[bB](\d+)[sS](\d+)',r'^A(\d{2})(\d{2})']:
        m = re.match(pattern, base)
        if m:
            month, day = map(int, m.groups())
            if base.startswith('A'): level = 1
            break
    if day is None:
        m = re.match(r'^(?:Track\s*)?(\d+)', base, re.I)
        if m: day = int(m[1])
    return level, month, day

def package_library(intake, output):
    intake, output = Path(intake).resolve(), Path(output).absolute()
    if output.exists(): raise ValueError('output_already_exists')
    inventory = json.loads((intake/'inventory.json').read_text())
    media, books, unmapped = {}, {}, []
    for row in inventory['members']:
        if row['kind'] not in ('pdf','audio'): continue
        h = row['sha256']
        if not re.fullmatch(r'[a-f0-9]{64}',h): raise ValueError('invalid_hash')
        suffix = '.pdf' if row['kind']=='pdf' else '.mp3'
        if row['private_object'] != 'objects/'+h+suffix: raise ValueError('unsafe_object')
        level, month, day = location(row)
        if level not in (1,2,3) or not isinstance(month,int) or not 1<=month<=12:
            unmapped.append({'hash':h,'member':row['member']}); continue
        key=f'c{level}-b{month:02d}'
        book=books.setdefault(key,{'id':key,'collection':level,'month':month,'pdf':None,'pages':None,'tracks':[]})
        if h not in media:
            media[h]={'bytes':row['bytes'],'mime':'application/pdf' if suffix=='.pdf' else 'audio/mpeg','parts':[],
                      'filename':Path(row['member']).name,'source':row['private_object']}
        if suffix=='.pdf':
            if book['pdf'] and book['pdf']!=h: raise ValueError('conflicting_book_pdf')
            book['pdf']=h
        elif not any(t['media']==h for t in book['tracks']):
            book['tracks'].append({'media':h,'day':day,'title':Path(row['member']).stem})
    # Unlabelled duplicate PDFs from the alternate archive remain represented by hash.
    unresolved=[r for r in unmapped if r['hash'] not in media]
    if unresolved: raise ValueError('unmapped_distinct_media: '+str(unresolved[:3]))
    if len(books)!=36 or any(not b['pdf'] for b in books.values()): raise ValueError('incomplete_book_inventory')
    output.mkdir(parents=True)
    part_root=output/'__private/book-parts';part_root.mkdir(parents=True)
    for h, item in media.items():
        source=intake/item.pop('source')
        if source.is_symlink() or source.stat().st_size!=item['bytes']: raise ValueError('source_size_or_path')
        digest=hashlib.sha256()
        with source.open('rb') as f:
            while block:=f.read(PART_BYTES):
                digest.update(block);part=hashlib.sha256(block).hexdigest();target=part_root/(part+'.bin')
                if target.exists():
                    if target.read_bytes()!=block: raise ValueError('part_collision')
                else: target.write_bytes(block)
                item['parts'].append({'hash':part,'bytes':len(block)})
        if digest.hexdigest()!=h: raise ValueError('source_hash_mismatch')
        if item['mime']=='application/pdf':
            info=subprocess.run(['pdfinfo',str(source)],check=True,capture_output=True,text=True).stdout
            pages=int(re.search(r'^Pages:\s+(\d+)',info,re.M)[1])
            for b in books.values():
                if b['pdf']==h:b['pages']=pages
    for book in books.values():book['tracks'].sort(key=lambda t:(t['day'] if t['day'] is not None else 999,t['title'],t['media']))
    result={'format':'read2lead-book-library-v1','books':sorted(books.values(),key=lambda b:(b['collection'],b['month'])),'media':media,
            'counts':{'books':len(books),'recordings':sum(m['mime']=='audio/mpeg' for m in media.values()),'bytes':sum(m['bytes'] for m in media.values())},
            'matching':'source_filename_only','completeInteractiveLessons':0}
    data=json.dumps(result,ensure_ascii=False,separators=(',',':')).encode();(output/'__private/book-library.json').write_bytes(data)
    return {'manifestSha256':hashlib.sha256(data).hexdigest(),'counts':result['counts'],'parts':len(list(part_root.iterdir()))}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--intake',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    print(json.dumps(package_library(a.intake,a.output)))
