import unittest,importlib.util,copy
from pathlib import Path
spec=importlib.util.spec_from_file_location('story_library',Path(__file__).parents[1]/'scripts/read2lead-story-library.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class StoryImportTest(unittest.TestCase):
 def fixture(self):
  library={'books':[{'id':'c1-b02','month':2,'pdf':'pdf','pages':62,'tracks':[{'day':1,'media':'a1','title':'B2S001'},{'day':3,'media':'a3','title':'B2S003'}]}],'media':{'a1':{'mime':'audio/mpeg'},'a3':{'mime':'audio/mpeg'}},'counts':{}}
  rows=[{'id':f'c1-b02-s{n:02d}','bookId':'c1-b02','number':n,'title':f'Story {n}','pages':([] if n==2 else [6+2*(n-1-(n>2)),7+2*(n-1-(n>2))]),'pdf':'pdf','evidence':'scan review'} for n in range(1,29)]
  return library,{'format':'read2lead-story-index-v1','stories':rows}
 def test_missing_pages_do_not_shift_audio_or_renumber_following_story(self):
  lib,index=self.fixture();old=copy.deepcopy(lib);out=m.story_library(lib,index);self.assertEqual(lib,old)
  self.assertEqual(out['stories'][1]['pages'],[]);self.assertEqual(out['stories'][1]['audio'],[])
  self.assertEqual(out['stories'][2]['number'],3);self.assertEqual(out['stories'][2]['pages'],[8,9]);self.assertEqual(out['stories'][2]['audio'],['a3'])
  self.assertEqual(out['counts']['stories'],28)
 def test_identical_file_alias_recovers_number_without_guessing(self):
  lib,index=self.fixture();lib['books'][0]['tracks'][0]['day']=None
  inventory={'members':[{'kind':'audio','member':'One story a day / Audio Level 1/2/b02s01.mp3','sha256':'a1'}]}
  out=m.story_library(lib,index,inventory);self.assertEqual(out['stories'][0]['audio'],['a1']);self.assertIsNone(lib['books'][0]['tracks'][0]['day'])
  inventory['members'].append({'kind':'audio','member':'One story a day / Audio Level 1/2/b02s02.mp3','sha256':'a1'})
  with self.assertRaisesRegex(ValueError,'conflicting_audio_aliases'):m.story_library(lib,index,inventory)
 def test_invalid_index_rejected(self):
  for kind in ['overlap','wrong_pdf','no_evidence','omitted_day','duplicate','outside','fractional']:
   with self.subTest(kind=kind):
    lib,index=self.fixture();r=index['stories'][2]
    if kind=='overlap':r['pages']=[6,7]
    if kind=='wrong_pdf':r['pdf']='another'
    if kind=='no_evidence':r['evidence']=''
    if kind=='omitted_day':index['stories'].pop()
    if kind=='duplicate':index['stories'].append(copy.deepcopy(r))
    if kind=='outside':r['pages']=[62,63]
    if kind=='fractional':r['number']=3.5
    with self.assertRaises(ValueError):m.story_library(lib,index)
if __name__=='__main__':unittest.main()
