Gamified primitives for the Read2Lead reading app.

```jsx
<RankBadge tier="gold" level={7} />
<ProgressBar value={65} />
<ProgressBar gradient value={70} />   {/* lesson-generating state */}
<TopicTile emoji="🐾" label="Động vật & thú cưng" selected />
```

`RankBadge` tiers: `bronze` (Đồng), `silver` (Bạc), `gold` (Vàng), `diamond` (Kim cương), `legend` (Huyền thoại) — auto-labels in Vietnamese, override with `label`. `TopicTile` renders a `<button>` by default; pass `as="label"` to wrap a hidden radio in a topic grid.
