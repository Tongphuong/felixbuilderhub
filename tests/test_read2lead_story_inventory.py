import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile
import stat

spec = importlib.util.spec_from_file_location('intake', Path(__file__).resolve().parents[1] / 'scripts/read2lead-story-inventory.py')
intake = importlib.util.module_from_spec(spec); spec.loader.exec_module(intake)

class IntakeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
    def tearDown(self): self.temp.cleanup()
    def archive(self, name='source.zip', members=None):
        p = self.root/name
        with zipfile.ZipFile(p, 'w') as z:
            for key, value in (members or {'PDF Level 1/Book 1.pdf': b'%PDF-synthetic', 'Audio Level 1/1/b01s06.mp3': b'ID3synthetic', 'index.html': b'<script>NEVER EXECUTE</script>'}).items(): z.writestr(key,value)
        return p
    def test_crc_hash_dedupe_retry_preserves_original(self):
        a=self.archive(); b=self.archive('copy.zip'); original=a.read_bytes()
        first=intake.inventory([a,b],self.root/'private',True)
        second=intake.inventory([a,b],self.root/'private',True)
        self.assertEqual(first,second); self.assertEqual(a.read_bytes(),original)
        self.assertEqual(first['counts']['pdf'],{'files':2,'distinct_hashes':1})
        self.assertEqual(len(list((self.root/'private/objects').iterdir())),2)
        self.assertEqual(first['complete_lessons'],0); self.assertFalse(first['story_counts_verified'])
    def test_unsafe_paths_rejected_before_output(self):
        for name in ['../escape.pdf','/abs.pdf','a/../../x.pdf','C:/x.pdf','a\\x.pdf','a//x.pdf']:
            with self.subTest(name=name):
                a=self.archive(members={name:b'bad'})
                with self.assertRaisesRegex(ValueError,'unsafe_member_path'): intake.inventory([a],self.root/'refused',True)
                self.assertFalse((self.root/'refused').exists())
    def test_symlink_member_refused(self):
        a=self.root/'link.zip'; info=zipfile.ZipInfo('link.pdf'); info.create_system=3; info.external_attr=(stat.S_IFLNK|0o777)<<16
        with zipfile.ZipFile(a,'w') as z:z.writestr(info,'/etc/passwd')
        with self.assertRaisesRegex(ValueError,'unsafe_member_type'):intake.inventory([a],self.root/'out')
    def test_corrupt_crc_reported_no_bad_object(self):
        a=self.archive(members={'book.pdf':b'%PDF-SYNTHETIC-CONTENT'})
        raw=a.read_bytes().replace(b'%PDF-SYNTHETIC-CONTENT',b'%PDF-CORRUPTED-CONTENT');a.write_bytes(raw)
        r=intake.inventory([a],self.root/'out',True)
        self.assertEqual(r['status'],'failed'); self.assertIn('CRC',r['errors'][0]['error']); self.assertEqual(list((self.root/'out/objects').iterdir()),[])
    def test_changed_existing_object_refused(self):
        a=self.archive();r=intake.inventory([a],self.root/'out',True)
        p=self.root/'out'/r['members'][0]['private_object'];p.write_bytes(b'changed')
        r=intake.inventory([a],self.root/'out',True)
        self.assertEqual(r['status'],'failed');self.assertEqual(r['errors'][0]['error'],'existing_object_hash_mismatch')
    def test_dry_run_no_objects_and_public_output_refused(self):
        a=self.archive();r=intake.inventory([a],self.root/'out')
        self.assertTrue(all(x['private_object'] is None for x in r['members']))
        with self.assertRaisesRegex(ValueError,'public_output_refused'):intake.inventory([a],self.root/'public/out')
    def test_output_symlink_refused(self):
        a=self.archive();(self.root/'elsewhere').mkdir();(self.root/'out').symlink_to(self.root/'elsewhere')
        with self.assertRaisesRegex(ValueError,'unsafe_output_path'):intake.inventory([a],self.root/'out')
    def test_filename_hint_never_confirms_source(self):
        self.assertEqual(intake.locator('Audio Level 3/7/B7S017 One Insect.mp3')['story_number_hint'],17)
        self.assertEqual(intake.classify('Audio Level 1/6/.mp3'),'audio')
    def test_nonempty_unmarked_output_refused(self):
        a=self.archive();(self.root/'out').mkdir();(self.root/'out/data').write_text('preserve')
        with self.assertRaisesRegex(ValueError,'nonempty_unmarked_output'):intake.inventory([a],self.root/'out')

if __name__=='__main__':unittest.main()
