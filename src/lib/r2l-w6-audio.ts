import type { Howl as HowlType } from 'howler';

export type TierRarity = 'common' | 'rare' | 'epic' | 'legendary';

type StingerConfig = {
  path: string;
  volume: number;
  rate: number;
  tailDelayMs?: number;
};

const TIER_STINGERS: Partial<Record<TierRarity, StingerConfig>> = {
  rare: {
    path: '/audio/kenney/coin-clink.mp3',
    volume: 0.35,
    rate: 1,
  },
  epic: {
    path: '/audio/kenney/quest-complete.mp3',
    volume: 0.6,
    rate: 0.75,
    tailDelayMs: 260,
  },
};

const cache = new Map<TierRarity, HowlType>();
const pending = new Map<TierRarity, Promise<HowlType | null>>();
const MUTE_KEY = 'r2l-w2-muted';

function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

async function loadStinger(
  rarity: TierRarity,
  config: StingerConfig,
): Promise<HowlType | null> {
  const cached = cache.get(rarity);
  if (cached) return cached;
  const loading = pending.get(rarity);
  if (loading) return loading;

  const promise = import('howler')
    .then(({ Howl }) => {
      const howl = new Howl({
        src: [config.path],
        html5: false,
        preload: false,
        volume: config.volume,
        rate: config.rate,
      });
      cache.set(rarity, howl);
      return howl;
    })
    .catch(() => null)
    .finally(() => pending.delete(rarity));
  pending.set(rarity, promise);
  return promise;
}

/** Fetch and play a tier sound only when a ceremony actually opens. */
export async function playTierStinger(rarity: TierRarity): Promise<void> {
  const config = TIER_STINGERS[rarity];
  if (!config || isMuted()) return;

  const howl = await loadStinger(rarity, config);
  if (!howl || isMuted()) return;

  howl.mute(false);
  howl.play();

  if (config.tailDelayMs !== undefined) {
    window.setTimeout(() => {
      if (!isMuted()) howl.play();
    }, config.tailDelayMs);
  }
}
