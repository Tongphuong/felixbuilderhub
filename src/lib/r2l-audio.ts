import type { Howl as HowlType } from 'howler';

const SOUND_PATHS: Record<string, string> = {
  'chest-shake': '/audio/kenney/chest-shake.mp3',
  'chest-crack': '/audio/kenney/chest-crack.mp3',
  'chest-burst': '/audio/kenney/chest-burst.mp3',
  'coin-clink': '/audio/kenney/coin-clink.mp3',
  'quest-complete': '/audio/kenney/quest-complete.mp3',
  'combo-tick': '/audio/kenney/combo-tick.mp3',
  'near-miss': '/audio/kenney/near-miss.mp3',
  'daily-chest-claim': '/audio/kenney/daily-chest-claim.mp3',
};

const cache = new Map<string, HowlType>();
const pending = new Map<string, Promise<HowlType | null>>();
const MUTE_KEY = 'r2l-w2-muted';

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* storage can be blocked */
  }
  for (const howl of cache.values()) howl.mute(muted);
}

async function loadSound(name: string): Promise<HowlType | null> {
  const path = SOUND_PATHS[name];
  if (!path) return null;
  const cached = cache.get(name);
  if (cached) return cached;
  const loading = pending.get(name);
  if (loading) return loading;

  const promise = import('howler')
    .then(({ Howl }) => {
      const howl = new Howl({ src: [path], html5: false, preload: true, volume: 0.6 });
      howl.mute(isMuted());
      cache.set(name, howl);
      return howl;
    })
    .catch(() => null)
    .finally(() => pending.delete(name));
  pending.set(name, promise);
  return promise;
}

/** Lazy-load Howl on first call. No-op if muted. */
export async function play(name: string): Promise<void> {
  if (isMuted() || !SOUND_PATHS[name]) return;
  const howl = await loadSound(name);
  if (!howl || isMuted()) return;
  howl.play();
}

/** Preload a sound without playing. Call only after a user interaction. */
export function preload(name: string): void {
  if (cache.has(name) || pending.has(name) || !SOUND_PATHS[name]) return;
  void loadSound(name);
}
