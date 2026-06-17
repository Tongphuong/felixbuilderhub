/** 12 hub topic picture cards — mirrors read2lead.astro topic keys. */
export const HUB_TOPICS = [
  ['animals_pets', 'Động vật & thú cưng', '🐾'],
  ['family_friends', 'Gia đình & bạn bè', '👨‍👩‍👧'],
  ['school', 'Trường học', '🏫'],
  ['sports', 'Thể thao', '⚽'],
  ['games_toys', 'Trò chơi & đồ chơi', '🎮'],
  ['vehicles', 'Xe cộ & di chuyển', '🚗'],
  ['food_cooking', 'Đồ ăn & nấu ăn', '🍳'],
  ['nature', 'Thiên nhiên', '🌳'],
  ['art_creativity', 'Vẽ tranh & sáng tạo', '🎨'],
  ['heroes_jobs', 'Nghề nghiệp & ước mơ', '🦸'],
  ['imagination', 'Tưởng tượng & phép màu', '✨'],
  ['vietnamese_holidays', 'Lễ hội Việt Nam', '🏮'],
] as const;

export type HubTopicValue = (typeof HUB_TOPICS)[number][0];

export const VALID_TOPIC_KEYS = new Set(HUB_TOPICS.map(([value]) => value));
