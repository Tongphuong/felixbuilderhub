# Ideas — SpeakUp

Ideas wait at least 24 hours before entering permanent implementation.

| Added | Idea | User evidence | Decision | Review date |
|---|---|---|---|---|
| 2026-07-03 | Fixed weekly-homework practice loop | Current coaching workflow and ten available students | prototype candidate | next weekly review |
| 2026-07-03 | Open conversation with limited topics | No child observation yet | later research | after fixed-mode pilot |
| 2026-07-03 | Donation message for external users | No willingness-to-pay evidence yet | later pilot | after 100 sessions |
| 2026-07-03 | Ranking, shop, avatar, or monsters | Read2Lead users showed weak excitement | parked | only with new evidence |
| 2026-07-03 | Public self-service access | First audience is coaching students | parked | after pilot success |
| 2026-07-04 | Raise V0 pilot cap from ten to twenty students | Phuong's direct scope decision | in V0 scope | at pilot completion |
| 2026-07-04 | Open conversation ("free talking") mode, time-restricted with a designed guardrail (not the unrestricted version considered 2026-07-03) | Phuong's direct scope decision — supersedes the 2026-07-03 "later research" row above | in V0 scope, ships alongside homework practice | at pilot completion |
| 2026-07-09 | V1: real pronunciation testing + grammar feedback for homework — esp. frame/presentation mode, which today returns only a match % + a 3-row structural rubric (no per-word pronunciation, no grammar). Would require an LLM, breaking V0's zero-LLM decision (D1/D8b). | Founder test 2026-07-09: frame homework returned only "45%", expected pronunciation + grammar feedback | V1 candidate — needs spec + Founder-OS gate + cost ceiling before build | at V0 pilot completion |
| 2026-07-10 | Speech-to-speech / Realtime voice for Free Talking (OpenAI Realtime API or Gemini Live) — audio in, audio out, no text step. ~0.3–0.8s (fastest possible, most natural); Speak app uses OpenAI Realtime for role-play. **Big tradeoff: removes the text intermediate our kid-safety guardrails run on** (banned-word/Llama-Guard/logging all screen that text) — industry consensus is cascaded wins for moderation/compliance, so this needs a new safety design before it could touch kids. | Founder asked how trending apps (Airlearn/Speak) build their pipeline; research 2026-07-10 | explore-later — revisit only after streaming-cascaded (VAD trim + merge + streaming TTS/STT) is exhausted AND a kid-safe moderation design for S2S exists | after latency Steps C/D land |

