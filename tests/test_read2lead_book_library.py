import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('library',Path(__file__).parents[1]/'scripts/read2lead-book-library.py')
library=importlib.util.module_from_spec(spec);spec.loader.exec_module(library)
class Locations(unittest.TestCase):
    def test_supplied_filename_families(self):
        for name,expected in [
            ('One story a day /PDF Level 3/Book 4.pdf',(3,4,None)),
            ('One story a day / Audio Level 1/2/01 曲目 1.mp3',(1,2,1)),
            ('One story a day / Audio Level 2/9/Track22.mp3',(2,9,22)),
            ('One story a day / Audio Level 3/8/B8S024 Wasting Time.mp3',(3,8,24)),
            ('ONE STORY A DAY/06 June/06.June/A0604 About Rice.mp3',(1,6,4))]:
            with self.subTest(name=name):self.assertEqual(library.location({'member':name}),expected)
    def test_unidentified_files_are_not_assigned_an_invented_location(self):
        self.assertEqual(library.location({'member':'unknown.mp3'}),(None,None,None))
if __name__=='__main__':unittest.main()
