// Kind Vietnamese notes shown to children (SPEC_R2L_MINNY_VOICE_COST B4/B6).
// Pure strings so tests can assert them without a browser.

/** B4: the monthly voice pool is used up. Reading and tap answers still work. */
export const VOICE_POOL_REST_VI = 'Minny đang nghỉ ngơi đến đầu tháng sau nên chưa nói chuyện được. Con vẫn đọc truyện và chọn đáp án như bình thường nhé!';
export const VOICE_POOL_REST_CODE = 'voice_pool_exhausted';

/** B6: the free pronunciation score is not available right now. Never silent. */
export const PRONUNCIATION_UNAVAILABLE_VI = 'Điểm phát âm chưa có lúc này. Phần nội dung con kể vẫn được tính nhé.';

export function pronunciationNote(pronunciation) {
  return pronunciation
    ? `Phát âm: ${pronunciation.accuracy}/100 · Độ trôi chảy: ${pronunciation.fluency}/100`
    : PRONUNCIATION_UNAVAILABLE_VI;
}
