const R2_DEV_AUDIO_URL = /^https:\/\/pub-[a-z0-9]+\.r2\.dev\//i;

export function rewriteAudioHost(url, env) {
  const host = typeof env?.R2L_AUDIO_HOST === 'string' ? env.R2L_AUDIO_HOST.trim() : '';
  if (typeof url !== 'string' || !host) return url;

  return url.replace(R2_DEV_AUDIO_URL, `${host.replace(/\/$/, '')}/`);
}
