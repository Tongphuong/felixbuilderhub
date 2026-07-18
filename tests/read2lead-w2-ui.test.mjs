import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { getViteConfig } from 'astro/config';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';

/** @type {import('vite').ViteDevServer | undefined} */
let viteServer;
/** @type {import('astro/container').experimental_AstroContainer | undefined} */
let container;

async function ensureHarness() {
  if (container) return;
  const configFn = getViteConfig({}, { root: process.cwd() });
  const config = await configFn({ command: 'serve', mode: 'development' });
  viteServer = await createServer({
    ...config,
    server: { middlewareMode: true },
    appType: 'custom',
  });
  await viteServer.pluginContainer.buildStart({});
  container = await AstroContainer.create();
}

/**
 * @param {string} modulePath
 * @param {Record<string, unknown>} props
 */
async function renderComponent(modulePath, props) {
  await ensureHarness();
  const Component = (await viteServer.ssrLoadModule(modulePath)).default;
  return container.renderToString(Component, { props });
}

test.before(async () => {
  await ensureHarness();
});

test.after(async () => {
  if (viteServer) await viteServer.close();
});

const COMPLETE_QUEST = {
  id: 'q1',
  label_vi: 'Xong 1 bài',
  target: 1,
  progress: 1,
  reward_diamonds: 10,
  reward_rp: 0,
  claimed: false,
};

const INCOMPLETE_QUEST = {
  ...COMPLETE_QUEST,
  progress: 0,
};

const CLAIMED_QUEST = {
  ...COMPLETE_QUEST,
  claimed: true,
};

test('QuestCard renders label + progress + claim button when complete', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/QuestCard.astro', {
    quest: COMPLETE_QUEST,
  });
  assert.match(html, /Xong 1 bài/);
  assert.match(html, /w2-quest-claim/);
  assert.match(html, /data-complete="?true"?/);
});

// R2L Rewards Redesign: quest rewards pay out in diamonds, not coins.
test('QuestCard shows the diamond reward, not a coin reward', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/QuestCard.astro', {
    quest: COMPLETE_QUEST,
  });
  assert.match(html, /💎 \+10/);
  assert.doesNotMatch(html, /🪙/);
});

test('QuestCard hides claim button when not complete', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/QuestCard.astro', {
    quest: INCOMPLETE_QUEST,
  });
  assert.doesNotMatch(html, /w2-quest-claim/);
  assert.match(html, /data-complete="?false"?/);
});

test('QuestCard shows "Đã nhận" when claimed', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/QuestCard.astro', {
    quest: CLAIMED_QUEST,
  });
  assert.match(html, /Đã nhận/);
  assert.doesNotMatch(html, /w2-quest-claim/);
});

test('QuestCard shows RP reward when reward_rp > 0', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/QuestCard.astro', {
    quest: { ...COMPLETE_QUEST, reward_rp: 5 },
  });
  assert.match(html, /\+5 RP/);
});

test('QuestList renders 3 cards', async () => {
  const quests = [
    { ...INCOMPLETE_QUEST, id: 'q1', label_vi: 'Bài 1' },
    { ...INCOMPLETE_QUEST, id: 'q2', label_vi: 'Bài 2' },
    { ...INCOMPLETE_QUEST, id: 'q3', label_vi: 'Bài 3' },
  ];
  const html = await renderComponent('/src/components/read2lead/v4/QuestList.astro', { quests });
  assert.match(html, /Nhiệm vụ hôm nay/);
  assert.match(html, /Bài 1/);
  assert.match(html, /Bài 2/);
  assert.match(html, /Bài 3/);
  assert.equal((html.match(/w2-quest-card/g) || []).length, 3);
});

test('QuestList empty state when no quests', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/QuestList.astro', { quests: [] });
  assert.match(html, /Đang tải nhiệm vụ/);
  assert.doesNotMatch(html, /w2-quest-card/);
});

test('ChestBox sets data-rarity attr', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/ChestBox.astro', {
    rarity: 'epic',
    preview_text: 'Hộp epic',
    pending: true,
  });
  assert.match(html, /data-rarity="?epic"?/);
  assert.match(html, /data-pending="?true"?/);
});

test('ChestBox preview text from props', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/ChestBox.astro', {
    rarity: 'common',
    preview_text: 'Hộp này chứa 10–20 xu.',
    pending: false,
  });
  assert.match(html, /Hộp này chứa 10–20 xu\./);
  assert.match(html, /aria-label="Mở hộp common"/);
});

test('ChestOpening has 3 stage divs', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/ChestOpening.astro', {
    rarity: 'rare',
    reward: { coins: 15, part_id: 'horn-1', part_name: 'Sừng xanh' },
    duplicate: false,
  });
  assert.match(html, /data-stage="closed"/);
  assert.match(html, /data-stage="cracking"/);
  assert.match(html, /data-stage="burst"/);
  assert.match(html, /Mới: Sừng xanh/);
});

test('ChestOpening duplicate path shows bonus message', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/ChestOpening.astro', {
    rarity: 'common',
    reward: { coins: 8, part_id: 'tail-2', part_name: 'Đuôi' },
    duplicate: true,
  });
  assert.match(html, /Trùng → \+xu bonus/);
  assert.doesNotMatch(html, /Mới:/);
});

test('ComboCounter hidden when level=1', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/ComboCounter.astro', {
    level: 1,
    visible: true,
  });
  assert.doesNotMatch(html, /COMBO/);
  assert.match(html, /data-level="?1"?/);
});

test('ComboCounter shows badge when level≥2', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/ComboCounter.astro', {
    level: 3,
    visible: true,
  });
  assert.match(html, /x3 COMBO/);
  assert.match(html, /data-level="?3"?/);
  assert.match(html, /data-visible="?true"?/);
});

test('NearMissBanner role status', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/NearMissBanner.astro', {
    text: 'Gần đúng rồi!',
    visible: true,
  });
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Gần đúng rồi!/);
});

test('DailyLoginChest disabled when !available', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/DailyLoginChest.astro', {
    available: false,
    reward_preview: 12,
  });
  assert.match(html, /disabled/);
  assert.match(html, /Đã nhận hôm nay/);
  assert.doesNotMatch(html, /Quà hôm nay/);
});

test('DailyLoginChest shows reward preview when available', async () => {
  const html = await renderComponent('/src/components/read2lead/v4/DailyLoginChest.astro', {
    available: true,
    reward_preview: 20,
  });
  assert.match(html, /Quà hôm nay: \+20/);
  assert.doesNotMatch(html, /\bdisabled\b/);
});
