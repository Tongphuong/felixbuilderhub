//
// Deterministic banned-topic wordlists for Minny's Free Talking guardrail
// layer (Phase 6). This is layer 1 of the guardrail stack (fast,
// deterministic substring match) -- Llama Guard (the ML-based backstop in
// _minny-guardrails.js's screenWithLlamaGuard) catches phrasing this list
// misses.
//
// Provenance note: the spec (SPEC_SPEAKUP_V0.md, Phase 6, decision D0)
// called for vendoring the public LDNOOBW word list. This build session had
// no outbound network access to fetch it, so this list is authored directly
// instead -- flagged in CONTROL.md's acceptance-criteria reconciliation as a
// disclosed substitution, not a silent gap. Coverage is intentionally broad
// rather than exhaustive since Llama Guard is the primary safety net.

export const PROFANITY_EN = [
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'dick', 'pussy', 'cock',
  'cunt', 'whore', 'slut', 'nigger', 'nigga', 'faggot', 'retard',
];

export const PROFANITY_VI = [
  'địt', 'đụ', 'lồn', 'buồi', 'cặc', 'đéo', 'đĩ', 'con điếm', 'thằng chó',
  'đồ khốn', 'đồ ngu', 'súc vật',
];

export const SEXUAL_EN = [
  'sex', 'porn', 'naked', 'nude', 'penis', 'vagina', 'breast', 'boobs',
  'masturbate', 'orgasm', 'rape', 'molest',
];

export const SEXUAL_VI = [
  'tình dục', 'khiêu dâm', 'khỏa thân', 'cởi đồ', 'hiếp dâm', 'ấu dâm',
];

export const VIOLENCE_EN = [
  'kill', 'murder', 'stab', 'shoot', 'gun', 'bomb', 'torture', 'blood',
  'dead body', 'beat you up',
];

export const VIOLENCE_VI = [
  'giết', 'giết chết', 'đâm chết', 'bắn', 'súng', 'bom', 'tra tấn', 'máu',
  'xác chết', 'đánh cho chết',
];

export const DRUGS_WEAPONS_EN = [
  'weed', 'marijuana', 'cocaine', 'heroin', 'meth', 'drugs', 'cigarette',
  'vape', 'alcohol', 'beer', 'knife', 'weapon',
];

export const DRUGS_WEAPONS_VI = [
  'ma túy', 'cần sa', 'thuốc lá', 'rượu bia', 'dao', 'vũ khí',
];

export const SELF_HARM_EN = [
  'suicide', 'kill myself', 'hurt myself', 'cut myself', 'want to die',
  'end my life', 'self harm',
];

export const SELF_HARM_VI = [
  'tự tử', 'tự sát', 'tự làm đau', 'tự hại', 'muốn chết', 'không muốn sống',
];

export const PERSONAL_INFO_TRIGGERS_EN = [
  'your address', 'phone number', 'where do you live', 'send a photo',
  'send me a picture', 'meet me', 'meet in person', 'what school',
  'your real name', 'add me on', 'your parents are not home',
];

export const PERSONAL_INFO_TRIGGERS_VI = [
  'địa chỉ nhà', 'số điện thoại', 'nhà con ở đâu', 'gửi ảnh', 'gặp mặt',
  'trường con học', 'tên thật của con', 'kết bạn', 'bố mẹ có nhà không',
];

export const INSTRUCTION_INJECTION_EN = [
  'ignore your instructions', 'ignore the rules', 'you are not minny',
  'pretend you are not minny', 'you are an ai', 'you are a bot',
  'you are chatgpt', 'forget your rules', 'system prompt', 'jailbreak',
  'new instructions',
];

export const INSTRUCTION_INJECTION_VI = [
  'bỏ qua hướng dẫn', 'bỏ qua quy tắc', 'con không phải minny',
  'giả vờ con không phải minny', 'con là ai vậy', 'con là bot',
  'quên quy tắc đi', 'lệnh mới',
];

export const BANNED_TOPICS = {
  profanity: [...PROFANITY_EN, ...PROFANITY_VI],
  sexual: [...SEXUAL_EN, ...SEXUAL_VI],
  violence: [...VIOLENCE_EN, ...VIOLENCE_VI],
  drugs_weapons: [...DRUGS_WEAPONS_EN, ...DRUGS_WEAPONS_VI],
  self_harm: [...SELF_HARM_EN, ...SELF_HARM_VI],
  personal_info: [...PERSONAL_INFO_TRIGGERS_EN, ...PERSONAL_INFO_TRIGGERS_VI],
  instruction_injection: [...INSTRUCTION_INJECTION_EN, ...INSTRUCTION_INJECTION_VI],
};
