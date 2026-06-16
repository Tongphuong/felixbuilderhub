import { Howl } from 'howler';

export type SfxName =
  | 'correct'
  | 'wrong'
  | 'combo_fire'
  | 'combo_lightning'
  | 'combo_rainbow'
  | 'speed_tick'
  | 'badge_unlock'
  | 'chest_open'
  | 'coin_drop';

const SFX_FILES: Record<SfxName, string> = {
  correct: '/sfx/r2l/success-1.mp3',
  wrong: '/sfx/r2l/soft-boop.mp3',
  combo_fire: '/sfx/r2l/combo-fire.mp3',
  combo_lightning: '/sfx/r2l/combo-lightning.mp3',
  combo_rainbow: '/sfx/r2l/combo-rainbow.mp3',
  speed_tick: '/sfx/r2l/speed-tick.mp3',
  badge_unlock: '/sfx/r2l/badge-unlock.mp3',
  chest_open: '/sfx/r2l/chest-open.mp3',
  coin_drop: '/audio/kenney/coin-clink.mp3',
};

const howls = new Map<SfxName, Howl>();
let initialized = false;
let urlPlayer: Howl | null = null;

function isMuted(): boolean {
  try {
    return localStorage.getItem('r2l_sfx_muted') === '1';
  } catch {
    return false;
  }
}

export function initAudioSprites(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  (Object.keys(SFX_FILES) as SfxName[]).forEach((name) => {
    const howl = new Howl({
      src: [SFX_FILES[name]],
      preload: true,
      volume: name === 'wrong' ? 0.7 : 0.85,
    });
    howls.set(name, howl);
  });
}

export function playFx(name: SfxName): void {
  if (isMuted()) return;
  if (!initialized) initAudioSprites();
  const howl = howls.get(name);
  if (!howl) return;
  howl.stop();
  howl.play();
}

export function playUrl(url: string, speed = 1): Promise<void> {
  if (!url) return Promise.resolve();
  if (isMuted()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    if (urlPlayer) {
      urlPlayer.unload();
      urlPlayer = null;
    }
    urlPlayer = new Howl({
      src: [url],
      html5: true,
      rate: speed,
      onend: () => resolve(),
      onloaderror: (_id, err) => reject(err),
      onplayerror: (_id, err) => reject(err),
    });
    urlPlayer.play();
  });
}
