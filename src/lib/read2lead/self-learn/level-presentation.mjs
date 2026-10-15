/** Public presentation only. Never chooses a lower level or infers mastery from text length. */
const PLANS = {
  L0: { goal_vi: 'Nhìn tranh, tìm ai làm gì, rồi kể một hành động.', retell_vi: 'Con có thể chọn thứ tự tranh và nói một cụm ngắn.', planning_en: ['Who?', 'Does what?'], speech_vi: 'Đọc một cụm ngắn, nghỉ một nhịp, rồi thử lại. Chưa có giọng mẫu để nghe và nhắc lại.' },
  L1: { goal_vi: 'Tìm chi tiết và xếp các việc theo thứ tự.', retell_vi: 'Con kể ba việc bằng câu ngắn. Sau đó thử đổi một chi tiết trong câu tưởng tượng.', planning_en: ['First', 'Next', 'Finally'], speech_vi: 'Con đọc một câu ngắn, để ý câu hỏi và câu kể.' },
  L2: { goal_vi: 'Nối nguyên nhân với kết quả và tìm chi tiết về cảm xúc.', retell_vi: 'Con nối mở đầu, việc xảy ra và kết thúc; giải thích một ý với because.', planning_en: ['Beginning', 'Middle · because', 'End'], speech_vi: 'Con đọc các cụm liền ý, nhấn vào từ giúp người nghe hiểu nguyên nhân.' },
  L3: { goal_vi: 'Tìm động cơ, chuỗi nguyên nhân và bằng chứng cho dự đoán.', retell_vi: 'Con dùng từ khóa để kể vấn đề, cách thử và kết quả; tự chọn một chi tiết làm bằng chứng.', planning_en: ['Problem', 'Attempt', 'Outcome', 'Evidence'], speech_vi: 'Con đọc một đoạn ngắn rồi thử diễn đạt ý khi gấp phần chữ lại.' },
  L4: { goal_vi: 'So sánh cách ứng xử và giải thích một cách hiểu có bằng chứng.', retell_vi: 'Con giữ đúng sự việc khi kể từ góc nhìn khác. Phân biệt điều đã xảy ra với điều con tưởng tượng.', planning_en: ['Viewpoint', 'Choice A / Choice B', 'Evidence', 'What might change?'], speech_vi: 'Con thử ngắt nghỉ và nhấn giọng để thể hiện cảm xúc, không đổi sự việc trong truyện.' },
  L5: { goal_vi: 'Phân biệt điều được chứng minh, giả định và thông tin còn thiếu.', retell_vi: 'Con nêu nhận định, tự chọn bằng chứng, giải thích và xét một cách khác. Nói rõ điều mình chưa biết.', planning_en: ['Claim', 'Evidence', 'Reason', 'Alternative', 'What is still unknown?'], speech_vi: 'Con đọc theo cụm ý rồi tự tóm tắt hoặc diễn đạt lại; không cần lặp nguyên văn.' },
};
export function levelPlan(level) { if (!Object.hasOwn(PLANS, level)) throw Error('unknown_level'); return structuredClone(PLANS[level]); }
export function readingGroups(lesson) {
  const sentences = lesson.story.sentences, ends = new Set(lesson.input?.break_after_sentence_ids || []), groups = []; let current = [];
  for (const sentence of sentences) { current.push(sentence); if (ends.has(sentence.id)) { groups.push(current); current = []; } }
  if (current.length) groups.push(current);
  return groups;
}
export function choicePictures(lesson, question) {
  if (question.kind !== 'picture_choice') return [];
  const pictures = question.option_illustration_ids?.map(id => lesson.illustrations.find(i => i.id === id));
  if (!pictures || pictures.length !== question.options_en.length || pictures.some(p => !p)) throw Error('picture_choices_unavailable');
  return pictures;
}
export function retellPictures(lesson) {
  if (!['L0', 'L1'].includes(lesson.level)) return [];
  const pictures = [1, 2, 3].map(i => lesson.illustrations.find(p => p.id === lesson.id + '-retell-' + i));
  // Old pinned versions do not acquire new illustrations after a catalogue update.
  return pictures.every(Boolean) ? [pictures[2], pictures[0], pictures[1]] : [];
}
export function pictureOrderText(pictures, selected) {
  if (!Array.isArray(selected) || selected.length !== pictures.length || new Set(selected).size !== selected.length || selected.some(id => !pictures.some(p => p.id === id))) throw Error('incomplete_picture_order');
  return 'Picture order selected (not spoken): ' + selected.map((id, i) => `${i + 1}. ${pictures.find(p => p.id === id).alt_en}`).join(' ');
}
