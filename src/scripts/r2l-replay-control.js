let howlerPromise = null;
let activeHowl = null;
let activeAudio = null;

function loadHowler() {
  if (!howlerPromise) {
    howlerPromise = import('howler')
      .then((mod) => mod.Howl)
      .catch(() => null);
  }
  return howlerPromise;
}

function stopActive() {
  try { activeHowl?.stop?.(); } catch {}
  try { activeHowl?.unload?.(); } catch {}
  try { activeAudio?.pause?.(); } catch {}
  activeHowl = null;
  activeAudio = null;
}

function setPreservesPitch(node) {
  if (!node) return;
  try { node.preservesPitch = true; } catch {}
  try { node.mozPreservesPitch = true; } catch {}
  try { node.webkitPreservesPitch = true; } catch {}
}

async function playWithAudio(url, rate) {
  stopActive();
  const audio = new Audio(url);
  activeAudio = audio;
  audio.preload = 'auto';
  audio.playbackRate = rate;
  setPreservesPitch(audio);
  audio.addEventListener('ended', () => {
    if (activeAudio === audio) activeAudio = null;
  }, { once: true });
  await audio.play();
}

export async function playUrl(url, rate = 1) {
  const src = String(url || '').trim();
  if (!src) return false;
  const speed = [0.5, 0.75, 1].includes(Number(rate)) ? Number(rate) : 1;
  const Howl = await loadHowler();
  if (!Howl) {
    await playWithAudio(src, speed);
    return true;
  }

  stopActive();
  const howl = new Howl({
    src: [src],
    html5: true,
    preload: true,
    rate: speed,
    volume: 1,
    onplay() {
      const sound = howl._sounds?.[0];
      setPreservesPitch(sound?._node);
    },
    onend() {
      if (activeHowl === howl) {
        activeHowl = null;
        howl.unload();
      }
    },
  });
  activeHowl = howl;
  howl.play();
  return true;
}

export function speakWord(word) {
  const text = String(word || '').trim();
  if (!text || !window.speechSynthesis) return false;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.82;
    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

export function bindReplayControls(root = document) {
  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const rateButton = target?.closest('[data-r2l-replay-rate]');
    if (rateButton) {
      const url = rateButton.getAttribute('data-audio-url') || '';
      const rate = Number(rateButton.getAttribute('data-r2l-replay-rate') || 1);
      void playUrl(url, rate);
      return;
    }

    const wordButton = target?.closest('[data-r2l-word-replay]');
    if (wordButton) {
      speakWord(wordButton.getAttribute('data-r2l-word-replay') || '');
    }
  });
}

export const R2LReplayControl = {
  bindReplayControls,
  playUrl,
  speakWord,
};
