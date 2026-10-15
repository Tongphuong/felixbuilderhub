import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SHOP_PRICES,
  buildShopCatalog,
  buildShopView,
  executeBuy,
  getPartRarity,
  humanizePartId,
  isSilverOrAbove,
  listPartsByRarity,
} from '../functions/api/_read2lead-shop-v2.js';

const RARE_PART = 'png-default-detail-blue-horn-small';
const EPIC_PART = 'png-default-detail-blue-horn-large';
const COMMON_PART = 'png-default-detail-blue-ear';

test('all valid catalogue parts are free, including common choices',()=>{
 const catalog=buildShopCatalog({includeDecorations:true});assert.ok(catalog.length>100);
 assert.deepEqual(SHOP_PRICES,{common:0,rare:0,epic:0});
 assert.ok(catalog.every(p=>p.price===0));assert.ok(catalog.some(p=>p.rarity==='common'));
 assert.equal(new Set(catalog.map(p=>p.id)).size,catalog.length);
});
for(const level of ['L0','L1','L2','L3','L4','L5']) test(`all choices free at ${level}, zero balance and repeated legacy selection`,()=>{
 const state={current_level:level,diamonds:0,unlocked_parts:[],completed_packs:4};const before=structuredClone(state);
 const view=buildShopView(state);assert.ok(view.every(p=>p.price===0&&p.owned&&p.can_afford));
 for(const part of view) {const result=executeBuy(state,part.id);assert.equal(result.error,undefined);assert.deepEqual(result.state,state);assert.equal(result.reward.price,0);}
 assert.deepEqual(state,before);assert.equal(executeBuy(state,'not-a-part').error,'part_not_found');
});

test('humanizePartId returns string for known formats', () => {
  const label = humanizePartId('png-default-detail-blue-horn-large');
  assert.match(label, /Sừng/);
  assert.match(label, /xanh/);
  assert.match(label, /lớn/);
});

test('listPartsByRarity returns rare and epic pools', () => {
  const rare = listPartsByRarity('rare');
  const epic = listPartsByRarity('epic');
  assert.ok(rare.includes(RARE_PART));
  assert.ok(epic.includes(EPIC_PART));
  assert.equal(listPartsByRarity('unknown').length, 0);
});

test('getPartRarity reads inferred rarity from manifest ids', () => {
  assert.equal(getPartRarity(RARE_PART), 'rare');
  assert.equal(getPartRarity(EPIC_PART), 'epic');
  assert.equal(getPartRarity(COMMON_PART), 'common');
});
