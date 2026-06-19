Content-surface primitives: `Card`, `Badge`, `Avatar`, `SectionHeading`, and `Faq`.

```jsx
<SectionHeading eyebrow="Bổ trợ ngoài lớp" title="Sản phẩm giáo dục tăng cường bởi AI" lead="Felix dùng AI để tạo bài luyện đọc cá nhân hoá." />

<Card variant="accent">
  <Badge variant="gold">Thử nghiệm — miễn phí</Badge>
  <h3>Read2Lead</h3>
</Card>

<Avatar src="/assets/felix.jpg" alt="Thầy Phương" size="lg" />

<Faq question="Lớp học có bao nhiêu bạn?">Nhóm nhỏ tối đa 4 học viên.</Faq>
```

`Card` variants: default (subtle border), `accent` (gold border), `raised` (solid + shadow); add `interactive` + `href` for link cards. `Badge` variants: `accent`, `gold`, `neutral`, `solid`.
