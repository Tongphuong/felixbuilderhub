# SpeakUp Shadowing — Round 1: hai hướng thiết kế cạnh tranh

Hai thế giới khác nhau thật sự — không phải một bản đổi màu. Mỗi hướng có 2 màn:
**04** (bé ghi âm, câu sáng dần kiểu karaoke) và **05** (đậu câu — ăn mừng, kèm khối nhỏ
"Minny đang nghe…" lúc chờ chấm điểm 1–3 giây).

## Hướng A — "Đêm sân khấu" (A-04, A-05)

Vẫn là thế giới xanh đậm – vàng – kem mà các bé đã quen từ trang bài tập, nhưng đẩy lên
thành một sân khấu trò chơi về đêm: trời sao, ánh đèn vàng hắt từ dưới lên. Ý tưởng trung
tâm là **câu nói = bảng đèn marquee**: mỗi chữ là một bóng đèn — nói đúng thì bóng BẬT SÁNG
vàng rực, gần đúng thì bóng đang ấm dần (viền cam), chưa nói tới thì bóng còn tắt. Nút mic
là một "đồng xu" đỏ-vàng khổng lồ có vòng sóng lan tỏa — thứ duy nhất muốn bấm. Khi đậu câu:
sao lấp lánh đầy trời, Minny nhún nhảy trong vòng hào quang vàng, và một nút vàng lớn duy
nhất để đi tiếp. *Chuyển động:* nếu máy bé bật "giảm chuyển động", mọi hiệu ứng dừng lại
nhưng đèn vẫn sáng, sao vẫn đầy trời — màn hình vẫn vui, chỉ đứng yên.

## Hướng B — "Ngày nắng hình dán" (B-04, B-05)

Bảng màu được thả tự do: trời xanh da trời, nắng vàng, đỏ kẹo — cả màn hình như một cuốn
sổ dán hình mà bé nào cũng có. Ý tưởng trung tâm là **mọi thứ đều là hình dán cắt sẵn**:
viền trắng dày, bóng đổ lệch như dán hơi cong, và mỗi chữ trong câu là một khối đồ chơi
dán nghiêng nghiêng — nói đúng là khối bật XANH kèm dấu ✓, gần đúng là khối cam, chưa nói
tới là khối trắng. Nút mic là hình dán tròn ĐỎ khổng lồ giữa tia nắng trắng. Khi đậu câu:
Minny nhảy lên giữa vòng mặt trời vàng, hình dán rơi đầy trời, và một nút XANH LÁ khổng lồ
"Câu tiếp theo →". *Chuyển động:* với "giảm chuyển động", các hình dán đứng yên tại chỗ —
bố cục vốn nghiêng nghiêng nên màn hình vẫn tinh nghịch mà không cần cử động.

## Copy drafts cho Elon duyệt (chữ mới, ngoài bộ chữ đã chốt)

- A-05, tiêu đề ăn mừng: **"Tuyệt vời!"**
- B-05, tiêu đề ăn mừng: **"Giỏi quá!"**
- (Trang trí trong khung phim: chữ "z z" cạnh chú mèo ngủ — phần của tranh, không phải UI.)

## Ghi chú kỹ thuật cho người dựng

- Mỗi board là 1 file `.dc.html` tự chứa, canvas 390px, mọi nút chạm ≥ 44px.
- Ảnh Minny: `../../public/assets/minny/minny_celebrate.png` và `minny_listen.png`
  (crop tròn bằng CSS — file gốc là cảnh đầy đủ, chưa tách nền).
- Tên vùng giữ nguyên làm `id` trong markup, không hiển thị: `shd-player-host`,
  `shd-words`, `shd-mic-btn`, `shd-replay-btn`, `shd-next-btn`, `shd-stars`,
  `shd-streak`, `shd-summary`.
- Không dùng font ngoài (board tự chứa) — chữ đậm tròn dựa trên `ui-rounded` +
  system stack; hướng B thêm fallback chữ mềm cho máy Windows/iOS.
