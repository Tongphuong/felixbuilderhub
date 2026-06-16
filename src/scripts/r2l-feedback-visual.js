const WAVESURFER_CDN = 'https://cdn.jsdelivr.net/npm/wavesurfer.js@7/dist/wavesurfer.esm.js';

let waveSurferPromise = null;

function loadWaveSurfer() {
  if (!waveSurferPromise) {
    waveSurferPromise = import(/* @vite-ignore */ WAVESURFER_CDN)
      .then((mod) => mod.default || mod.WaveSurfer)
      .catch(() => null);
  }
  return waveSurferPromise;
}

function reducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function destroyExisting(container) {
  const existing = container.__r2lWaveforms;
  if (Array.isArray(existing)) {
    existing.forEach((wave) => {
      try { wave.destroy(); } catch {}
    });
  }
  container.__r2lWaveforms = [];
}

function row(label) {
  const wrap = document.createElement('div');
  wrap.className = 'r2l-wave-row';
  const text = document.createElement('span');
  text.className = 'r2l-wave-label';
  text.textContent = label;
  const mount = document.createElement('div');
  mount.className = 'r2l-wave-mount';
  wrap.append(text, mount);
  return { wrap, mount };
}

export async function mountDualWaveform({
  container,
  nativeUrl,
  kidUrl,
}) {
  if (!container) return false;
  destroyExisting(container);
  container.innerHTML = '<p class="r2l-wave-status">Đang vẽ nhịp đọc...</p>';

  const WaveSurfer = await loadWaveSurfer();
  if (!WaveSurfer || !nativeUrl || !kidUrl) {
    container.innerHTML = '<p class="r2l-wave-status">Chưa vẽ được sóng âm. Con vẫn nghe lại bình thường nhé.</p>';
    return false;
  }

  const native = row('Mẫu');
  const kid = row('Con');
  container.innerHTML = '';
  container.append(native.wrap, kid.wrap);

  const common = {
    height: 36,
    normalize: true,
    interact: false,
    barWidth: 2,
    barGap: 1,
    cursorWidth: reducedMotion() ? 0 : 1,
    autoScroll: false,
    autoCenter: false,
  };
  const nativeWave = WaveSurfer.create({
    ...common,
    container: native.mount,
    waveColor: '#8bb9ff',
    progressColor: '#f2cc7e',
  });
  const kidWave = WaveSurfer.create({
    ...common,
    container: kid.mount,
    waveColor: '#f5a3b7',
    progressColor: '#7dd3fc',
  });
  container.__r2lWaveforms = [nativeWave, kidWave];

  await Promise.allSettled([
    nativeWave.load(nativeUrl),
    kidWave.load(kidUrl),
  ]);
  return true;
}

export const R2LFeedbackVisual = {
  mountDualWaveform,
};
