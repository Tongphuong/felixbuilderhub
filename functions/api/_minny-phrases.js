export const MINNY_PHRASES = [
  {
    id: 'greeting',
    text_en: 'Hello! I am Minny. Let’s practice speaking together!',
    subtitle_vi: 'Xin chào! Mình là Minny. Cùng luyện nói nhé!',
  },
  {
    id: 'cant_hear',
    text_en: 'I didn’t catch that. Can you say it again?',
    subtitle_vi: 'Minny chưa nghe rõ. Con nói lại được không?',
  },
  {
    id: 'redirect_1',
    text_en: 'That’s interesting! Let’s talk about your favorite animal.',
    subtitle_vi: 'Hay quá! Mình nói về con vật con thích nhất nhé.',
  },
  {
    id: 'redirect_2',
    text_en: 'Great job! Can you tell me about your day?',
    subtitle_vi: 'Giỏi quá! Con kể cho Minny nghe về ngày hôm nay đi.',
  },
  {
    id: 'redirect_3',
    text_en: 'Nice try! What do you like to do after school?',
    subtitle_vi: 'Tốt lắm! Sau giờ học con thích làm gì?',
  },
  {
    id: 'redirect_4',
    text_en: 'You are doing well! Let’s talk about your favorite food.',
    subtitle_vi: 'Con làm tốt lắm! Mình nói về món ăn con thích nhé.',
  },
  {
    id: 'redirect_5',
    text_en: 'Wonderful! Can you describe your best friend?',
    subtitle_vi: 'Tuyệt vời! Con tả bạn thân của con được không?',
  },
  {
    id: 'redirect_6',
    text_en: 'Awesome! What game do you like to play?',
    subtitle_vi: 'Hay quá! Con thích chơi trò gì nhất?',
  },
  {
    id: 'wrap_up_1',
    text_en: 'That was fun! See you next time.',
    subtitle_vi: 'Vui quá! Hẹn gặp lại con lần sau nhé.',
  },
  {
    id: 'wrap_up_2',
    text_en: 'Great practice today! I can’t wait to talk again.',
    subtitle_vi: 'Hôm nay luyện tập tốt lắm! Minny mong được nói chuyện tiếp.',
  },
  {
    id: 'goodbye',
    text_en: 'Goodbye! Keep practicing and have a wonderful day!',
    subtitle_vi: 'Tạm biệt con! Nhớ luyện tập và có một ngày thật vui nhé!',
  },
  {
    id: 'homework_not_set',
    text_en: 'There is no homework yet today. Check back after your next lesson!',
    subtitle_vi: 'Hôm nay chưa có bài tập về nhà. Con kiểm tra lại sau buổi học tiếp theo nhé!',
  },
  {
    // Short 'thinking' filler lines played while Minny generates a reply,
    // so the wait feels alive. Awaiting Phuong's brand-voice sign-off
    // together with the other phrases.
    id: 'thinking_1',
    text_en: 'Hmm, let me think!',
    subtitle_vi: 'Hmm, để Minny nghĩ xíu nhé!',
  },
  {
    id: 'thinking_2',
    text_en: 'Ooh, let me see!',
    subtitle_vi: 'Ồ, để Minny xem nào!',
  },
  {
    // Spoken intro for the speech-frame ("thuyết trình") step — before this,
    // the frame screen's Listen button played nothing at all. Awaiting
    // Phương's brand-voice sign-off together with the other phrases.
    id: 'frame_intro',
    text_en: 'Now tell me your story! Speak in full sentences, from start to finish. You can do it!',
    subtitle_vi: 'Giờ con thuyết trình nhé! Nói thành câu đầy đủ, một mạch từ đầu đến cuối. Con làm được mà!',
  },
  // V1.1 (2026-07-11) repair ladder + Vietnamese-nudge canned lines. {a}/{b}/
  // {model} placeholders are filled per-turn by fillPhrase() below from the
  // previous turn's own options/expected/hint -- never invented text.
  {
    id: 'repair_rephrase',
    text_en: 'That’s okay! Let me ask again, nice and easy.',
    subtitle_vi: 'Không sao đâu! Minny hỏi lại chậm hơn nhé.',
  },
  {
    id: 'repair_choices',
    text_en: 'You can say: {a} — or — {b}. You try!',
    subtitle_vi: 'Con có thể nói: {a} — hoặc — {b}. Con thử nhé!',
  },
  {
    id: 'repair_model',
    text_en: 'You can say: {model}. Your turn!',
    subtitle_vi: 'Con có thể nói: {model}. Đến lượt con!',
  },
  {
    id: 'repair_move_on',
    text_en: 'Good try! Let’s talk about something else fun.',
    subtitle_vi: 'Con cố gắng tốt lắm! Mình nói chuyện khác vui hơn nhé.',
  },
  {
    id: 'vn_nudge',
    text_en: 'Let’s try it in English! You can say: {model}.',
    subtitle_vi: 'Mình thử nói bằng tiếng Anh nhé! Con có thể nói: {model}.',
  },
];

export function findPhrase(id) {
  return MINNY_PHRASES.find(p => p.id === id) || null;
}

export function isKnownPhraseId(id) {
  return Boolean(findPhrase(id));
}

// Fills {a}/{b}/{model} placeholders in both text_en and subtitle_vi with
// per-turn values (repair-ladder options/expected/hint words) -- returns a
// NEW object, never mutates the phrase constant. Unknown placeholders (no
// matching key in vars) are left intact rather than blanked out. Filled
// lines go through the normal getOrSynthesize TTS path -- the KV cache
// dedups repeats, so nothing here needs pre-caching.
export function fillPhrase(phrase, vars = {}) {
  const fill = (str) => String(str || '').replace(/\{(\w+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
  ));
  return {
    ...phrase,
    text_en: fill(phrase.text_en),
    subtitle_vi: fill(phrase.subtitle_vi),
  };
}
