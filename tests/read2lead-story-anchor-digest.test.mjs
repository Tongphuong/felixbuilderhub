import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {storyAnchorDigest} from '../functions/lib/read2lead/story-transcript-screen.mjs';

test('story fingerprints match standard SHA256 vectors',()=>{
  assert.equal(storyAnchorDigest(''),'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(storyAnchorDigest('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('browser digest matches Node for UTF8, block boundaries and malformed surrogates',()=>{
  const texts=['Tiếng Việt — “hello” 🐻','\ud800','\udfff','a\ud800b','é','e\u0301', ...[55,56,63,64,65,127,128,129,100000].map(n=>'x'.repeat(n))];
  for(const text of texts)assert.equal(storyAnchorDigest(text),createHash('sha256').update(new TextEncoder().encode(text)).digest('hex'));
  assert.notEqual(storyAnchorDigest('é'),storyAnchorDigest('e\u0301'));
});
