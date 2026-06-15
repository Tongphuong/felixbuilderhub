# SPEC — Trang Video & Nhận xét cho phụ huynh (Parent Portfolio)

> **Status: P1 = READY for Codex.** P2/P3 = SCOPED, not cleared for coding.
> Owner: Claude (spec + review) · Codex (implement P1) · Phương (acceptance + ops).
> Branch: `codex/parent-portfolio`. **Never push `main`** (AGENTS.md §3b, §8).
> Inspired by ClassDojo's student portfolio (teacher posts video + note, parent
> views/reacts, read receipt). Deliberately NOT cloned: no class-wide feed, no
> chat/messaging, no points (rank/coins already exist in R2L).

## Goal

Phương chia sẻ video bài nói của học sinh (clip cắt từ Zoom cloud bằng
`D:\tools\video_pipeline`, upload thủ công) kèm nhận xét tiếng Việt; phụ huynh
xem bằng **mã học sinh hiện có** trên `/phu-huynh` — không tài khoản mới, không
mật khẩu mới. Video là dữ liệu trẻ em → **private by default**, chỉ xem được
khi có đúng mã.

## Phase P1 (READY)

### 1. Data — KV (additive ONLY)

New key per student: `portfolio:<ACCESS_CODE>` → JSON array, newest first, max 50:

```json
[{
  "id": "vp_x7k2m9q4w1z8",
  "ts": "2026-06-12T09:00:00.000Z",
  "video_key": "portfolio/R2L-LINH-8F3KQ2/vp_x7k2m9q4w1z8.mp4",
  "size": 18345678,
  "content_type": "video/mp4",
  "title": "Bài nói tuần này",
  "note_vi": "Con phát âm 'th' tốt hơn hẳn. Tuần sau mình luyện thêm âm cuối nhé!",
  "parent_seen_at": null,
  "reactions": { "heart": 0, "clap": 0, "strong": 0 }
}]
```

- `id`: `vp_` + 12 unguessable chars (crypto random, charset a-z0-9).
- **NEVER read-modify-write `progress:<code>` or the access-code record** —
  portfolio lives in its own key. (Live-data rule, AGENTS.md §3b.)

### 2. Storage — R2

- Binding name: **`R2L_MEDIA`** → existing bucket `felixbuilderhub-read2lead`.
  Ops (Phương, hướng dẫn riêng): Pages → Settings → Bindings → R2 → add for
  Production + Preview. Code must fail soft with a clear Vietnamese error if
  the binding is missing (`{ ok:false, error:'config_error' }`), never crash.
- Object key: `portfolio/<code>/<id>.<ext>`; ext from content type.
- Accept `video/mp4`, `video/webm`, `video/quicktime`; max **80MB**.

### 3. API

Admin endpoints live under `functions/api/admin/` → existing Basic-Auth
middleware covers them automatically. Parent endpoints are code-gated and
reuse `checkCodeRateLimit` from `functions/api/_rate-limit.js`.

1. `POST /api/admin/portfolio/upload` — multipart `access_code, title, note_vi, video`.
   Validate code exists in KV → put video to R2 → prepend entry (trim to 50) → return entry.
2. `GET /api/admin/portfolio?code=...` — full list incl. seen/reactions.
3. `DELETE /api/admin/portfolio/<id>?code=...` — remove entry + R2 object.
4. `GET /api/parent/portfolio?code=...` — rate-limited; validate code; return list
   (omit `video_key`, return `video_url: /api/parent/video?code=..&id=..`).
5. `GET /api/parent/video?code=...&id=...` — validate code owns `id`, stream R2
   object. **Must pass through Range requests** (`request.headers.get('range')` →
   `R2L_MEDIA.get(key, { range })`, status 206 + `Content-Range`) so iOS Safari
   can play. `Cache-Control: private, max-age=0`.
6. `POST /api/parent/portfolio-seen` — body `{code, id}`; set `parent_seen_at`
   if null. Fire-and-forget from client.
7. `POST /api/parent/portfolio-react` — body `{code, id, kind}`; kind ∈
   heart|clap|strong; increment, cap 99.

### 4. UI

**Parent — extend `/phu-huynh`** (src/pages/phu-huynh/index.astro + phu-huynh.ts):
- New dashboard section "🎬 Video & nhận xét của thầy" rendered after progress
  cards, fetched from `/api/parent/portfolio`.
- Card: title + date (vd "12/06") + `<video controls playsinline preload="metadata">`
  + nhận xét + 3 reaction buttons (optimistic update).
- First `play` event per card → POST portfolio-seen.
- Deep link: `#video-<id>` scrolls to card (Phương gửi link qua Zalo).
- Empty state: "Chưa có video nào. Thầy sẽ gửi video và nhận xét sau buổi học nhé."
- Copy FUNCTIONAL, không hype (positioning rule). Tone thân thiện, khen nỗ lực (M0).

**Teacher — new `src/pages/admin/portfolio.astro`** (mirror admin/codes.astro style):
- Student picker (reuse `GET /api/admin/codes`).
- Upload form: file + title + note_vi + nút "Gửi cho phụ huynh"; disable while
  uploading; show % nếu khả thi, tối thiểu spinner + kết quả rõ ràng.
- Per-student list: thumbnail-less rows — title, date, size, "Phụ huynh đã xem ✓"
  hoặc "Chưa xem", reaction counts, nút Xoá (confirm).

### 5. Tests (structural, theo style tests/*.test.mjs hiện có)

`tests/parent-portfolio.test.mjs`:
- Parent page chứa portfolio section + gọi portfolio-seen + portfolio-react.
- Admin page tồn tại, có upload form + delete confirm.
- API: validate access code TRƯỚC khi đọc R2; có Range passthrough (`206`);
  upload giới hạn 80MB + content-type whitelist; KV key `portfolio:` (không
  đụng `progress:`); fail-soft khi thiếu binding R2L_MEDIA.
- `node --test` xanh toàn bộ + `npx astro build` sạch.

### 6. Out of scope P1 — KHÔNG build

Parent comment/reply · Zoom auto-import · thumbnails/transcoding · push/Zalo
notification · multi-child linking · pagination quá 50 · public share links.

## P2 (SCOPED — cần spec Claude trước khi code)
Parent reply (1 text per video) · Telegram notify Phương khi phụ huynh xem ·
poster frame tự động · Zoom cloud picker (S2S OAuth) import bán tự động.

## P3 (SCOPED)
Weekly digest tự động (nối workflow Zoom parent report) · retention/cleanup
policy cho R2 · nhiều con một phụ huynh.

## Acceptance (Phương)
1. Vào `/admin/portfolio` (Basic Auth) → chọn học sinh → upload 1 clip + nhận xét → thấy trong list.
2. Mở `/phu-huynh` nhập mã học sinh đó → thấy video, phát được trên iPhone + Android.
3. Bấm ❤️ → quay lại admin thấy reaction + "Đã xem ✓".
4. Nhập mã học sinh KHÁC → không thấy video của em kia.
