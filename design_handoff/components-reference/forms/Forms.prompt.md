Navy form controls with a gold focus ring — used across coaching booking and Read2Lead lesson forms. Each takes an optional `label`, `required` flag, and `hint`.

```jsx
<Input label="Tên phụ huynh" required placeholder="Nguyễn Văn A" />
<Select label="Level tiếng Anh hiện tại" required>
  <option value="" disabled selected>-- Chọn level --</option>
  <option value="beginner">Mới bắt đầu</option>
</Select>
<Textarea label="Mục tiêu của phụ huynh" rows={3} hint="Không bắt buộc" />
```

`Input`, `Select`, and `Textarea` share styling. Pass any native attribute (`type`, `placeholder`, `maxLength`, `pattern`, …) straight through.
