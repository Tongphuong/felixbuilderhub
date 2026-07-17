# SpeakUp Shadowing — Round 2: trọn bộ 8 màn, hướng "Đêm sân khấu"

Hướng thắng vòng 1 (Night Arcade) phủ đủ 8 trạng thái. Hai màn 04/05 giữ NGUYÊN như bản
đã duyệt (chỉ đổi nhãn board A·04/A·05 → 04/05). Chip mức là **L1–L5** theo lệnh founder.

## Sơ đồ trạng thái (state map)

```
01 gate ─► 01 picker ─► 02 watch ─► (thi thoảng) 03 question ─► 02 watch …
                            │
                            ▼ (hết đoạn)
                        04 record ─► [chờ 1–3s "Minny đang nghe…"] ─► đậu? ─► 05 celebrate ─► 02 watch (đoạn kế)
                                                                      │
                                                                      ▼ trượt
                                                                  06 retry (tối đa 3 lần;
                                                                  lần 3: qua câu, 🔥 về 0 nhẹ nhàng)
                        hết 12 đoạn ─► 07 complete (thưởng: xem trọn video, phát trong app)
08 = 02+04 xếp cạnh nhau cho màn 1280 (tablet/desktop), cùng vùng cùng tên.
```

## Từng màn + giảm chuyển động (reduced motion)

| Màn | Ý chính | Khi "giảm chuyển động" |
|---|---|---|
| 01 | Quầy vé (1 ô vé duy nhất nhập MÃ ĐẦY ĐỦ dạng R2L-LINH-8F3KQ2 — gõ hoặc dán cả mã; placeholder đúng nguyên văn "VD: R2L-LINH-8F3KQ2"; 1 nút vàng) + poster phim đêm, phim nổi bật có dàn đèn marquee; L1–L5 + ⭐ mỗi phim / "Chưa luyện" | Minny đứng yên; đèn marquee vẫn sáng (tĩnh) |
| 02 | Sân khấu sáng đèn, 2 luồng đèn rọi; tiến độ = 12 bóng đèn (4 sáng, bóng 5 nhấp nháy); 1 dòng nhắc | Bóng "hiện tại" ngừng nháy nhưng vẫn sáng trắng nổi bật |
| 03 | Minny hỏi qua bong bóng; 3 tấm VÉ ≥64px; vé đúng bừng vàng + dấu ✓ cuống vé | Vé thắng ngừng "thở" nhưng vẫn sáng và to hơn 3% |
| 04 | (Như vòng 1 đã duyệt) câu = bảng đèn marquee; mic đồng xu đỏ-vàng | Vòng sóng ẩn, đèn giữ sáng tĩnh |
| 05 | (Như vòng 1 đã duyệt) sao rơi + hào quang + 1 nút vàng; kèm khối chờ "Minny đang nghe…" | Confetti/hào quang dừng; trời sao tĩnh vẫn đầy |
| 06 | "Gần đúng rồi!" — chữ đã sáng GIỮ NGUYÊN, nút "Thử lại"; lần 3: "Nghe lại rồi mình qua câu tiếp nhé! 💛", 🔥 0 lặng lẽ, ⭐ giữ | Minny ngừng lắc lư; mọi thứ khác vốn tĩnh |
| 07 | Bảng marquee "Con làm được rồi!", 2 ô kết quả, nút "Xem trọn video" (phát TRONG app) | Confetti + nhún dừng; bảng đèn vẫn sáng |
| 08 | 1280px: sân khấu trái + buồng luyện phải; mic vẫn là thứ duy nhất nổi bật | Như 02+04 |

## Chữ MỚI cần Elon duyệt (ngoài bộ đã chốt + 2 câu khen đã duyệt vòng 1)

- 01: "Mã của con là gì?", "Vào xem!", "Chọn phim cho hôm nay nhé!"
- 02: "Xem nhé… sắp đến lượt con!", "Minny cũng đang xem cùng con"
- 03 (bộ mẫu): "Chú mèo đang làm gì?" / "Đang ngủ 😴" / "Đang ăn 🍎" / "Đang chạy 🏃"
- 06: "Gần đúng rồi!", "Thử lại lần nữa nhé!", "Thử lại 🎤"
- 07: "Con làm được rồi!", "Tổng sao", "Chuỗi dài nhất", "Xem trọn video", "← Chọn video khác"
- Tên phim mẫu (nội dung giả lập, thay bằng video thật): "Chú mèo lười biếng", "Bữa sáng của gấu",
  "Cuộc phiêu lưu trên mây", "Robot nhỏ tốt bụng"
- Đã dùng theo chỉ đạo: "Chưa luyện" (coordinator), "Nghe lại rồi mình qua câu tiếp nhé! 💛" (verbatim founder)

## Ghi chú rule-20 cho người dựng (phải khớp CHÍNH XÁC)

- Bản dựng phải khớp board từng màn NGUYÊN màn hình — full-screen app, không nhét vào trang marketing;
  so sánh screenshot preview với board trước khi báo xong (AGENTS rule 18–20).
- Bắt buộc khớp: (1) câu chữ marquee 3 trạng thái sáng/ấm/tắt đúng màu board; (2) mic ≥112px với vòng
  sóng; (3) nút hành động chính LUÔN là phần tử vàng lớn duy nhất trên màn; (4) dải 12 bóng tiến độ;
  (5) chip L1–L5; (6) 🔥 0 hiển thị bình thường-ấm áp, không đỏ/không rung; (7) crop Minny bằng
  mask tròn + `transform:translateY(-27%)` với `height:190%` (object-position KHÔNG ăn theo chiều dọc
  ở đây); (8) chuỗi copy canonical giữ verbatim từng dấu.
- Mọi id vùng có sẵn trong markup các board: shd-code-card, shd-code-input, shd-video-picker, shd-player-host,
  shd-words, shd-mic-btn, shd-replay-btn, shd-next-btn, shd-question-card, shd-stars, shd-streak,
  shd-progress, shd-summary.
- Font nhúng: KHÔNG dùng (đã cân nhắc quyền nhúng 1 woff2 — subset tiếng Việt đủ dấu quá nặng để lặp
  trong 8 file tự chứa; hệ chữ tròn đậm system-ui đã được duyệt ở vòng 1). Nếu sau này build bằng
  webfont thật (1 lần tải cho cả app), gợi ý: Baloo 2 hoặc Fredoka (đều OFL) — quyết ở vòng build.
