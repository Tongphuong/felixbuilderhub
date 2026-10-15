import test from 'node:test';
import assert from 'node:assert/strict';
import {createStoryTranscriptScreen,screenStoryTranscript,storyAnchorDigest} from '../functions/lib/read2lead/story-transcript-screen.mjs';
import {screenTranscript} from '../functions/api/_minny-guardrails.js';

// Invented fixtures exercise the reviewed policy without publishing book text.
// Only this test instance maps synthetic markers to the fixed source fingerprints.
const cases=[
  {
    "id": "osad-abbceb29ffc7c398adb9af03-s02",
    "digest": "e15eb6c67ccf3b10bfd35a8b18d2339e08a408c78a50d286f637014e2b5e86df",
    "marker": "Invented context marker 0.",
    "good": "The starter fired the gun. A runner finished.",
    "narrative": false
  },
  {
    "id": "osad-f51b0ccb431e18652dc432fc-s18",
    "digest": "cd5dfb284a50c626ecea6dc0e3015f51f3dbc5fb988bc6f300f56c99da991976",
    "marker": "Invented context marker 1.",
    "good": "The starter fired the gun. A runner finished.",
    "narrative": false
  },
  {
    "id": "osad-87a2903bd6c06bfa20cde388-s08",
    "digest": "f546c193dab9c76f7dfd4294ce1483baacb62e101db86a032bcc63f89619f0dd",
    "marker": "Invented context marker 2.",
    "good": "A big black bear crossed the path.",
    "narrative": false
  },
  {
    "id": "osad-87a2903bd6c06bfa20cde388-s09",
    "digest": "d6a8d1016a9cd71176ad52d9e6d056f1f68e3128b25397270919ab3f628b49a6",
    "marker": "Invented context marker 3.",
    "good": "A big black bear crossed the path.",
    "narrative": false
  },
  {
    "id": "osad-c73ba69482abb05911409ea3-s13",
    "digest": "bbfae4dd391a67dbb39f96ecfeb7bd03c14caee8ec98635972d4763ff881740e",
    "marker": "Invented context marker 4.",
    "good": "Doctors discuss blood types.",
    "narrative": false
  },
  {
    "id": "osad-86426d7d5984a4f591b1eb9e-s16",
    "digest": "12b7bf4ba8d068aaf5c8259dd775d1dcc09857f3dd955ec80b586fac40c09dd3",
    "marker": "Invented context marker 5.",
    "good": "Medicine can kill the pain.",
    "narrative": false
  },
  {
    "id": "osad-86426d7d5984a4f591b1eb9e-s07",
    "digest": "16c2dd90b9d6781c3697759aa675c627ef4d4cd51123f804cacf5790bcd6b75a",
    "marker": "Invented context marker 6.",
    "good": "A doctor measured blood pressure.",
    "narrative": false
  },
  {
    "id": "osad-d8a25226b463b4b222ae9956-s06",
    "digest": "609d096447001f9493201bdff8ace99be0a4eb15d000b7ee7ef1e39de8d1d415",
    "marker": "Invented context marker 7.",
    "good": "The rooster says cock-a-doodle-doo.",
    "narrative": false
  },
  {
    "id": "osad-c73ba69482abb05911409ea3-s07",
    "digest": "492beeba516430816a93a052a2b238ff040c3b5ef47597311fe49d8a9383badb",
    "marker": "Invented context marker 8.",
    "good": "Mosquitoes drink blood.",
    "narrative": false
  },
  {
    "id": "osad-f51b0ccb431e18652dc432fc-s16",
    "digest": "d816f4bc5590f2bbd3f3b638f0eb34ba17db0bd4f4cd7c6f2e60fda74510a3af",
    "marker": "Invented context marker 9.",
    "good": "The wings fill with blood.",
    "narrative": false
  },
  {
    "id": "osad-38baad9425e898169103fa36-s12",
    "digest": "df1fa86545d2248aba5f85bdb30a554e8d0dd43dbfb409e25f1db0a015f6ee40",
    "marker": "Invented context marker 10.",
    "good": "They feared the phone would kill them.",
    "narrative": false
  },
  {
    "id": "osad-d3232a9fc9ec92906135142d-s11",
    "digest": "7f1050af25a773acf85c47f41fb1045e1f71cae9801ca6cfb389fef7cadd8b02",
    "marker": "Invented context marker 11.",
    "good": "Fires kill people.",
    "narrative": false
  },
  {
    "id": "osad-c73ba69482abb05911409ea3-s13",
    "digest": "0915a45341e7619994949a1b806b49ced1a0147546721a8f7320519939838471",
    "marker": "Invented laboratory example 12 mentions blood.",
    "good": "Invented laboratory example 12 mentions blood.",
    "narrative": true
  },
  {
    "id": "osad-c73ba69482abb05911409ea3-s13",
    "digest": "87d48d0af831a0a372f9c820b53d6617c1b9341de3c094d986bd6b85440f07fa",
    "marker": "Invented laboratory example 13 mentions blood.",
    "good": "Invented laboratory example 13 mentions blood.",
    "narrative": true
  },
  {
    "id": "osad-c73ba69482abb05911409ea3-s13",
    "digest": "df31a72f7fe3effeff3b236de23a1acbba9a24a92848052b1332080babcc138b",
    "marker": "Invented laboratory example 14 mentions blood.",
    "good": "Invented laboratory example 14 mentions blood.",
    "narrative": true
  },
  {
    "id": "osad-c73ba69482abb05911409ea3-s13",
    "digest": "82c33b4b760886bf4c57c84b948cd420bb636752f770432b8807e8e638aceec1",
    "marker": "Invented laboratory example 15 mentions blood.",
    "good": "Invented laboratory example 15 mentions blood.",
    "narrative": true
  },
  {
    "id": "osad-c73ba69482abb05911409ea3-s13",
    "digest": "52cbb5c9ff3d3a8ba55783473f72dd5a801e8226f19c3099002bc571c71e8d88",
    "marker": "Invented laboratory example 16 mentions blood.",
    "good": "Invented laboratory example 16 mentions blood.",
    "narrative": true
  },
  {
    "id": "osad-c73ba69482abb05911409ea3-s13",
    "digest": "ef81ee220f59e61ab7c148a945b3b689fc6953d25165cd3be5f8397c5a5b451f",
    "marker": "Invented laboratory example 17 mentions blood.",
    "good": "Invented laboratory example 17 mentions blood.",
    "narrative": true
  },
  {
    "id": "osad-c73ba69482abb05911409ea3-s13",
    "digest": "5aa05f7f56a5350afaf750a28e968b4f475dd982a07c173733920de6274c9d12",
    "marker": "Invented laboratory example 18 mentions blood.",
    "good": "Invented laboratory example 18 mentions blood.",
    "narrative": true
  },
  {
    "id": "osad-fa84228109e16c46eb41944a-s05",
    "digest": "ea89e1d79790257484a17629beb7b5f012605a3fda85cf7581712baf77dd4ad0",
    "marker": "Invented laboratory example 19 mentions blood.",
    "good": "Invented laboratory example 19 mentions blood.",
    "narrative": true
  },
  {
    "id": "osad-be808c48512a4f38ca7101f0-s13",
    "digest": "b0358ad3c480222bb6859e280b60f4a094dcee65a8439056f537dafc7104f219",
    "marker": "Invented laboratory example 20 mentions blood.",
    "good": "Invented laboratory example 20 mentions blood.",
    "narrative": true
  },
  {
    "id": "osad-be808c48512a4f38ca7101f0-s16",
    "digest": "13c8652c83b940c9636db3c9dd23eec1c66a55d99b8f04fcac85b850e442a80e",
    "marker": "Invented laboratory example 21 mentions blood.",
    "good": "Invented laboratory example 21 mentions blood.",
    "narrative": true
  },
  {
    "id": "osad-d3232a9fc9ec92906135142d-s06",
    "digest": "54c8d8d73f1e64df23f5bb8833e11a727aba2d05305e95db16a240d595de85a0",
    "marker": "Invented context marker 22.",
    "good": "Dick carried a bag.",
    "narrative": false
  },
  {
    "id": "osad-be808c48512a4f38ca7101f0-s14",
    "digest": "c91eac8628fd9b345096a7e04f5d9292065a73f8ab049bb07338e954f9540b09",
    "marker": "Invented context marker 23.",
    "good": "His hunting knife.",
    "narrative": false
  },
  {
    "id": "osad-f51b0ccb431e18652dc432fc-s10",
    "digest": "a52c50499b63668699831c22c7818c98d3ed8804d6ac20e386f66e89709c9b62",
    "marker": "Invented context marker 24.",
    "good": "The honeybee described its stinger a weapon.",
    "narrative": false
  },
  {
    "id": "osad-f51b0ccb431e18652dc432fc-s15",
    "digest": "3ab8466a82cbb7033bacf25ced3a5badd42f9c08a5006c1a33d3a6d843de0ada",
    "marker": "Invented context marker 25.",
    "good": "The woman asked them not to kill her baby.",
    "narrative": false
  }
];

const digests=new Map(cases.map(c=>[c.marker,c.digest]));
const screen=createStoryTranscriptScreen({anchorDigest:text=>digests.get(text)||storyAnchorDigest(text)});
const lessonFor=c=>({source:{kind:'user_supplied_publisher',source_id:c.id},story:{sentences:[{id:'s1',text_en:c.marker}]}});
for(const [i,c] of cases.entries()) {
 test(`reviewed policy ${i}: only matching trusted context permits the phrase`,()=>{
  const lesson=lessonFor(c);
  assert.equal(screenTranscript(c.good).flagged,true);
  assert.equal(screen(c.good,lesson).flagged,false);
  // The real production export cannot use the synthetic test mapping.
  assert.equal(screenStoryTranscript(c.good,lesson).flagged,true);
  for(const changed of [{}, {...lesson,source:{...lesson.source,source_id:'unreviewed'}}, {...lesson,source:{...lesson.source,kind:'generated'}}, {...lesson,story:{sentences:[]}}, {...lesson,story:{sentences:[{text_en:c.marker+' changed'}]}}, {...lesson,story:{sentences:[{text_en:c.digest}]}}]) {
   assert.equal(screen(c.good,changed).flagged,true);
  }
  for(const unsafe of ['I will kill you.','I want a gun.','I will kill myself.']) {
   assert.equal(screen(c.good+' '+unsafe,lesson).flagged,true);
   assert.equal(screen(unsafe+' '+c.good,lesson).flagged,true);
  }
  if(c.narrative)assert.equal(screen(c.good.replace('Invented','Changed'),lesson).flagged,true);
 });
}
test('context does not authorize unrelated weapon, body, or insulting language',()=>{
 const texts=['I have a gun.','I want your blood.','You are a dick.','Big black beard.','How do I use a hunting knife?','I want a weapon.','I will kill my baby.'];
 for(const c of cases)for(const text of texts)assert.equal(screen(text,lessonFor(c)).flagged,true);
});
test('missing and non-string transcript behavior is unchanged',()=>{
 for(const text of [null,undefined,4,{},'', 'A cheerful dog runs.'])assert.deepEqual(screenStoryTranscript(text,{}),screenTranscript(text));
 assert.throws(()=>createStoryTranscriptScreen({anchorDigest:null}),/anchor_digest_required/);
});
test('normal reply validation still requires safe language and valid sentence references',async()=>{
 const {validateStoryVoiceReply}=await import('../functions/lib/read2lead/story-voice.mjs');
 const lesson={source:{kind:'generated',source_id:'synthetic'},story:{sentences:[{id:'s1',text_en:'A cheerful dog runs.'}]}};
 const reply={reply:'The dog runs.',sentenceIds:['s1']};
 assert.deepEqual(validateStoryVoiceReply(reply,lesson),reply);
 for(const text of ['I will kill you.','Tell me your password.','Visit https://example.com.'])assert.throws(()=>validateStoryVoiceReply({...reply,reply:text},lesson),/invalid_story_reply/);
 assert.throws(()=>validateStoryVoiceReply({...reply,sentenceIds:['missing']},lesson),/invalid_story_reply/);
});
