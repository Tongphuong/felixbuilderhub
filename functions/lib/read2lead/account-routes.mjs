import { assignRead2LeadPack } from '../../api/generate-read2lead-pack.js';
// Explicit rollout coverage, not permission to bypass original authentication.
// Pending paths fail closed in the account host; no legacy-KV fallback.
import * as route0 from '../../api/admin/classes.js';
import * as route1 from '../../api/admin/classes/[id].js';
import * as route2 from '../../api/admin/classes/[id]/homework.js';
import * as route6 from '../../api/admin/classes/[id]/reward.js';
import * as route7 from '../../api/admin/codes.js';
import * as route8 from '../../api/admin/codes/[code].js';
import * as route9 from '../../api/admin/codes/[code]/links.js';
import * as route10 from '../../api/admin/codes/[code]/set-bot-stats.js';
import * as route11 from '../../api/admin/codes/[code]/set-level.js';
import * as route12 from '../../api/admin/codes/apply-bot-presets.js';
import * as route13 from '../../api/admin/codes/clear-open-lessons.js';
import * as route14 from '../../api/admin/codes/reset-levels.js';
import * as route15 from '../../api/admin/config/book-levels.js';
import * as route16 from '../../api/admin/gifts.js';
import * as route17 from '../../api/admin/gifts/redemptions.js';
import * as route18 from '../../api/admin/gifts/redemptions/[id].js';
import * as route23 from '../../api/admin/read2lead-honors.js';
import * as route24 from '../../api/check-generation-status.js';
import * as route29 from '../../api/minny-practice-log.js';
import * as route30 from '../../api/minny-speaking-context.js';
import * as route32 from '../../api/parent/portfolio.js';
import * as route33 from '../../api/parent/portfolio-react.js';
import * as route34 from '../../api/parent/portfolio-seen.js';
import * as route35 from '../../api/parent/video.js';
import * as route36 from '../../api/parent/weekly-tasks.js';
import * as route38 from '../../api/r2l-link.js';
import * as route39 from '../../api/read2lead-ceremony-ack.js';
import * as route40 from '../../api/read2lead-checkpoint-save.js';
import * as route41 from '../../api/read2lead-chest-open.js';
import * as route42 from '../../api/read2lead-daily-chest-claim.js';
import * as route43 from '../../api/read2lead-dropoff.js';
import * as route44 from '../../api/read2lead-gift-goal.js';
import * as route45 from '../../api/read2lead-gift-image.js';
import * as route46 from '../../api/read2lead-gifts-list.js';
import * as route47 from '../../api/read2lead-gifts-redeem.js';
import * as route48 from '../../api/read2lead-honors.js';
import * as route49 from '../../api/read2lead-leaderboard.js';
import * as route50 from '../../api/read2lead-lesson.js';
import * as route51 from '../../api/read2lead-library.js';
import * as route52 from '../../api/read2lead-progress.js';
import * as route53 from '../../api/read2lead-progress-update.js';
import * as route54 from '../../api/read2lead-quest-claim.js';
import * as route55 from '../../api/read2lead-shop.js';
import * as route56 from '../../api/read2lead-shop-buy.js';
import * as route57 from '../../api/read2lead-shop-list.js';
import * as route63 from '../../api/speakup-homework-photo.js';
import * as route64 from '../../api/submit-read2lead-lesson.js';
import * as route65 from '../../api/task-state.js';
import * as route66 from '../../api/voice-quota.js';
import * as route67 from '../../api/admin/signup-config.js';

import * as hostRoute0 from '../../api/admin/classes/[id]/homework-extract.js';
import * as hostRoute1 from '../../api/admin/classes/[id]/homework-photo.js';
import * as hostRoute2 from '../../api/admin/classes/[id]/homework-photo-extract.js';
import * as hostRoute3 from '../../api/admin/gifts/upload.js';
import * as hostRoute4 from '../../api/admin/portfolio.js';
import * as hostRoute5 from '../../api/admin/portfolio/[id].js';
import * as hostRoute6 from '../../api/admin/portfolio/upload.js';
import * as hostRoute7 from '../../api/debug-convo-flags.js';
import * as hostRoute8 from '../../api/debug-speaking.js';
import * as hostRoute9 from '../../api/publish-read2lead-book.js';
import * as hostRoute10 from '../../api/signup.js';

export const ACCOUNT_ROUTES = Object.freeze([
  Object.freeze({ pattern: "/api/admin/classes", file: "functions/api/admin/classes.js", state: "transactional", methods: Object.freeze(["GET", "POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route0 }),
  Object.freeze({ pattern: "/api/admin/classes/[id]", file: "functions/api/admin/classes/[id].js", state: "transactional", methods: Object.freeze(["PATCH"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route1 }),
  Object.freeze({ pattern: "/api/admin/classes/[id]/homework", file: "functions/api/admin/classes/[id]/homework.js", state: "transactional", methods: Object.freeze(["POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route2 }),
  Object.freeze({ pattern: "/api/admin/classes/[id]/homework-extract", file: "functions/api/admin/classes/[id]/homework-extract.js", state: "transactional", execution: "external-read", methods: Object.freeze(["POST"]), reason: "Original handler and permissions; authoritative account transaction, deferred destructive media cleanup where applicable.", handlers: hostRoute0 }),
  Object.freeze({ pattern: "/api/admin/classes/[id]/homework-photo", file: "functions/api/admin/classes/[id]/homework-photo.js", state: "transactional", execution: "media-write", methods: Object.freeze(["POST", "GET"]), reason: "Original handler and permissions; authoritative account transaction, deferred destructive media cleanup where applicable.", handlers: hostRoute1 }),
  Object.freeze({ pattern: "/api/admin/classes/[id]/homework-photo-extract", file: "functions/api/admin/classes/[id]/homework-photo-extract.js", state: "transactional", execution: "external-read", methods: Object.freeze(["POST"]), reason: "Original handler and permissions; authoritative account transaction, deferred destructive media cleanup where applicable.", handlers: hostRoute2 }),
  Object.freeze({ pattern: "/api/admin/classes/[id]/reward", file: "functions/api/admin/classes/[id]/reward.js", state: "transactional", methods: Object.freeze(["POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route6 }),
  Object.freeze({ pattern: "/api/admin/codes", file: "functions/api/admin/codes.js", state: "transactional", methods: Object.freeze(["POST", "GET"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route7 }),
  Object.freeze({ pattern: "/api/admin/codes/[code]", file: "functions/api/admin/codes/[code].js", state: "transactional", methods: Object.freeze(["PATCH", "DELETE"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route8 }),
  Object.freeze({ pattern: "/api/admin/codes/[code]/links", file: "functions/api/admin/codes/[code]/links.js", state: "transactional", methods: Object.freeze(["POST", "GET", "DELETE"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route9 }),
  Object.freeze({ pattern: "/api/admin/codes/[code]/set-bot-stats", file: "functions/api/admin/codes/[code]/set-bot-stats.js", state: "transactional", methods: Object.freeze(["POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route10 }),
  Object.freeze({ pattern: "/api/admin/codes/[code]/set-level", file: "functions/api/admin/codes/[code]/set-level.js", state: "transactional", methods: Object.freeze(["POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route11 }),
  Object.freeze({ pattern: "/api/admin/codes/apply-bot-presets", file: "functions/api/admin/codes/apply-bot-presets.js", state: "transactional", methods: Object.freeze(["POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route12 }),
  Object.freeze({ pattern: "/api/admin/codes/clear-open-lessons", file: "functions/api/admin/codes/clear-open-lessons.js", state: "transactional", methods: Object.freeze(["POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route13 }),
  Object.freeze({ pattern: "/api/admin/codes/reset-levels", file: "functions/api/admin/codes/reset-levels.js", state: "transactional", methods: Object.freeze(["POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route14 }),
  Object.freeze({ pattern: "/api/admin/config/book-levels", file: "functions/api/admin/config/book-levels.js", state: "transactional", methods: Object.freeze(["GET", "POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route15 }),
  Object.freeze({ pattern: "/api/admin/gifts", file: "functions/api/admin/gifts.js", state: "transactional", methods: Object.freeze(["GET", "POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route16 }),
  Object.freeze({ pattern: "/api/admin/gifts/redemptions", file: "functions/api/admin/gifts/redemptions.js", state: "transactional", methods: Object.freeze(["GET"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route17 }),
  Object.freeze({ pattern: "/api/admin/gifts/redemptions/[id]", file: "functions/api/admin/gifts/redemptions/[id].js", state: "transactional", methods: Object.freeze(["PATCH"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route18 }),
  Object.freeze({ pattern: "/api/admin/gifts/upload", file: "functions/api/admin/gifts/upload.js", state: "transactional", execution: "media-write", methods: Object.freeze(["POST"]), reason: "Original handler and permissions; authoritative account transaction, deferred destructive media cleanup where applicable.", handlers: hostRoute3 }),
  Object.freeze({ pattern: "/api/admin/portfolio", file: "functions/api/admin/portfolio.js", state: "transactional", methods: Object.freeze(["GET"]), reason: "Original handler and permissions; authoritative account transaction, deferred destructive media cleanup where applicable.", handlers: hostRoute4 }),
  Object.freeze({ pattern: "/api/admin/portfolio/[id]", file: "functions/api/admin/portfolio/[id].js", state: "transactional", execution: "media-delete", methods: Object.freeze(["DELETE"]), reason: "Original handler and permissions; authoritative account transaction, deferred destructive media cleanup where applicable.", handlers: hostRoute5 }),
  Object.freeze({ pattern: "/api/admin/portfolio/upload", file: "functions/api/admin/portfolio/upload.js", state: "transactional", execution: "media-write", methods: Object.freeze(["POST"]), reason: "Original handler and permissions; authoritative account transaction, deferred destructive media cleanup where applicable.", handlers: hostRoute6 }),
  Object.freeze({ pattern: "/api/admin/read2lead-honors", file: "functions/api/admin/read2lead-honors.js", state: "transactional", methods: Object.freeze(["GET", "POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route23 }),
  Object.freeze({ pattern: "/api/admin/signup-config", file: "functions/api/admin/signup-config.js", state: "transactional", methods: Object.freeze(["GET", "POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route67 }),
  Object.freeze({ pattern: "/api/check-generation-status", file: "functions/api/check-generation-status.js", state: "transactional", execution: "generation-status", methods: Object.freeze(["GET"]), reason: "Original account handler with explicit terminal generation cleanup; its exact marked error response may commit successful cleanup.", handlers: route24 }),
  Object.freeze({ pattern: "/api/debug-convo-flags", file: "functions/api/debug-convo-flags.js", state: "transactional", methods: Object.freeze(["GET"]), reason: "Original handler and permissions; authoritative account transaction, deferred destructive media cleanup where applicable.", handlers: hostRoute7 }),
  Object.freeze({ pattern: "/api/debug-speaking", file: "functions/api/debug-speaking.js", state: "transactional", methods: Object.freeze(["GET"]), reason: "Original handler and permissions; authoritative account transaction, deferred destructive media cleanup where applicable.", handlers: hostRoute8 }),
  Object.freeze({ pattern: "/api/generate-read2lead-pack", file: "functions/api/generate-read2lead-pack.js", state: "transactional", execution: "catalogue-only", methods: Object.freeze(["POST"]), reason: "Existing supplied books/stories only; legacy async generation awaits job coordination.", handlers: Object.freeze({ onRequestPost: context => assignRead2LeadPack(context, { allowExternalGeneration: false }) }) }),
  Object.freeze({ pattern: "/api/minny-conversation", file: "functions/api/minny-conversation.js", state: "retired", methods: Object.freeze(["POST"]), reason: "Standalone SpeakUp retired; reading voice and saved teacher records remain available." }),
  Object.freeze({ pattern: "/api/minny-practice-log", file: "functions/api/minny-practice-log.js", state: "retired", methods: Object.freeze(["POST"]), reason: "Standalone SpeakUp retired; reading voice and saved teacher records remain available.", handlers: route29 }),
  Object.freeze({ pattern: "/api/minny-speaking-context", file: "functions/api/minny-speaking-context.js", state: "retired", methods: Object.freeze(["GET"]), reason: "Standalone SpeakUp retired; reading voice and saved teacher records remain available.", handlers: route30 }),
  Object.freeze({ pattern: "/api/minny-voice", file: "functions/api/minny-voice.js", state: "voice", methods: Object.freeze(["POST"]), reason: "Original tap allowlist and TTS; short account/cache transactions, synthesis outside transaction, current permission rechecked before returning audio." }),
  Object.freeze({ pattern: "/api/parent/portfolio", file: "functions/api/parent/portfolio.js", state: "transactional", methods: Object.freeze(["GET"]), reason: "Original parent ownership and saved portfolio handler; account transaction with read-only media capability where needed.", handlers: route32 }),
  Object.freeze({ pattern: "/api/parent/portfolio-react", file: "functions/api/parent/portfolio-react.js", state: "transactional", methods: Object.freeze(["POST"]), reason: "Original parent ownership and saved portfolio handler; account transaction with read-only media capability where needed.", handlers: route33 }),
  Object.freeze({ pattern: "/api/parent/portfolio-seen", file: "functions/api/parent/portfolio-seen.js", state: "transactional", methods: Object.freeze(["POST"]), reason: "Original parent ownership and saved portfolio handler; account transaction with read-only media capability where needed.", handlers: route34 }),
  Object.freeze({ pattern: "/api/parent/video", file: "functions/api/parent/video.js", state: "transactional", execution: "media-read", methods: Object.freeze(["GET"]), reason: "Original parent ownership and saved portfolio handler; account transaction with read-only media capability where needed.", handlers: route35 }),
  Object.freeze({ pattern: "/api/parent/weekly-tasks", file: "functions/api/parent/weekly-tasks.js", state: "transactional", methods: Object.freeze(["GET", "POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route36 }),
  Object.freeze({ pattern: "/api/publish-read2lead-book", file: "functions/api/publish-read2lead-book.js", state: "transactional", methods: Object.freeze(["GET", "POST"]), reason: "Original handler and permissions; authoritative account transaction, deferred destructive media cleanup where applicable.", handlers: hostRoute9 }),
  Object.freeze({ pattern: "/api/r2l-link", file: "functions/api/r2l-link.js", state: "transactional", methods: Object.freeze(["GET"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route38 }),
  Object.freeze({ pattern: "/api/read2lead-ceremony-ack", file: "functions/api/read2lead-ceremony-ack.js", state: "transactional", methods: Object.freeze(["POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route39 }),
  Object.freeze({ pattern: "/api/read2lead-checkpoint-save", file: "functions/api/read2lead-checkpoint-save.js", state: "transactional", methods: Object.freeze(["POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route40 }),
  Object.freeze({ pattern: "/api/read2lead-chest-open", file: "functions/api/read2lead-chest-open.js", state: "transactional", methods: Object.freeze(["POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route41 }),
  Object.freeze({ pattern: "/api/read2lead-daily-chest-claim", file: "functions/api/read2lead-daily-chest-claim.js", state: "transactional", methods: Object.freeze(["POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route42 }),
  Object.freeze({ pattern: "/api/read2lead-dropoff", file: "functions/api/read2lead-dropoff.js", state: "transactional", methods: Object.freeze(["GET"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route43 }),
  Object.freeze({ pattern: "/api/read2lead-gift-goal", file: "functions/api/read2lead-gift-goal.js", state: "transactional", methods: Object.freeze(["POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route44 }),
  Object.freeze({ pattern: "/api/read2lead-gift-image", file: "functions/api/read2lead-gift-image.js", state: "transactional", execution: "media-read", methods: Object.freeze(["GET"]), reason: "Original gift-config-selected media read; read-only R2 capability, account revision checked before response.", handlers: route45 }),
  Object.freeze({ pattern: "/api/read2lead-gifts-list", file: "functions/api/read2lead-gifts-list.js", state: "transactional", methods: Object.freeze(["POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route46 }),
  Object.freeze({ pattern: "/api/read2lead-gifts-redeem", file: "functions/api/read2lead-gifts-redeem.js", state: "transactional", methods: Object.freeze(["POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route47 }),
  Object.freeze({ pattern: "/api/read2lead-honors", file: "functions/api/read2lead-honors.js", state: "transactional", methods: Object.freeze(["GET"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route48 }),
  Object.freeze({ pattern: "/api/read2lead-leaderboard", file: "functions/api/read2lead-leaderboard.js", state: "transactional", methods: Object.freeze(["GET"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route49 }),
  Object.freeze({ pattern: "/api/read2lead-lesson", file: "functions/api/read2lead-lesson.js", state: "transactional", methods: Object.freeze(["GET"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route50 }),
  Object.freeze({ pattern: "/api/read2lead-library", file: "functions/api/read2lead-library.js", state: "transactional", methods: Object.freeze(["GET"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route51 }),
  Object.freeze({ pattern: "/api/read2lead-progress", file: "functions/api/read2lead-progress.js", state: "transactional", methods: Object.freeze(["GET"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route52 }),
  Object.freeze({ pattern: "/api/read2lead-progress-update", file: "functions/api/read2lead-progress-update.js", state: "transactional", methods: Object.freeze(["POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route53 }),
  Object.freeze({ pattern: "/api/read2lead-quest-claim", file: "functions/api/read2lead-quest-claim.js", state: "transactional", methods: Object.freeze(["POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route54 }),
  Object.freeze({ pattern: "/api/read2lead-shop", file: "functions/api/read2lead-shop.js", state: "transactional", methods: Object.freeze(["POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route55 }),
  Object.freeze({ pattern: "/api/read2lead-shop-buy", file: "functions/api/read2lead-shop-buy.js", state: "transactional", methods: Object.freeze(["POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route56 }),
  Object.freeze({ pattern: "/api/read2lead-shop-list", file: "functions/api/read2lead-shop-list.js", state: "transactional", methods: Object.freeze(["POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route57 }),
  Object.freeze({ pattern: "/api/read2lead-speaking-check", file: "functions/api/read2lead-speaking-check.js", state: "speaking", methods: Object.freeze(["POST"]), reason: "Original access/scoring/coach phases; short account preflight and restricted metadata saves, permission revalidation, explicit background host for coach safety." }),
  Object.freeze({ pattern: "/api/read2lead-story-session", file: "functions/api/read2lead-story-session.js", state: "story", methods: Object.freeze(["*"]), reason: "Explicit story host option: original code auth, pinned assigned content and synchronous account/receipt commit; unset option refuses." }),
  Object.freeze({ pattern: "/api/read2lead-story-turn", file: "functions/api/read2lead-story-turn.js", state: "story", methods: Object.freeze(["*"]), reason: "Explicit story host option with original provider activation/budget checks, fresh account/content checks around external work." }),
  Object.freeze({ pattern: "/api/read2lead-voice", file: "functions/api/read2lead-voice.js", state: "voice", methods: Object.freeze(["POST"]), reason: "Original current-pack allowlist and TTS; reuses short account/cache transactions, external synthesis, and current permission revalidation." }),
  Object.freeze({ pattern: "/api/signup", file: "functions/api/signup.js", state: "transactional", execution: "external-read", methods: Object.freeze(["POST"]), reason: "Original handler and permissions; authoritative account transaction, deferred destructive media cleanup where applicable.", handlers: hostRoute10 }),
  Object.freeze({ pattern: "/api/speakup-homework-photo", file: "functions/api/speakup-homework-photo.js", state: "transactional", execution: "media-read", methods: Object.freeze(["GET"]), reason: "Original owner/current-homework media read; read-only R2 capability, account revision checked before response.", handlers: route63 }),
  Object.freeze({ pattern: "/api/submit-read2lead-lesson", file: "functions/api/submit-read2lead-lesson.js", state: "transactional", methods: Object.freeze(["POST"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route64 }),
  Object.freeze({ pattern: "/api/task-state", file: "functions/api/task-state.js", state: "transactional", methods: Object.freeze(["POST", "GET"]), reason: "Original backend-secret-protected task callback/read with TTL; ordinary SQL only, no provider call.", handlers: route65 }),
  Object.freeze({ pattern: "/api/voice-quota", file: "functions/api/voice-quota.js", state: "transactional", methods: Object.freeze(["GET"]), reason: "Original ordinary handler; account reads/writes share the transaction.", handlers: route66 }),
]);
