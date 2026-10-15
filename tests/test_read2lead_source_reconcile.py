import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('source_reconcile', Path(__file__).resolve().parents[1] / 'scripts/read2lead-source-reconcile.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def word(text, x, y, line=1):
    return {'text': text, 'x': x, 'y': y, 'width': .035, 'height': .015, 'confidence': 95., 'line': ('1', '1', str(line))}


def toc(numbers=(1, 2, 3, 4)):
    result = []
    for i, n in enumerate(numbers):
        y = .25 + i * .06
        result += [word(str(n), .1, y, i + 1), word('Story', .18, y, i + 1), word('Name', .3, y, i + 1), word(str(2 * n), .85, y, i + 1)]
    return result


class SourceReconciliationTests(unittest.TestCase):
    def test_positioned_columns_work_even_when_line_ids_differ(self):
        words = toc()
        for i, w in enumerate(words):
            w['line'] = ('1', str(i), '1')
        rows = m.toc_rows(words)
        self.assertEqual([r['number_observations'] for r in rows], [[1], [2], [3], [4]])
        self.assertTrue(all(r['title_candidate'] == 'Story Name' for r in rows))
        self.assertEqual([r['printed_page_observations'] for r in rows], [[2], [4], [6], [8]])

    def test_conflicting_number_never_becomes_a_stable_story_identity(self):
        a, b = m.toc_rows(toc()), m.toc_rows(toc((1, 8, 3, 4)))
        rows = m.merge_rows(a + b, 'a' * 64, 4)
        self.assertEqual(len(rows), 4)
        self.assertIsNone(rows[1]['source_id_candidate'])
        self.assertIsNone(rows[1]['story_number_candidate'])
        self.assertIn('story_number_conflict', rows[1]['flags'])
        self.assertEqual(rows[1]['number_observations'], [2, 8])

    def test_repeated_titles_are_not_merged_and_absent_numbers_not_filled(self):
        rows = m.merge_rows(m.toc_rows(toc((1, 3, 4, 5))), 'a' * 64, 4)
        self.assertEqual([r['story_number_candidate'] for r in rows], [1, 3, 4, 5])
        self.assertEqual(len({r['source_id_candidate'] for r in rows}), 4)
        self.assertTrue(all(r['complete'] is False and r['verified_text'] is None for r in rows))
        self.assertTrue(all(r['review_status'] == 'unverified_local_ocr_evidence' for r in rows))

    def test_printed_page_column_can_recover_rows_without_inventing_numbers(self):
        words = [w for w in toc() if w['x'] != .1]
        rows = m.merge_rows(m.toc_rows(words), 'a' * 64, 2)
        self.assertEqual(len(rows), 4)
        self.assertTrue(all(r['story_number_candidate'] is None for r in rows))
        self.assertEqual([r['printed_page_candidate'] for r in rows], [2, 4, 6, 8])

    def test_page_number_does_not_silently_supply_an_unreadable_story_number(self):
        words = toc((1, 2, 3, 4, 5)); words[4]['text'] = '?'
        rows = m.merge_rows(m.toc_rows(words), 'a' * 64, 4)
        self.assertEqual(len(rows), 5)
        self.assertEqual(rows[1]['printed_page_candidate'], 4)
        self.assertIsNone(rows[1]['story_number_candidate'])
        self.assertIn('story_number_unreadable', rows[1]['flags'])

    def test_heading_matches_retain_all_ambiguity_without_claiming_page_verification(self):
        row = {'title_alternatives': ['A Small Cup']}
        pages = [{'pdf_page': n, 'headings': [{'text': 'A Small Cup'}], 'tsv_sha256': str(n) * 64, 'footers': []} for n in [6, 9]]
        matches = m.match_body(row, pages)
        self.assertEqual([x['pdf_page'] for x in matches], [6, 9])
        self.assertTrue(all('verified' not in x for x in matches))
        self.assertEqual(m.match_body({'title_alternatives': ['Unrelated Story']}, pages), [])

    def test_isbn_checksum_is_not_an_edition_approval(self):
        self.assertTrue(m.isbn_valid('978-1-77205-259-6'))
        self.assertFalse(m.isbn_valid('978-1-77205-259-7'))
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'page-003.txt';p.write_text('Copyright 2018\nISBN 978-1-77205-259-6\n')
            evidence = m.credit_evidence(Path(d))
            self.assertEqual(len(evidence), 2)
            self.assertTrue(evidence[1]['isbn_checksum_valid'])
            self.assertTrue(all(x['verified'] is False for x in evidence))

    def test_output_private_exclusive_and_refuses_public_or_symlink(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d);p = root / 'report.json';m.private_output(p, {'complete': False})
            self.assertEqual(p.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):m.private_output(p, {})
            with self.assertRaises(ValueError):m.private_output(root / 'public/report.json', {})
            (root / 'alias').symlink_to(root, target_is_directory=True)
            with self.assertRaises(ValueError):m.private_output(root / 'alias/other.json', {})

    def test_audio_hash_duplicates_are_deduplicated_but_competing_recordings_and_conflicts_remain(self):
        def item(sha, number):
            return {'kind':'audio','sha256':sha,'archive_sha256':'a'*64,'member':sha+'.mp3','hints':{'collection_level_hint':1,'month_hint':1,'story_number_hint':number}}
        index, missing, unresolved = m.audio_index({'members':[item('x',1),item('x',1),item('y',1),item('x',2),{'kind':'audio','sha256':'z','hints':{}}]}, {'x':{'decode_status':'pass'}})
        self.assertEqual(len(index[(1,1,1)]),2)
        self.assertEqual(index[(1,1,1)]['x']['other_number_hints'],[[1,1,1],[1,1,2]])
        self.assertEqual(index[(1,1,1)]['x']['match_status'],'not_compared')
        self.assertEqual(missing,['z'])

    def test_numbered_filename_fallback_requires_agreeing_numbers_and_valid_month(self):
        def item(name, sha):
            return {'kind':'audio','sha256':sha,'archive_sha256':'a'*64,'member':name,'hints':{'collection_level_hint':1}}
        index, missing, unresolved = m.audio_index({'members':[item('Audio/2/11 曲目 11.mp3','a'),item('Audio/2/01 曲目 1.mp3','f'),item('Audio/2/11 曲目 12.mp3','b'),item('Audio/7/29.mp3','c'),item('Audio/13/29.mp3','d'),item('Audio/9/v.mp3','e')]},{})
        self.assertEqual(set(index),{(1,2,11),(1,7,29),(1,2,1)})
        self.assertEqual(index[(1,2,11)]['a']['files'][0]['hint_origin'],'validated_numbered_filename_fallback')
        self.assertEqual(missing,['b','d','e'])

    def test_unnumbered_alias_is_preserved_without_claiming_its_hash_is_unassigned(self):
        def item(name):
            return {'kind':'audio','sha256':'a'*64,'archive_sha256':'b'*64,'member':name,'hints':{'collection_level_hint':1}}
        index, missing, unresolved = m.audio_index({'members':[item('Audio/2/v.mp3'),item('Audio/2/01 曲目 1.mp3')]},{})
        self.assertEqual(missing,[])
        self.assertEqual(len(unresolved),1)
        self.assertEqual(unresolved[0]['member'],'Audio/2/v.mp3')
        self.assertEqual(unresolved[0]['same_hash_number_hints'],[[1,2,1]])
        self.assertEqual(unresolved[0]['match_status'],'not_compared')
        self.assertEqual(index[(1,2,1)]['a'*64]['match_status'],'not_compared')

    def test_malformed_tsv_fails_instead_of_creating_evidence(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'bad.tsv';p.write_text('level\twidth\theight\n1\t0\t100\n')
            with self.assertRaises(ValueError):m.read_tsv(p)


if __name__ == '__main__':
    unittest.main()
