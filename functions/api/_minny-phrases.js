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
];

export function findPhrase(id) {
  return MINNY_PHRASES.find(p => p.id === id) || null;
}

export function isKnownPhraseId(id) {
  return Boolean(findPhrase(id));
}
