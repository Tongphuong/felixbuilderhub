#!/usr/bin/env python3
"""Local OCR evidence reconciliation. No text approval, inferred story creation or network access."""
import argparse
import calendar
import collections
import csv
import difflib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import statistics
import unicodedata


def sha_file(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def number(text):
    m = re.fullmatch(r'\(?([0-9]{1,3})[.,:;)]?', text.strip())
    return int(m[1]) if m else None


def normalized(text):
    return ''.join(c for c in unicodedata.normalize('NFKD', text).casefold() if c.isalnum())


def read_tsv(path):
    with Path(path).open(encoding='utf-8') as stream:
        rows = list(csv.DictReader(stream, delimiter='\t'))
    if not rows or rows[0].get('level') != '1':
        raise ValueError('invalid_ocr_tsv')
    width, height = int(rows[0]['width']), int(rows[0]['height'])
    if width <= 0 or height <= 0:
        raise ValueError('invalid_ocr_dimensions')
    words = []
    for r in rows:
        if r['level'] != '5' or not r['text'].strip():
            continue
        x, y, w, h = [int(r[k]) for k in ['left', 'top', 'width', 'height']]
        if min(x, y, w, h) < 0 or x + w > width + 1 or y + h > height + 1:
            raise ValueError('invalid_ocr_bounds')
        words.append({'text': r['text'], 'x': x / width, 'y': (y + h / 2) / height,
                      'width': w / width, 'height': h / height, 'confidence': float(r['conf']),
                      'line': (r['block_num'], r['par_num'], r['line_num'])})
    return words


def cluster(values, key, tolerance):
    groups = []
    for value in sorted(values, key=key):
        closest = min(groups, key=lambda group: abs(key(value) - statistics.median(key(v) for v in group)), default=None)
        if closest is not None and abs(key(value) - statistics.median(key(v) for v in closest)) <= tolerance:
            closest.append(value)
        else:
            groups.append([value])
    return groups


def title_text(words):
    # Keep raw tokens separately: removing obvious dot leaders is an OCR suggestion, never an approved title.
    selected = []
    for w in sorted(words, key=lambda w: w['x']):
        text = w['text']
        if re.search(r'[._~…]{2,}|([a-z])\1{3,}', text, re.I):
            break
        if any(c.isalpha() for c in text) or text in ['I', 'II', 'III', '&', '-', '(1)', '(2)', '(3)']:
            selected.append(text)
    return ' '.join(selected).strip()


def toc_rows(words):
    possible = [w for w in words if .05 <= w['x'] <= .25 and .12 <= w['y'] <= .93
                and number(w['text']) is not None and 1 <= number(w['text']) <= 40]
    groups = cluster(possible, lambda w: w['x'], .018)
    column = max(groups, key=len, default=[])
    right_words = [w for w in words if .65 <= w['x'] <= .96 and .12 <= w['y'] <= .93 and number(w['text']) is not None and 1 <= number(w['text']) <= 100]
    right_groups = cluster(right_words, lambda w: w['x'], .03)
    right_group = max(right_groups, key=len, default=[])
    if len(column) < 4 and len(right_group) < 4:
        return []
    right = statistics.median(w['x'] for w in right_group) if len(right_group) >= 4 else .95
    right_words = [w for w in right_group if abs(w['x'] - right) <= .035]
    if len(column) >= 4:
        left = statistics.median(w['x'] for w in column)
    else:
        # A real printed-page column can anchor unnumbered rows; never derive a story number from it.
        starts = []
        for anchor in right_words:
            candidates = [w for w in words if .1 < w['x'] < .4 and abs(w['y'] - anchor['y']) <= .016 and w['height'] < .04 and w['confidence'] > 35 and any(c.isalpha() for c in w['text'])]
            if candidates:
                starts.append(min(candidates, key=lambda w: w['x']))
        title_columns = cluster(starts, lambda w: w['x'], .02)
        title_column = max(title_columns, key=len, default=[])
        if len(title_column) < 4:
            return []
        left = statistics.median(w['x'] for w in title_column) - .055
    left_words = [w for w in words if abs(w['x'] - left) <= .025 and .12 <= w['y'] <= .93 and number(w['text']) is not None]
    anchors = cluster(left_words + right_words, lambda w: w['y'], .014)
    rows = []
    for group in anchors:
        y = statistics.median(w['y'] for w in group)
        title = [w for w in words if left + .035 < w['x'] < right - .025 and abs(w['y'] - y) <= .016 and w['height'] < .04]
        cleaned = title_text(title)
        if len(normalized(cleaned)) < 3:
            continue
        nums = sorted({number(w['text']) for w in left_words if abs(w['y'] - y) <= .014})
        pages = sorted({number(w['text']) for w in right_words if abs(w['y'] - y) <= .014})
        rows.append({'y': round(y, 6), 'number_observations': nums, 'printed_page_observations': pages,
                     'title_candidate': cleaned, 'raw_title_tokens': [w['text'] for w in sorted(title, key=lambda w: w['x'])],
                     'title_mean_confidence': round(statistics.mean(w['confidence'] for w in title), 2),
                     'column_x': round(left, 5)})
    return rows


def merge_rows(observations, pdf_sha, toc_page):
    merged = []
    for rank, group in enumerate(cluster(observations, lambda row: row['y'], .018), 1):
        nums = sorted({n for row in group for n in row['number_observations']})
        pages = sorted({n for row in group for n in row['printed_page_observations']})
        title_rows = sorted(group, key=lambda row: (row['title_mean_confidence'], len(normalized(row['title_candidate']))), reverse=True)
        titles = list(dict.fromkeys(row['title_candidate'] for row in title_rows))
        flags = []
        if len(nums) != 1:
            flags.append('story_number_conflict' if nums else 'story_number_unreadable')
        if len(pages) != 1:
            flags.append('printed_page_conflict' if pages else 'printed_page_unreadable')
        if len({normalized(t) for t in titles}) > 1:
            flags.append('title_ocr_disagreement')
        n = nums[0] if len(nums) == 1 and 1 <= nums[0] <= 99 else None
        if n is None and len(nums) == 1:
            flags.append('story_number_out_of_range')
        merged.append({'evidence_row_id': f'{pdf_sha[:24]}-toc{toc_page:03d}-r{rank:02d}',
                       'source_id_candidate': f'osad-{pdf_sha[:24]}-s{n:02d}' if n is not None else None,
                       'story_number_candidate': n, 'number_observations': nums,
                       'title_candidate': titles[0], 'title_alternatives': titles,
                       'printed_page_candidate': pages[0] if len(pages) == 1 else None,
                       'printed_page_observations': pages, 'toc_pdf_page': toc_page,
                       'observations': group, 'flags': flags,
                       'review_status': 'unverified_local_ocr_evidence', 'verified_text': None,
                       'audio_identity': None, 'read2lead_level': None, 'rights_status': 'unresolved',
                       'complete': False})
    return merged


def body_headings(words):
    lines = collections.defaultdict(list)
    for w in words:
        if .025 < w['y'] < .30 and .025 < w['x'] < .96:
            lines[w['line']].append(w)
    result = []
    for group in lines.values():
        text = ' '.join(w['text'] for w in sorted(group, key=lambda w: w['x']))
        if 3 <= len(normalized(text)) <= 140:
            result.append({'text': text, 'y': round(statistics.median(w['y'] for w in group), 5),
                           'height': round(statistics.median(w['height'] for w in group), 5)})
    return result


def match_body(row, pages):
    matches = []
    for page in pages:
        best = None
        for title in row['title_alternatives']:
            a = normalized(title)
            if len(a) < 4:
                continue
            for heading in page['headings']:
                b = normalized(heading['text'])
                score = difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()
                if score >= .86 and (best is None or score > best['score']):
                    best = {'pdf_page': page['pdf_page'], 'heading_ocr': heading['text'], 'score': round(score, 4),
                            'tsv_sha256': page['tsv_sha256'], 'printed_footer_candidates': page['footers']}
        if best:
            matches.append(best)
    matches.sort(key=lambda m: (-m['score'], m['pdf_page']))
    return matches


def isbn_valid(text):
    s = re.sub(r'[^0-9Xx]', '', text)
    if len(s) == 13 and s.isdigit():
        return sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(s)) % 10 == 0
    if len(s) == 10 and s[:9].isdigit() and (s[-1].isdigit() or s[-1].upper() == 'X'):
        return sum((10 - i) * (10 if c.upper() == 'X' else int(c)) for i, c in enumerate(s)) % 11 == 0
    return False


def credit_evidence(folder):
    result = []
    for n in [2, 3]:
        p = folder / f'page-{n:03d}.txt'
        if not p.exists():
            continue
        text = p.read_text()
        for line in text.splitlines():
            if re.search(r'ISBN|copyright|printing|©', line, re.I):
                candidate = re.search(r'ISBN[^0-9]*([0-9Xx][0-9Xx \-–]{8,25})', line, re.I)
                result.append({'pdf_page': n, 'ocr_sha256': sha_file(p), 'line_ocr': line,
                               'isbn_candidate': re.sub(r'[^0-9Xx]', '', candidate[1]) if candidate else None,
                               'isbn_checksum_valid': isbn_valid(candidate[1]) if candidate else False,
                               'verified': False})
    return result


def audio_index(inventory, media):
    index = collections.defaultdict(dict)
    hash_keys = collections.defaultdict(set)
    unresolved_files = []
    for item in inventory['members']:
        if item['kind'] != 'audio':
            continue
        hints = dict(item['hints']); origin = 'inventory_hints'
        member = PurePosixPath(item['member']) if 'member' in item else None
        if member and ('month_hint' not in hints or 'story_number_hint' not in hints):
            month = int(member.parent.name) if re.fullmatch(r'[1-9]|1[0-2]', member.parent.name) else None
            bilingual = re.fullmatch(r'([0-9]{1,2})\s+曲目\s+([0-9]{1,2})\.mp3', member.name, re.I)
            plain = re.fullmatch(r'([0-9]{1,2})\.mp3', member.name, re.I)
            track = int(bilingual[1]) if bilingual and int(bilingual[1]) == int(bilingual[2]) else int(plain[1]) if plain else None
            if month and track and 1 <= track <= 31:
                hints.update(month_hint=month, story_number_hint=track); origin = 'validated_numbered_filename_fallback'
        key = tuple(hints.get(k) for k in ['collection_level_hint', 'month_hint', 'story_number_hint'])
        if not all(isinstance(v, int) and v > 0 for v in key):
            unresolved_files.append({'sha256': item['sha256'], 'archive_sha256': item.get('archive_sha256'), 'member': item.get('member'), 'hints': hints, 'reason': 'no_complete_filename_number_hint'})
            continue
        sha = item['sha256']; hash_keys[sha].add(key)
        candidate = index[key].setdefault(sha, {'sha256': sha, 'verification': 'filename_hint_only',
                                               'prior_decode_status': media.get(sha, {}).get('decode_status', 'unknown'),
                                               'match_status': 'not_compared', 'listening_review': 'not_performed', 'files': []})
        candidate['files'].append({'archive_sha256': item['archive_sha256'], 'member': item['member'], 'hint_origin': origin})
    for candidates in index.values():
        for sha, candidate in candidates.items():
            candidate['other_number_hints'] = [list(k) for k in sorted(hash_keys[sha])] if len(hash_keys[sha]) > 1 else []
    for item in unresolved_files:
        item['same_hash_number_hints'] = [list(k) for k in sorted(hash_keys[item['sha256']])]
        item['match_status'] = 'not_compared'
    unassigned = sorted({item['sha256'] for item in unresolved_files if not hash_keys[item['sha256']]})
    return index, unassigned, unresolved_files


def reconcile(work, gaps_path=None):
    work = Path(work).resolve()
    books_path = work / 'book-ocr/books.json'
    books = json.loads(books_path.read_text())
    inventory_path, media_path = work / 'private-intake/inventory.json', work / 'media-analysis.json'
    recordings, unassigned_audio, unresolved_audio_files = audio_index(json.loads(inventory_path.read_text()), json.loads(media_path.read_text()))
    gaps = json.loads(Path(gaps_path).read_text())['gaps'] if gaps_path else []
    gap_index = {(g['pdf_sha256'], g['story_number']): g for g in gaps}
    output = {'format': 'r2l-source-reconciliation/1', 'private': True, 'source_books_sha256': sha_file(books_path),
              'method': 'positioned local OCR comparison; possible heading matches are not text/page verification',
              'story_counts_verified': False, 'complete_lessons': 0, 'books': [], 'entries': [],
              'audio_inventory_sha256': sha_file(inventory_path), 'prior_media_report_sha256': sha_file(media_path),
              'unassigned_audio_hashes': unassigned_audio, 'unresolved_audio_filenames': unresolved_audio_files, 'confirmed_gap_register': gaps,
              'confirmed_gap_register_sha256': sha_file(gaps_path) if gaps_path else None}
    for book in sorted(books, key=lambda b: (b['hints'].get('collection_level_hint', 99), b['hints'].get('month_hint', 99))):
        sha = book['sha256']
        if not re.fullmatch(r'[a-f0-9]{64}', sha):
            raise ValueError('invalid_pdf_hash')
        source_pdf = work / 'private-intake/objects' / (sha + '.pdf')
        if sha_file(source_pdf) != sha:
            raise ValueError('source_pdf_hash_mismatch')
        full = work / 'full-ocr' / sha
        rows, sources, toc_pages = [], [], []
        for n in range(1, 9):
            observations = []
            for name in ['full-ocr', 'contents-ocr']:
                p = work / name / sha / f'page-{n:03d}.tsv'
                if not p.exists():
                    continue
                source = {'path': str(p.relative_to(work)), 'sha256': sha_file(p)}
                sources.append(source)
                for row in toc_rows(read_tsv(p)):
                    observations.append({**row, 'ocr_source': source})
            merged = merge_rows(observations, sha, n)
            if len(merged) >= 6:
                toc_pages.append(n)
                rows.extend(merged)
        pages = []
        for p in sorted(full.glob('page-*.tsv')):
            n = int(p.stem.split('-')[1])
            if n <= max(toc_pages, default=5):
                continue
            words = read_tsv(p)
            pages.append({'pdf_page': n, 'tsv_sha256': sha_file(p), 'headings': body_headings(words),
                          'footers': sorted({number(w['text']) for w in words if w['y'] > .85 and number(w['text']) is not None and 1 <= number(w['text']) <= 100})})
        expected = calendar.monthrange(2025, book['hints']['month_hint'])[1]
        counts = collections.Counter(row['story_number_candidate'] for row in rows if row['story_number_candidate'] is not None)
        for row in rows:
            row.update({'pdf_sha256': sha, 'collection_level_hint': book['hints'].get('collection_level_hint'),
                        'month_hint': book['hints'].get('month_hint'), 'source_member': book['member'],
                        'possible_body_starts': match_body(row, pages)})
            if row['story_number_candidate'] is not None and row['story_number_candidate'] > expected:
                row['flags'].append('number_outside_calendar_requires_review')
            if counts[row['story_number_candidate']] > 1:
                row['flags'].append('duplicate_story_number'); row['source_id_candidate'] = None
            key = (row['collection_level_hint'], row['month_hint'], row['story_number_candidate'])
            row['audio_candidates'] = list(recordings.get(key, {}).values()) if row['source_id_candidate'] else []
            row['confirmed_source_gap'] = gap_index.get((sha, row['story_number_candidate']))
            if row['confirmed_source_gap']:
                row['flags'].append('confirmed_missing_source_scan')
            if not row['source_id_candidate']:
                row['flags'].append('audio_unassigned_story_number')
            elif not row['audio_candidates']:
                row['flags'].append('no_audio_filename_candidate')
            elif len(row['audio_candidates']) > 1:
                row['flags'].append('multiple_audio_hash_candidates')
            if any(a['other_number_hints'] for a in row['audio_candidates']):
                row['flags'].append('audio_number_hint_conflict')
            if len(row['possible_body_starts']) != 1:
                row['flags'].append('body_heading_ambiguous' if row['possible_body_starts'] else 'body_heading_not_matched')
        expected = calendar.monthrange(2025, book['hints']['month_hint'])[1]
        output['books'].append({'pdf_sha256': sha, 'source_member': book['member'], 'hints': book['hints'],
                                'source_pdf_hash_checked': True, 'toc_page_candidates': toc_pages, 'toc_sources': sources, 'ocr_body_pages_inspected': len(pages),
                                'observed_rows': len(rows), 'unambiguous_number_candidates': len({r['story_number_candidate'] for r in rows if r['source_id_candidate']}),
                                'duplicate_number_candidates': sorted(n for n, count in counts.items() if count > 1),
                                'calendar_comparison_only': {'non_leap_days': expected, 'numbers_not_observed': [n for n in range(1, expected + 1) if n not in counts], 'numbers_outside_non_leap_calendar': sorted(n for n in counts if n > expected), 'not_a_verified_missing_story_list': True},
                                'credit_ocr_evidence': credit_evidence(full), 'flags': [] if toc_pages else ['contents_not_detected_in_ocr'], 'verified': False})
        output['entries'].extend(rows)
    output['summary'] = {'books': len(output['books']), 'observed_rows': len(output['entries']),
                         'unambiguous_number_candidates': sum(b['unambiguous_number_candidates'] for b in output['books']),
                         'single_body_heading_candidates': sum(len(r['possible_body_starts']) == 1 for r in output['entries']),
                         'flag_counts': dict(collections.Counter(f for r in output['entries'] for f in r['flags'])),
                         'audio_candidates_not_matches': {'zero': sum(not r['audio_candidates'] for r in output['entries']), 'one': sum(len(r['audio_candidates']) == 1 for r in output['entries']), 'multiple': sum(len(r['audio_candidates']) > 1 for r in output['entries'])},
                         'confirmed_missing_scans': len(gaps), 'books_without_detected_contents': sum(not b['toc_page_candidates'] for b in output['books'])}
    return output


def private_output(path, value):
    path = Path(path).absolute()
    if any(part.lower() in {'public', 'dist', '.git'} for part in path.parts) or any(p.is_symlink() for p in [path, *path.parents]):
        raise ValueError('private_output_required')
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--gaps', type=Path, help='Existing confirmed missing-material register; never inferred from OCR')
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError(args.output)
    result = reconcile(args.work, args.gaps)
    private_output(args.output, result)
    print(json.dumps(result['summary']))


if __name__ == '__main__':
    main()
