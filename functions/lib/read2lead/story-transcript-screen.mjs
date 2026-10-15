import {screenTranscript} from '../../api/_minny-guardrails.js';
import {sha256} from './vendor/js-sha256/index.mjs';

export const storyAnchorDigest=text=>sha256(new TextEncoder().encode(text));

// Trusted module-level test seam only. HTTP and environment configuration never
// select a digest function; the production export below always uses SHA256.
export function createStoryTranscriptScreen({anchorDigest=storyAnchorDigest}={}) {
  if(typeof anchorDigest!=='function')throw Error('anchor_digest_required');
  const hasAnchor=(lesson,digest)=>lesson.story?.sentences?.some(s=>typeof s.text_en==='string'&&anchorDigest(s.text_en)===digest);

// Reviewed source contexts only. Do not turn a word occurring in any story into
// a blanket exemption: screen every other part of the learner's speech.
const raceSources=new Map([
  ['osad-abbceb29ffc7c398adb9af03-s02',"e15eb6c67ccf3b10bfd35a8b18d2339e08a408c78a50d286f637014e2b5e86df"],
  ['osad-f51b0ccb431e18652dc432fc-s18',"cd5dfb284a50c626ecea6dc0e3015f51f3dbc5fb988bc6f300f56c99da991976"],
]);
const raceStart=/\b(?:the gun went off(?: with a [“"']?bang[!”"']*)?|(?:the (?:teacher|starter)) fired the gun)\b/giu;

const bearSources=new Map([
  ['osad-87a2903bd6c06bfa20cde388-s08',"f546c193dab9c76f7dfd4294ce1483baacb62e101db86a032bcc63f89619f0dd"],
  ['osad-87a2903bd6c06bfa20cde388-s09',"d6a8d1016a9cd71176ad52d9e6d056f1f68e3128b25397270919ab3f628b49a6"],
]);
function screenReviewedBear(transcript,lesson) {
  const anchor=bearSources.get(lesson?.source?.source_id);
  if(!anchor||lesson?.source?.kind!=='user_supplied_publisher'||
    !hasAnchor(lesson,anchor))return transcript;
  return transcript.replace(/\bbig black bear\b/giu,'large bear');
}

const bloodSource='osad-c73ba69482abb05911409ea3-s13';
const bloodAnchor="bbfae4dd391a67dbb39f96ecfeb7bd03c14caee8ec98635972d4763ff881740e";
const educationalBlood=/\b(?:blood (?:types?|groups?|transfusions?)|(?:lost|donated|donating|give|gives|giving|receive|receives|receiving|replace|replacing) blood)\b/giu;
const reviewedPhrases=new Map([
  ['osad-86426d7d5984a4f591b1eb9e-s16',{
    anchor:"12b7bf4ba8d068aaf5c8259dd775d1dcc09857f3dd955ec80b586fac40c09dd3",
    phrase:/\bkill (?:the )?pain\b/giu,
  }],
  ['osad-86426d7d5984a4f591b1eb9e-s07',{
    anchor:"16c2dd90b9d6781c3697759aa675c627ef4d4cd51123f804cacf5790bcd6b75a",
    phrase:/\bblood pressure\b/giu,
  }],
  ['osad-d8a25226b463b4b222ae9956-s06',{
    anchor:"609d096447001f9493201bdff8ace99be0a4eb15d000b7ee7ef1e39de8d1d415",
    phrase:/\bcock[- ]a[- ]doodle[- ]doo\b/giu,
  }],
  ['osad-c73ba69482abb05911409ea3-s07',{
    anchor:"492beeba516430816a93a052a2b238ff040c3b5ef47597311fe49d8a9383badb",
    phrase:/\b(?:blood of mammals|blood types?|the female then draws up some blood|mosquitoes (?:drink|suck) blood)\b/giu,
  }],
  ['osad-f51b0ccb431e18652dc432fc-s16',{
    anchor:"d816f4bc5590f2bbd3f3b638f0eb34ba17db0bd4f4cd7c6f2e60fda74510a3af",
    phrase:/\b(?:the )?wings fill with blood\b/giu,
  }],
  ['osad-38baad9425e898169103fa36-s12',{
    anchor:"df1fa86545d2248aba5f85bdb30a554e8d0dd43dbfb409e25f1db0a015f6ee40",
    phrase:/\b(?:many|people|they) (?:honestly )?feared (?:the )?(?:phone|telephone) would kill them\b/giu,
  }],
  ['osad-d3232a9fc9ec92906135142d-s11',{
    anchor:"7f1050af25a773acf85c47f41fb1045e1f71cae9801ca6cfb389fef7cadd8b02",
    phrase:/\b(?:house )?fires kill (?:many )?people\b/giu,
  }],
]);
function screenReviewedPhrases(transcript,lesson) {
  const context=reviewedPhrases.get(lesson?.source?.source_id);
  if(!context||lesson?.source?.kind!=='user_supplied_publisher'||
    !hasAnchor(lesson,context.anchor))return transcript;
  return transcript.replace(context.phrase,'the story subject');
}
function screenEducationalBlood(transcript,lesson) {
  if(lesson?.source?.source_id!==bloodSource||lesson?.source?.kind!=='user_supplied_publisher'||
    !hasAnchor(lesson,bloodAnchor))return transcript;
  if(/^blood[.!]?$/iu.test(transcript.trim()))return 'the substance';
  return transcript.replace(/\b(?:type (?:ab|a|b|o) blood|(?:wrong|right|different|same) type of blood)\b/giu,'the medical group').replace(educationalBlood,'the medical subject');
}

function screenReviewedCharacterName(transcript,lesson) {
  if(lesson?.source?.source_id!=='osad-d3232a9fc9ec92906135142d-s06'||lesson?.source?.kind!=='user_supplied_publisher'||
    !hasAnchor(lesson,"54c8d8d73f1e64df23f5bb8833e11a727aba2d05305e95db16a240d595de85a0"))return transcript;
  if(/^dick[.!]?$/iu.test(transcript.trim()))return 'the boy';
  transcript=transcript.replace(/\bsaid dick(?=[.!?,“”"'’]|$)/giu,'said the boy');
  transcript=transcript.replace(/(^|[.!?]\s+)dick (?=(?:is|was|has|had|can|will|did|does)\b)/giu,'$1the boy ');
  return transcript.replace(/\bdick(?=(?:['’]s (?:dad|father)\b| (?:pulled|put|wore|wears|said|says|worked|works|helped|helps|picked|collected|cleaned|carried|and (?:his|the class))\b))/giu,'the boy');
}

function screenReviewedFatherAnswer(transcript,lesson) {
  if(lesson?.source?.source_id!=='osad-be808c48512a4f38ca7101f0-s14'||lesson?.source?.kind!=='user_supplied_publisher'||
    !hasAnchor(lesson,"c91eac8628fd9b345096a7e04f5d9292065a73f8ab049bb07338e954f9540b09"))return transcript;
  // Only a complete short object answer or the story's discovery sentence.
  // Do not mask the noun within arbitrary requests or instructions.
  if(/^(?:(?:it was|they found) )?(?:his|their father['’]s|the chief['’]s|a|the) hunting knife[.!]?$/iu.test(transcript.trim()))return 'the object they found';
  if(/^(?:soon, )?they came upon their father['’]s hunting knife lying on the ground[.!]?$/iu.test(transcript.trim()))return 'they found their father’s object on the ground';
  return transcript;
}


// Full reviewed narrative sentences only; never infer an exemption from one keyword.
const reviewedNarratives=new Map([
  [
    "osad-c73ba69482abb05911409ea3-s13",
    [
      "0915a45341e7619994949a1b806b49ced1a0147546721a8f7320519939838471",
      "87d48d0af831a0a372f9c820b53d6617c1b9341de3c094d986bd6b85440f07fa",
      "df31a72f7fe3effeff3b236de23a1acbba9a24a92848052b1332080babcc138b",
      "82c33b4b760886bf4c57c84b948cd420bb636752f770432b8807e8e638aceec1",
      "52cbb5c9ff3d3a8ba55783473f72dd5a801e8226f19c3099002bc571c71e8d88",
      "ef81ee220f59e61ab7c148a945b3b689fc6953d25165cd3be5f8397c5a5b451f",
      "5aa05f7f56a5350afaf750a28e968b4f475dd982a07c173733920de6274c9d12"
    ]
  ],
  [
    "osad-fa84228109e16c46eb41944a-s05",
    [
      "ea89e1d79790257484a17629beb7b5f012605a3fda85cf7581712baf77dd4ad0"
    ]
  ],
  [
    "osad-be808c48512a4f38ca7101f0-s13",
    [
      "b0358ad3c480222bb6859e280b60f4a094dcee65a8439056f537dafc7104f219"
    ]
  ],
  [
    "osad-be808c48512a4f38ca7101f0-s16",
    [
      "13c8652c83b940c9636db3c9dd23eec1c66a55d99b8f04fcac85b850e442a80e"
    ]
  ]
]);
function screenReviewedNarrative(transcript,lesson) {
  if(lesson?.source?.kind!=='user_supplied_publisher')return transcript;
  for(const digest of reviewedNarratives.get(lesson.source.source_id)||[]){
    const sentence=lesson.story?.sentences?.find(s=>typeof s.text_en==='string'&&anchorDigest(s.text_en)===digest)?.text_en;
    if(typeof sentence!=='string')continue;
    // Keep everything outside the complete source sentence available to screening.
    transcript=transcript.split(sentence).join('the described story event');
  }
  if(lesson.source.source_id==='osad-f51b0ccb431e18652dc432fc-s10'&&
    hasAnchor(lesson,"a52c50499b63668699831c22c7818c98d3ed8804d6ac20e386f66e89709c9b62")){
    transcript=transcript.replace(/\b(?:the )?(?:bee|honeybee) (?:called|calls|described) (?:its|the) stinger (?:a |its )?weapon\b/giu,'the bee described its stinger');
  }
  if(lesson.source.source_id==='osad-f51b0ccb431e18652dc432fc-s15'&&
    hasAnchor(lesson,"3ab8466a82cbb7033bacf25ced3a5badd42f9c08a5006c1a33d3a6d843de0ada")){
    transcript=transcript.replace(/\b(?:the )?(?:mother|woman) (?:said|asked|begged)(?: the king| them)?(?:,)?\s+[“"']?(?:do not|don't|not to) kill (?:my|her|the) baby\b/giu,'the mother asked for her baby to be spared');
  }
  return transcript;
}

function screenStoryTranscript(transcript,lesson) {
  if(typeof transcript==='string')transcript=screenReviewedNarrative(transcript,lesson);
  if(typeof transcript==='string')transcript=screenReviewedPhrases(screenReviewedFatherAnswer(screenReviewedBear(screenReviewedCharacterName(screenEducationalBlood(transcript,lesson),lesson),lesson),lesson),lesson);
  const anchor=raceSources.get(lesson?.source?.source_id);
  if(typeof transcript!=='string'||!anchor||lesson?.source?.kind!=='user_supplied_publisher'||
    !hasAnchor(lesson,anchor))return screenTranscript(transcript);
  return screenTranscript(transcript.replace(raceStart,'the race started'));
}

return screenStoryTranscript;
}
export const screenStoryTranscript=createStoryTranscriptScreen();
