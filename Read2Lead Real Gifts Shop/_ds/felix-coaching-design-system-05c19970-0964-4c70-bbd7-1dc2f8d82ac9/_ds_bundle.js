/* @ds-bundle: {"format":3,"namespace":"FelixCoachingDesignSystem_05c199","components":[{"name":"Button","sourcePath":"components/buttons/Button.jsx"},{"name":"Avatar","sourcePath":"components/content/Avatar.jsx"},{"name":"Badge","sourcePath":"components/content/Badge.jsx"},{"name":"Card","sourcePath":"components/content/Card.jsx"},{"name":"Faq","sourcePath":"components/content/Faq.jsx"},{"name":"SectionHeading","sourcePath":"components/content/SectionHeading.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Textarea","sourcePath":"components/forms/Textarea.jsx"},{"name":"ProgressBar","sourcePath":"components/read2lead/ProgressBar.jsx"},{"name":"RankBadge","sourcePath":"components/read2lead/RankBadge.jsx"},{"name":"TopicTile","sourcePath":"components/read2lead/TopicTile.jsx"}],"sourceHashes":{"components/buttons/Button.jsx":"1a49e58c596c","components/content/Avatar.jsx":"f3471a2f4167","components/content/Badge.jsx":"fa52c96a1d6d","components/content/Card.jsx":"3e33d74b678f","components/content/Faq.jsx":"8685de5b39fc","components/content/SectionHeading.jsx":"229383e89b11","components/forms/Input.jsx":"a83a37556bd9","components/forms/Select.jsx":"937f14c20e34","components/forms/Textarea.jsx":"93b5d16395c0","components/read2lead/ProgressBar.jsx":"affe12da944d","components/read2lead/RankBadge.jsx":"976720e8cbb3","components/read2lead/TopicTile.jsx":"ee939ee02e7b","ui_kits/read2lead/App.jsx":"517ed7705ee9","ui_kits/website/Chrome.jsx":"bccc56226f50","ui_kits/website/Contact.jsx":"f38ae12077f5","ui_kits/website/Screens.jsx":"259c4a6edbc5"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.FelixCoachingDesignSystem_05c199 = window.FelixCoachingDesignSystem_05c199 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/buttons/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Felix Coaching primary action button. Renders a <button> by default, or an
 * <a> when `href` is supplied. Styling ships via the design-system CSS classes.
 */
function Button({
  variant = 'primary',
  size = 'md',
  href,
  block = false,
  disabled = false,
  className = '',
  children,
  ...rest
}) {
  const classes = ['fx-btn', `fx-btn--${variant}`, `fx-btn--${size}`, block ? 'fx-btn--block' : '', className].filter(Boolean).join(' ');
  if (href && !disabled) {
    return /*#__PURE__*/React.createElement("a", _extends({
      href: href,
      className: classes
    }, rest), children);
  }
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    className: classes,
    disabled: disabled
  }, rest), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/buttons/Button.jsx", error: String((e && e.message) || e) }); }

// components/content/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Circular avatar image with a soft gold ring. Used for the coach photo & student avatars. */
function Avatar({
  src,
  alt = '',
  size = 'md',
  className = '',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("img", _extends({
    src: src,
    alt: alt,
    className: ['fx-avatar', `fx-avatar--${size}`, className].filter(Boolean).join(' ')
  }, rest));
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/content/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Small pill/tag label. Use for eyebrows, status flags, and "free / beta" markers. */
function Badge({
  variant = 'accent',
  className = '',
  children,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    className: ['fx-badge', `fx-badge--${variant}`, className].filter(Boolean).join(' ')
  }, rest), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/Badge.jsx", error: String((e && e.message) || e) }); }

// components/content/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Bordered navy content card. The system's default container for grouped content. */
function Card({
  variant,
  interactive = false,
  as = 'div',
  href,
  className = '',
  children,
  ...rest
}) {
  const classes = ['fx-card', variant ? `fx-card--${variant}` : '', interactive ? 'fx-card--interactive' : '', className].filter(Boolean).join(' ');
  const Tag = href ? 'a' : as;
  return /*#__PURE__*/React.createElement(Tag, _extends({
    className: classes,
    href: href
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/Card.jsx", error: String((e && e.message) || e) }); }

// components/content/Faq.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Collapsible FAQ item built on <details>/<summary> with a gold rotating chevron. */
function Faq({
  question,
  children,
  open = false,
  className = '',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("details", _extends({
    className: ['fx-faq', className].filter(Boolean).join(' '),
    open: open
  }, rest), /*#__PURE__*/React.createElement("summary", null, question), /*#__PURE__*/React.createElement("div", {
    className: "fx-faq__body"
  }, children));
}
Object.assign(__ds_scope, { Faq });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/Faq.jsx", error: String((e && e.message) || e) }); }

// components/content/SectionHeading.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Eyebrow + title + lead block. The standard way the brand opens a section. */
function SectionHeading({
  eyebrow,
  title,
  lead,
  align = 'left',
  titleSize = 'var(--text-display-sm)',
  className = '',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: className,
    style: {
      textAlign: align,
      maxWidth: align === 'center' ? '42rem' : undefined,
      marginInline: align === 'center' ? 'auto' : undefined
    }
  }, rest), eyebrow && /*#__PURE__*/React.createElement("p", {
    className: "fx-eyebrow"
  }, eyebrow), /*#__PURE__*/React.createElement("h2", {
    className: "fx-section-heading__title",
    style: {
      fontSize: titleSize
    }
  }, title), lead && /*#__PURE__*/React.createElement("p", {
    className: "fx-section-heading__lead"
  }, lead));
}
Object.assign(__ds_scope, { SectionHeading });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/SectionHeading.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Labelled text/number input field. Wrap a label + <input> with the brand's
 * navy field styling and gold focus ring.
 */
function Input({
  label,
  id,
  required = false,
  hint,
  className = '',
  ...rest
}) {
  const inputId = id || (label ? `fx-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  return /*#__PURE__*/React.createElement("div", {
    className: className
  }, label && /*#__PURE__*/React.createElement("label", {
    className: "fx-label",
    htmlFor: inputId
  }, label, " ", required && /*#__PURE__*/React.createElement("span", {
    className: "fx-label__req"
  }, "*")), /*#__PURE__*/React.createElement("input", _extends({
    id: inputId,
    className: "fx-field",
    required: required
  }, rest)), hint && /*#__PURE__*/React.createElement("p", {
    style: {
      marginTop: 'var(--space-2)',
      fontSize: 'var(--text-xs)',
      color: 'var(--text-muted)'
    }
  }, hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Labelled <select> with the brand's custom gold chevron and navy field styling. */
function Select({
  label,
  id,
  required = false,
  hint,
  children,
  className = '',
  ...rest
}) {
  const inputId = id || (label ? `fx-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  return /*#__PURE__*/React.createElement("div", {
    className: className
  }, label && /*#__PURE__*/React.createElement("label", {
    className: "fx-label",
    htmlFor: inputId
  }, label, " ", required && /*#__PURE__*/React.createElement("span", {
    className: "fx-label__req"
  }, "*")), /*#__PURE__*/React.createElement("select", _extends({
    id: inputId,
    className: "fx-field",
    required: required
  }, rest), children), hint && /*#__PURE__*/React.createElement("p", {
    style: {
      marginTop: 'var(--space-2)',
      fontSize: 'var(--text-xs)',
      color: 'var(--text-muted)'
    }
  }, hint));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Textarea.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Labelled multi-line text area, sharing the navy field styling. */
function Textarea({
  label,
  id,
  required = false,
  hint,
  className = '',
  rows = 3,
  ...rest
}) {
  const inputId = id || (label ? `fx-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  return /*#__PURE__*/React.createElement("div", {
    className: className
  }, label && /*#__PURE__*/React.createElement("label", {
    className: "fx-label",
    htmlFor: inputId
  }, label, " ", required && /*#__PURE__*/React.createElement("span", {
    className: "fx-label__req"
  }, "*")), /*#__PURE__*/React.createElement("textarea", _extends({
    id: inputId,
    className: "fx-field",
    rows: rows,
    required: required
  }, rest)), hint && /*#__PURE__*/React.createElement("p", {
    style: {
      marginTop: 'var(--space-2)',
      fontSize: 'var(--text-xs)',
      color: 'var(--text-muted)'
    }
  }, hint));
}
Object.assign(__ds_scope, { Textarea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Textarea.jsx", error: String((e && e.message) || e) }); }

// components/read2lead/ProgressBar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** XP / progress bar. Use `gradient` for the lesson-generation "thinking" state. */
function ProgressBar({
  value = 0,
  gradient = false,
  className = '',
  ...rest
}) {
  const pct = Math.max(0, Math.min(100, value));
  return /*#__PURE__*/React.createElement("span", _extends({
    className: ['fx-progress', className].filter(Boolean).join(' '),
    role: "progressbar",
    "aria-valuenow": pct,
    "aria-valuemin": 0,
    "aria-valuemax": 100
  }, rest), /*#__PURE__*/React.createElement("span", {
    className: ['fx-progress__fill', gradient ? 'fx-progress__fill--gradient' : ''].filter(Boolean).join(' '),
    style: {
      width: `${pct}%`
    }
  }));
}
Object.assign(__ds_scope, { ProgressBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/read2lead/ProgressBar.jsx", error: String((e && e.message) || e) }); }

// components/read2lead/RankBadge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const TIERS = {
  bronze: 'Đồng',
  silver: 'Bạc',
  gold: 'Vàng',
  diamond: 'Kim cương',
  legend: 'Huyền thoại'
};

/** Read2Lead rank tier badge — Đồng / Bạc / Vàng / Kim cương / Huyền thoại. */
function RankBadge({
  tier = 'bronze',
  label,
  level,
  className = '',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    className: ['fx-rank', `fx-rank--${tier}`, className].filter(Boolean).join(' ')
  }, rest), /*#__PURE__*/React.createElement("span", {
    className: "fx-rank__dot",
    "aria-hidden": "true"
  }), /*#__PURE__*/React.createElement("span", null, label || TIERS[tier], level != null ? ` · LV ${level}` : ''));
}
Object.assign(__ds_scope, { RankBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/read2lead/RankBadge.jsx", error: String((e && e.message) || e) }); }

// components/read2lead/TopicTile.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Selectable topic tile (emoji + label) used in the Read2Lead lesson builder. */
function TopicTile({
  emoji,
  label,
  selected = false,
  as = 'button',
  className = '',
  ...rest
}) {
  const Tag = as;
  return /*#__PURE__*/React.createElement(Tag, _extends({
    type: as === 'button' ? 'button' : undefined,
    className: ['fx-topic', selected ? 'fx-topic--selected' : '', className].filter(Boolean).join(' '),
    "aria-pressed": as === 'button' ? selected : undefined
  }, rest), /*#__PURE__*/React.createElement("span", {
    className: "fx-topic__emoji",
    "aria-hidden": "true"
  }, emoji), /*#__PURE__*/React.createElement("span", {
    className: "fx-topic__label"
  }, label));
}
Object.assign(__ds_scope, { TopicTile });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/read2lead/TopicTile.jsx", error: String((e && e.message) || e) }); }

// ui_kits/read2lead/App.jsx
try { (() => {
/* Read2Lead UI kit — the AI lesson builder flow.
   Recreates the production /read2lead create-lesson experience:
   enter student code → choose a topic → generate → lesson ready.
   Plus a compact gamified app header and a leaderboard peek. */

(() => {
  const {
    Button,
    Input,
    Card,
    Badge,
    RankBadge,
    ProgressBar,
    TopicTile
  } = window.FelixCoachingDesignSystem_05c199;
  const TOPICS = [['🐾', 'Động vật & thú cưng'], ['👨‍👩‍👧', 'Gia đình & bạn bè'], ['🏫', 'Trường học'], ['⚽', 'Thể thao'], ['🎮', 'Trò chơi & đồ chơi'], ['🚗', 'Xe cộ'], ['🍳', 'Đồ ăn & nấu ăn'], ['🌳', 'Thiên nhiên'], ['🎨', 'Vẽ & sáng tạo'], ['🦸', 'Nghề nghiệp & ước mơ'], ['✨', 'Tưởng tượng'], ['🏮', 'Lễ hội Việt Nam']];
  function AppHeader({
    onLeaderboard
  }) {
    return /*#__PURE__*/React.createElement("header", {
      style: {
        position: 'sticky',
        top: 0,
        zIndex: 50,
        borderBottom: '1px solid var(--border-subtle)',
        background: 'color-mix(in srgb, var(--navy-950) 95%, transparent)',
        backdropFilter: 'blur(8px)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: 'var(--container)',
        margin: '0 auto',
        padding: '10px var(--gutter)',
        display: 'flex',
        alignItems: 'center',
        gap: 12
      }
    }, /*#__PURE__*/React.createElement("img", {
      src: "../../assets/logo-header.png",
      alt: "Read2Lead",
      style: {
        height: 30,
        borderRadius: 5
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }), /*#__PURE__*/React.createElement(RankBadge, {
      tier: "gold",
      level: 7
    }), /*#__PURE__*/React.createElement("span", {
      className: "r2l-stat",
      style: {
        fontWeight: 700,
        color: 'var(--gold)',
        fontSize: 'var(--text-sm)'
      }
    }, "240 xu"), /*#__PURE__*/React.createElement("span", {
      className: "r2l-stat",
      style: {
        fontWeight: 700,
        color: 'var(--cream)',
        fontSize: 'var(--text-sm)'
      }
    }, "\uD83D\uDD25 5 ng\xE0y"), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "secondary",
      onClick: onLeaderboard
    }, "B\u1EA3ng x\u1EBFp h\u1EA1ng")), /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: 'var(--container)',
        margin: '0 auto',
        padding: '0 var(--gutter) 10px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: 'var(--text-xs)',
        color: 'var(--cream-muted)',
        marginBottom: 4
      }
    }, /*#__PURE__*/React.createElement("span", null, "C\u1EA5p 7 \xB7 V\xE0ng"), /*#__PURE__*/React.createElement("span", null, "42/60 XP")), /*#__PURE__*/React.createElement(ProgressBar, {
      value: 70
    })));
  }
  function Stepper({
    step
  }) {
    const steps = ['Nhập mã', 'Chọn chủ đề', 'Tạo bài', 'Mở bài'];
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 4,
        marginBottom: 28
      }
    }, steps.map((label, i) => /*#__PURE__*/React.createElement(React.Fragment, {
      key: i
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        textAlign: 'center'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'flex',
        width: 34,
        height: 34,
        margin: '0 auto',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
        fontWeight: 700,
        background: i <= step ? 'var(--accent)' : 'color-mix(in srgb, var(--cream) 12%, transparent)',
        color: i <= step ? 'var(--navy-950)' : 'var(--cream)'
      }
    }, i + 1), /*#__PURE__*/React.createElement("p", {
      style: {
        marginTop: 6,
        fontSize: 'var(--text-xs)',
        color: i <= step ? 'var(--cream)' : 'var(--cream-dim)'
      }
    }, label)), i < steps.length - 1 && /*#__PURE__*/React.createElement("div", {
      style: {
        height: 1,
        flex: 1,
        marginTop: 17,
        background: 'color-mix(in srgb, var(--cream) 20%, transparent)'
      }
    }))));
  }
  function Builder({
    onGenerate
  }) {
    const [code, setCode] = React.useState('R2L-JUN-A4F2');
    const [topic, setTopic] = React.useState(0);
    const step = !code ? 0 : 1;
    return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Stepper, {
      step: step
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: 24
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "fx-label"
    }, "B\u01B0\u1EDBc 1 \u2014 Nh\u1EADp m\xE3 h\u1ECDc sinh ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--danger)'
      }
    }, "*")), /*#__PURE__*/React.createElement("input", {
      className: "fx-field",
      value: code,
      onChange: e => setCode(e.target.value.toUpperCase()),
      placeholder: "VD: R2L-JUN-A4F2",
      style: {
        fontSize: 'var(--text-lg)',
        textTransform: 'uppercase'
      }
    })), /*#__PURE__*/React.createElement(Card, {
      style: {
        marginBottom: 24,
        background: 'color-mix(in srgb, var(--gold) 8%, transparent)',
        borderColor: 'var(--accent-border)',
        padding: 16
      }
    }, /*#__PURE__*/React.createElement("p", {
      style: {
        fontSize: 'var(--text-sm)',
        fontWeight: 600,
        color: 'var(--gold-light)',
        margin: 0
      }
    }, "M\xE3 h\u1ECDc sinh l\xE0 g\xEC?"), /*#__PURE__*/React.createElement("p", {
      style: {
        marginTop: 4,
        fontSize: 'var(--text-sm)',
        color: 'var(--cream-muted)',
        lineHeight: 1.6
      }
    }, "M\xE3 ri\xEAng c\u1EE7a b\xE9 \u2014 Felix g\u1EEDi qua Zalo. Ch\u01B0a c\xF3 m\xE3? Nh\u1EAFn Zalo Felix.")), /*#__PURE__*/React.createElement("label", {
      className: "fx-label"
    }, "B\u01B0\u1EDBc 2 \u2014 Con th\xEDch ch\u1EE7 \u0111\u1EC1 g\xEC? ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--danger)'
      }
    }, "*")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 10,
        marginTop: 8
      },
      className: "topic-grid"
    }, TOPICS.map(([emoji, label], i) => /*#__PURE__*/React.createElement(TopicTile, {
      key: i,
      emoji: emoji,
      label: label,
      selected: topic === i,
      onClick: () => setTopic(i)
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 28
      }
    }, /*#__PURE__*/React.createElement(Button, {
      size: "lg",
      block: true,
      disabled: !code,
      onClick: () => onGenerate(TOPICS[topic])
    }, "T\u1EA1o b\xE0i h\u1ECDc cho con")));
  }
  function Generating() {
    const stages = ['Đang viết câu chuyện riêng cho con...', 'Đang chuẩn bị phần nghe cho câu chuyện...', 'Đang ghi âm các cụm câu để con tập đọc...', 'Đang chuẩn bị nhiệm vụ web cho con...'];
    const [s, setS] = React.useState(0);
    React.useEffect(() => {
      const t = setInterval(() => setS(x => Math.min(x + 1, stages.length - 1)), 1400);
      return () => clearInterval(t);
    }, []);
    return /*#__PURE__*/React.createElement(Card, {
      variant: "raised",
      style: {
        textAlign: 'center',
        padding: 36
      }
    }, /*#__PURE__*/React.createElement(ProgressBar, {
      gradient: true,
      value: 30 + s * 20
    }), /*#__PURE__*/React.createElement("p", {
      style: {
        marginTop: 24,
        fontSize: 'var(--text-lg)',
        fontWeight: 600,
        color: 'var(--cream)'
      }
    }, stages[s]), /*#__PURE__*/React.createElement("p", {
      style: {
        marginTop: 12,
        fontSize: 'var(--text-sm)',
        color: 'var(--cream-dim)'
      }
    }, "L\u1EA7n \u0111\u1EA7u c\xF3 th\u1EC3 ch\u1EADm h\u01A1n m\u1ED9t ch\xFAt v\xEC m\xE1y ch\u1EE7 c\u1EA7n kh\u1EDFi \u0111\u1ED9ng."));
  }
  function Result({
    topic,
    onReset
  }) {
    return /*#__PURE__*/React.createElement(Card, {
      style: {
        textAlign: 'center',
        padding: 36,
        background: 'color-mix(in srgb, var(--gold) 10%, transparent)',
        borderColor: 'var(--accent-border)'
      }
    }, /*#__PURE__*/React.createElement("h2", {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: 'var(--text-h3)',
        color: 'var(--cream)'
      }
    }, "B\xE0i h\u1ECDc c\u1EE7a b\xE9 Na \u0111\xE3 s\u1EB5n s\xE0ng"), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 16,
        color: 'var(--cream-muted)'
      }
    }, /*#__PURE__*/React.createElement("p", null, "Ch\u1EE7 \u0111\u1EC1: ", /*#__PURE__*/React.createElement("strong", {
      style: {
        color: 'var(--cream)'
      }
    }, topic[1])), /*#__PURE__*/React.createElement("p", null, "T\xEAn truy\u1EC7n: ", /*#__PURE__*/React.createElement("strong", {
      style: {
        color: 'var(--cream)'
      }
    }, "Ch\xFA M\xE8o L\u1EA1c Gi\u1EEFa V\xEC Sao"))), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 24
      }
    }, /*#__PURE__*/React.createElement(Button, {
      size: "lg"
    }, "M\u1EDF b\xE0i h\u1ECDc")), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 20
      }
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      onClick: onReset
    }, "T\u1EA1o b\xE0i m\u1EDBi")));
  }
  function Leaderboard({
    onBack
  }) {
    const rows = [['🥇', 'Bảo Nam', 'legend', 1820], ['🥈', 'Minh Anh', 'diamond', 1640], ['🥉', 'Khánh Vy', 'gold', 1390], ['4', 'Gia Hân', 'gold', 1120], ['5', 'Bé Na', 'silver', 980], ['6', 'Tuấn Kiệt', 'bronze', 640]];
    return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 20
      }
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      onClick: onBack
    }, "\u2190 Quay l\u1EA1i"), /*#__PURE__*/React.createElement("h2", {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: 'var(--text-h3)',
        color: 'var(--cream)',
        margin: 0
      }
    }, "B\u1EA3ng x\u1EBFp h\u1EA1ng")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gap: 10
      }
    }, rows.map(([rank, name, tier, xp], i) => /*#__PURE__*/React.createElement(Card, {
      key: i,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: 14
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 28,
        textAlign: 'center',
        fontWeight: 700,
        color: 'var(--cream)'
      }
    }, rank), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        fontWeight: 600,
        color: 'var(--cream)'
      }
    }, name), /*#__PURE__*/React.createElement(RankBadge, {
      tier: tier
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 700,
        color: 'var(--gold)',
        fontSize: 'var(--text-sm)',
        minWidth: 64,
        textAlign: 'right'
      }
    }, xp, " XP")))));
  }
  function App() {
    const [phase, setPhase] = React.useState('build'); // build | generating | result | leaderboard
    const [topic, setTopic] = React.useState(TOPICS[0]);
    const generate = t => {
      setTopic(t);
      setPhase('generating');
      setTimeout(() => setPhase('result'), 5200);
    };
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(AppHeader, {
      onLeaderboard: () => setPhase('leaderboard')
    }), /*#__PURE__*/React.createElement("main", {
      style: {
        maxWidth: phase === 'leaderboard' ? '40rem' : '36rem',
        margin: '0 auto',
        padding: '40px var(--gutter) 80px',
        width: '100%',
        boxSizing: 'border-box'
      }
    }, phase === 'build' && /*#__PURE__*/React.createElement(Builder, {
      onGenerate: generate
    }), phase === 'generating' && /*#__PURE__*/React.createElement(Generating, null), phase === 'result' && /*#__PURE__*/React.createElement(Result, {
      topic: topic,
      onReset: () => setPhase('build')
    }), phase === 'leaderboard' && /*#__PURE__*/React.createElement(Leaderboard, {
      onBack: () => setPhase('build')
    })));
  }
  Object.assign(window, {
    R2LApp: App
  });
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/read2lead/App.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Chrome.jsx
try { (() => {
/* Felix Coaching website UI kit — shared header & footer.
   Composes design-system primitives; exported to window for the other
   screen scripts. */

(() => {
  function SiteHeader({
    active = 'coaching',
    onNav
  }) {
    const links = [['coaching', 'Coaching'], ['hoc-sinh', 'Xem tiến độ con'], ['read2lead', 'Read2Lead'], ['msmw', 'MSMW'], ['contact', 'Liên hệ']];
    const [open, setOpen] = React.useState(false);
    return /*#__PURE__*/React.createElement("header", {
      style: {
        position: 'sticky',
        top: 0,
        zIndex: 50,
        borderBottom: '1px solid var(--border-subtle)',
        background: 'color-mix(in srgb, var(--navy-950) 85%, transparent)',
        backdropFilter: 'blur(8px)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: 'var(--container)',
        margin: '0 auto',
        padding: '16px var(--gutter)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16
      }
    }, /*#__PURE__*/React.createElement("a", {
      href: "#",
      onClick: e => {
        e.preventDefault();
        onNav && onNav('coaching');
      },
      style: {
        display: 'flex',
        alignItems: 'center'
      }
    }, /*#__PURE__*/React.createElement("img", {
      src: "../../assets/logo-header.png",
      alt: "Felix Coaching",
      style: {
        height: 38,
        width: 'auto',
        borderRadius: 6
      }
    })), /*#__PURE__*/React.createElement("nav", {
      style: {
        display: 'flex',
        gap: 22,
        alignItems: 'center'
      },
      className: "site-nav"
    }, links.map(([key, label]) => /*#__PURE__*/React.createElement("a", {
      key: key,
      href: "#",
      onClick: e => {
        e.preventDefault();
        onNav && onNav(key);
      },
      style: {
        fontSize: 'var(--text-sm)',
        fontWeight: 500,
        color: active === key ? 'var(--accent)' : 'var(--text-body)'
      }
    }, label))), /*#__PURE__*/React.createElement("button", {
      className: "site-burger",
      onClick: () => setOpen(o => !o),
      "aria-label": "Menu",
      style: {
        display: 'none',
        width: 40,
        height: 40,
        borderRadius: 6,
        border: '1px solid var(--border-default)',
        background: 'transparent',
        color: 'var(--cream)',
        cursor: 'pointer'
      }
    }, "\u2630")), open && /*#__PURE__*/React.createElement("div", {
      className: "site-mobile",
      style: {
        borderTop: '1px solid var(--border-subtle)',
        padding: '8px var(--gutter)'
      }
    }, links.map(([key, label]) => /*#__PURE__*/React.createElement("a", {
      key: key,
      href: "#",
      onClick: e => {
        e.preventDefault();
        setOpen(false);
        onNav && onNav(key);
      },
      style: {
        display: 'block',
        padding: '12px 0',
        color: 'var(--text-body)',
        fontWeight: 500
      }
    }, label))));
  }
  function SiteFooter() {
    return /*#__PURE__*/React.createElement("footer", {
      style: {
        marginTop: 'auto',
        borderTop: '1px solid var(--border-subtle)',
        padding: '32px var(--gutter)',
        textAlign: 'center',
        color: 'var(--cream-dim)'
      }
    }, /*#__PURE__*/React.createElement("p", {
      style: {
        fontSize: 'var(--text-sm)'
      }
    }, "\xA9 2026 Tong Phuong \u2014 Felix Coaching \xB7 built in Vietnam"), /*#__PURE__*/React.createElement("p", {
      style: {
        fontSize: 'var(--text-xs)',
        opacity: 0.7,
        marginTop: 4
      }
    }, "Coach hu\u1EA5n luy\u1EC7n k\u0129 n\u0103ng n\xF3i \xB7 s\u1EA3n ph\u1EA9m gi\xE1o d\u1EE5c t\u0103ng c\u01B0\u1EDDng b\u1EDFi AI"));
  }
  Object.assign(window, {
    SiteHeader,
    SiteFooter
  });
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Chrome.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Contact.jsx
try { (() => {
/* Felix Coaching website UI kit — booking / contact screen with a working
   (fake) form: fill it in, submit, see the success state. */

(() => {
  const {
    Button,
    Input,
    Select,
    Textarea,
    SectionHeading,
    Card
  } = window.FelixCoachingDesignSystem_05c199;
  function ContactScreen() {
    const [sent, setSent] = React.useState(false);
    return /*#__PURE__*/React.createElement("section", {
      style: {
        maxWidth: 'var(--container-sm)',
        margin: '0 auto',
        padding: '64px var(--gutter)'
      }
    }, /*#__PURE__*/React.createElement(SectionHeading, {
      align: "center",
      title: "\u0110\u1EB7t l\u1ECBch t\u01B0 v\u1EA5n mi\u1EC5n ph\xED",
      lead: "\u0110i\u1EC1n form, Felix s\u1EBD nh\u1EAFn Zalo trong 24h. Bu\u1ED5i t\u01B0 v\u1EA5n 30 ph\xFAt gi\xFAp Felix hi\u1EC3u con v\xE0 \u0111\u1EC1 xu\u1EA5t l\u1ED9 tr\xECnh ph\xF9 h\u1EE3p."
    }), sent ? /*#__PURE__*/React.createElement(Card, {
      variant: "accent",
      style: {
        marginTop: 32,
        textAlign: 'center',
        padding: 28,
        background: 'color-mix(in srgb, var(--gold) 10%, transparent)'
      }
    }, /*#__PURE__*/React.createElement("p", {
      style: {
        fontWeight: 700,
        color: 'var(--gold-light)',
        fontSize: 'var(--text-h5)'
      }
    }, "\u2713 \u0110\xE3 ghi nh\u1EADn l\u1ECBch t\u01B0 v\u1EA5n"), /*#__PURE__*/React.createElement("p", {
      style: {
        marginTop: 8,
        color: 'var(--cream-muted)'
      }
    }, "Felix s\u1EBD Zalo trong 24h \u0111\u1EC3 confirm slot."), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 20
      }
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      onClick: () => setSent(false)
    }, "G\u1EEDi form kh\xE1c"))) : /*#__PURE__*/React.createElement("form", {
      style: {
        marginTop: 32,
        display: 'grid',
        gap: 20
      },
      onSubmit: e => {
        e.preventDefault();
        setSent(true);
      }
    }, /*#__PURE__*/React.createElement(Input, {
      label: "T\xEAn ph\u1EE5 huynh",
      required: true,
      placeholder: "Nguy\u1EC5n V\u0103n A"
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 20
      }
    }, /*#__PURE__*/React.createElement(Input, {
      label: "T\xEAn con",
      required: true,
      placeholder: "B\xE9 Na"
    }), /*#__PURE__*/React.createElement(Input, {
      label: "Tu\u1ED5i con",
      type: "number",
      min: "5",
      max: "16",
      required: true,
      placeholder: "8"
    })), /*#__PURE__*/React.createElement(Select, {
      label: "Level ti\u1EBFng Anh hi\u1EC7n t\u1EA1i",
      required: true,
      defaultValue: ""
    }, /*#__PURE__*/React.createElement("option", {
      value: "",
      disabled: true
    }, "-- Ch\u1ECDn level --"), /*#__PURE__*/React.createElement("option", {
      value: "beginner"
    }, "M\u1EDBi b\u1EAFt \u0111\u1EA7u (ch\u01B0a giao ti\u1EBFp \u0111\u01B0\u1EE3c)"), /*#__PURE__*/React.createElement("option", {
      value: "basic"
    }, "C\u01A1 b\u1EA3n (n\xF3i \u0111\u01B0\u1EE3c c\xE2u \u0111\u01A1n)"), /*#__PURE__*/React.createElement("option", {
      value: "intermediate"
    }, "Trung b\xECnh (c\xF2n ng\u1EA1i)"), /*#__PURE__*/React.createElement("option", {
      value: "advanced"
    }, "Kh\xE1 (c\u1EA7n luy\u1EC7n chuy\xEAn s\xE2u)"), /*#__PURE__*/React.createElement("option", {
      value: "unsure"
    }, "Kh\xF4ng ch\u1EAFc \u2014 Felix \u0111\xE1nh gi\xE1 gi\xFAp")), /*#__PURE__*/React.createElement(Textarea, {
      label: "M\u1EE5c ti\xEAu c\u1EE7a ph\u1EE5 huynh",
      rows: 3,
      placeholder: "VD: Con t\u1EF1 tin n\xF3i tr\u01B0\u1EDBc l\u1EDBp, k\u1EC3 chuy\u1EC7n m\u1EA1ch l\u1EA1c\u2026"
    }), /*#__PURE__*/React.createElement(Input, {
      label: "S\u1ED1 Zalo",
      type: "tel",
      required: true,
      placeholder: "09xx xxx xxx"
    }), /*#__PURE__*/React.createElement(Button, {
      size: "lg",
      block: true,
      type: "submit"
    }, "\u0110\u1EB7t l\u1ECBch t\u01B0 v\u1EA5n \u2014 mi\u1EC5n ph\xED"), /*#__PURE__*/React.createElement("p", {
      style: {
        textAlign: 'center',
        fontSize: 'var(--text-xs)',
        color: 'var(--cream-dim)'
      }
    }, "Felix ch\u1EC9 d\xF9ng th\xF4ng tin \u0111\u1EC3 li\xEAn h\u1EC7 t\u01B0 v\u1EA5n. Kh\xF4ng spam.")));
  }
  Object.assign(window, {
    ContactScreen
  });
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Contact.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/Screens.jsx
try { (() => {
/* Felix Coaching website UI kit — page screens.
   Recreates the production homepage and coaching page using DS primitives. */

(() => {
  const {
    Button,
    Card,
    Badge,
    Avatar,
    SectionHeading,
    Faq
  } = window.FelixCoachingDesignSystem_05c199;
  const wrap = {
    maxWidth: 'var(--container)',
    margin: '0 auto',
    padding: '0 var(--gutter)'
  };
  function Hero({
    onNav
  }) {
    return /*#__PURE__*/React.createElement("section", {
      style: {
        ...wrap,
        padding: '80px var(--gutter)',
        textAlign: 'center'
      }
    }, /*#__PURE__*/React.createElement(Badge, {
      variant: "accent"
    }, "D\u1ECBch v\u1EE5 ch\xEDnh \xB7 Nh\xF3m nh\u1ECF t\u1ED1i \u0111a 4 b\xE9 \xB7 Online"), /*#__PURE__*/React.createElement("h1", {
      style: {
        margin: '24px auto 0',
        maxWidth: 880,
        fontFamily: 'var(--font-display)',
        fontWeight: 800,
        fontSize: 'var(--text-display-lg)',
        lineHeight: 1.3,
        color: 'var(--cream)'
      }
    }, "Hu\u1EA5n luy\u1EC7n k\u0129 n\u0103ng n\xF3i", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--accent)'
      }
    }, "r\xE8n t\u1EF1 tin cho con")), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '24px auto 0',
        maxWidth: 620,
        fontSize: 'var(--text-lg)',
        color: 'var(--cream-muted)',
        lineHeight: 1.625
      }
    }, "Felix d\xF9ng ti\u1EBFng Anh l\xE0m ph\u01B0\u01A1ng ti\u1EC7n \u2014 k\u1EC3 chuy\u1EC7n, thuy\u1EBFt tr\xECnh, tranh lu\u1EADn trong l\u1EDBp nh\xF3m t\u1ED1i \u0111a 4 b\xE9, online."), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 40,
        display: 'flex',
        gap: 16,
        justifyContent: 'center',
        flexWrap: 'wrap'
      }
    }, /*#__PURE__*/React.createElement(Button, {
      size: "lg",
      onClick: () => onNav('contact')
    }, "\u0110\u1EB7t l\u1ECBch t\u01B0 v\u1EA5n mi\u1EC5n ph\xED \u2192"), /*#__PURE__*/React.createElement(Button, {
      size: "lg",
      variant: "secondary",
      onClick: () => onNav('hoc-sinh')
    }, "Xem ti\u1EBFn \u0111\u1ED9 con")), /*#__PURE__*/React.createElement("p", {
      style: {
        marginTop: 24,
        fontSize: 'var(--text-sm)',
        color: 'var(--cream-dim)'
      }
    }, "H\u01A1n 10 n\u0103m coach hu\u1EA5n luy\u1EC7n k\u0129 n\u0103ng n\xF3i cho tr\u1EBB em Vi\u1EC7t"));
  }
  function About() {
    return /*#__PURE__*/React.createElement("section", {
      style: {
        background: 'var(--surface-section)',
        padding: '64px var(--gutter)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: '64rem',
        margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: 40,
        alignItems: 'center'
      },
      className: "about-grid"
    }, /*#__PURE__*/React.createElement(Avatar, {
      src: "../../assets/felix.jpg",
      alt: "Th\u1EA7y Ph\u01B0\u01A1ng",
      size: "xl"
    }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: 'var(--text-display-sm)',
        color: 'var(--cream)'
      }
    }, "Felix Coaching l\xE0 g\xEC?"), /*#__PURE__*/React.createElement("p", {
      style: {
        marginTop: 16,
        color: 'var(--cream-muted)',
        lineHeight: 1.625
      }
    }, "T\xF4i l\xE0 Ph\u01B0\u01A1ng \u2014 coach hu\u1EA5n luy\u1EC7n k\u0129 n\u0103ng n\xF3i, s\u1EED d\u1EE5ng ti\u1EBFng Anh l\xE0m ph\u01B0\u01A1ng ti\u1EC7n. T\xF4i r\xE8n ", /*#__PURE__*/React.createElement("strong", {
      style: {
        color: 'var(--cream)'
      }
    }, "t\u1EF1 tin n\xF3i th\u1EADt"), ": con d\xE1m m\u1EDF mi\u1EC7ng, k\u1EC3 chuy\u1EC7n c\xF3 c\u1EA5u tr\xFAc, thuy\u1EBFt tr\xECnh tr\u01B0\u1EDBc l\u1EDBp v\xE0 tranh lu\u1EADn c\xF3 l\xFD l\u1EBD."), /*#__PURE__*/React.createElement("p", {
      style: {
        marginTop: 12,
        color: 'var(--cream-muted)',
        lineHeight: 1.625
      }
    }, "Ngo\xE0i l\u1EDBp coaching, t\xF4i x\xE2y d\u1EF1ng ", /*#__PURE__*/React.createElement("strong", {
      style: {
        color: 'var(--cream)'
      }
    }, "Read2Lead"), " v\xE0 ", /*#__PURE__*/React.createElement("strong", {
      style: {
        color: 'var(--cream)'
      }
    }, "MSMW"), " \u2014 s\u1EA3n ph\u1EA9m gi\xE1o d\u1EE5c t\u0103ng c\u01B0\u1EDDng b\u1EDFi AI."))));
  }
  function Products({
    onNav
  }) {
    return /*#__PURE__*/React.createElement("section", {
      style: {
        ...wrap,
        padding: '80px var(--gutter)'
      }
    }, /*#__PURE__*/React.createElement(SectionHeading, {
      eyebrow: "B\u1ED5 tr\u1EE3 ngo\xE0i l\u1EDBp",
      title: "S\u1EA3n ph\u1EA9m gi\xE1o d\u1EE5c t\u0103ng c\u01B0\u1EDDng b\u1EDFi AI",
      lead: "Felix d\xF9ng AI \u0111\u1EC3 t\u1EA1o b\xE0i luy\u1EC7n \u0111\u1ECDc v\xE0 nghe c\xE1 nh\xE2n ho\xE1 \u2014 b\u1ED5 tr\u1EE3 bu\u1ED5i coaching, kh\xF4ng thay th\u1EBF l\u1EDBp tr\u1EF1c ti\u1EBFp."
    }), /*#__PURE__*/React.createElement(Card, {
      variant: "accent",
      style: {
        marginTop: 32,
        padding: 32
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 24,
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: 560
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        flexWrap: 'wrap'
      }
    }, /*#__PURE__*/React.createElement("h3", {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: 'var(--text-h3)',
        color: 'var(--cream)'
      }
    }, "Read2Lead"), /*#__PURE__*/React.createElement(Badge, {
      variant: "gold"
    }, "Th\u1EED nghi\u1EC7m \u2014 mi\u1EC5n ph\xED")), /*#__PURE__*/React.createElement("p", {
      style: {
        marginTop: 16,
        color: 'var(--cream-muted)',
        lineHeight: 1.625
      }
    }, "C\xF4ng c\u1EE5 luy\u1EC7n \u0111\u1ECDc v\xE0 nghe t\u0103ng c\u01B0\u1EDDng b\u1EDFi AI \u2014 con ch\u1ECDn ch\u1EE7 \u0111\u1EC1, l\xE0m nhi\u1EC7m v\u1EE5, t\xEDch \u0111i\u1EC3m v\xE0 leo c\u1EA5p.")), /*#__PURE__*/React.createElement(Button, {
      size: "lg",
      onClick: () => onNav('read2lead')
    }, "T\u1EA1o b\xE0i mi\u1EC5n ph\xED \u2192"))));
  }
  function MSMW() {
    return /*#__PURE__*/React.createElement("section", {
      style: {
        background: 'var(--surface-section)',
        padding: '80px var(--gutter)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: 'var(--container)',
        margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 40,
        alignItems: 'center'
      },
      className: "msmw-grid"
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
      className: "fx-eyebrow"
    }, "S\u1EA3n ph\u1EA9m ri\xEAng"), /*#__PURE__*/React.createElement("h2", {
      style: {
        marginTop: 8,
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: 'var(--text-display-sm)',
        color: 'var(--cream)'
      }
    }, "MSMW \u2014 My Story, My World"), /*#__PURE__*/React.createElement("p", {
      style: {
        marginTop: 16,
        color: 'var(--cream-muted)',
        lineHeight: 1.625
      }
    }, "S\xE1ch truy\u1EC7n song ng\u1EEF Vi\u1EC7t\u2013Anh v\u1EDBi ", /*#__PURE__*/React.createElement("strong", {
      style: {
        color: 'var(--cream)'
      }
    }, "ch\xEDnh con l\xE0 nh\xE2n v\u1EADt ch\xEDnh"), " \u2014 Felix d\xF9ng AI t\u1EA1o minh ho\u1EA1 ri\xEAng t\u1EEB \u1EA3nh th\u1EADt c\u1EE7a b\xE9."), /*#__PURE__*/React.createElement("p", {
      style: {
        marginTop: 12,
        fontSize: 'var(--text-sm)',
        color: 'var(--cream-dim)'
      }
    }, "B\u1EA3n s\u1ED1 t\u1EEB 69k \xB7 B\u1EA3n in t\u1EEB 129k \xB7 Giao to\xE0n qu\u1ED1c"), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 24
      }
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary"
    }, "Xem trang MSMW \u2192"))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 16
      }
    }, /*#__PURE__*/React.createElement("img", {
      src: "../../assets/msmw-toy-brick.jpg",
      alt: "B\xECa s\xE1ch MSMW",
      style: {
        borderRadius: 'var(--radius-xl)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-card)',
        width: '100%'
      }
    }), /*#__PURE__*/React.createElement("img", {
      src: "../../assets/msmw-heart-garden.jpg",
      alt: "B\xECa s\xE1ch MSMW",
      style: {
        marginTop: 32,
        borderRadius: 'var(--radius-xl)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-card)',
        width: '100%'
      }
    }))));
  }
  function Faqs() {
    const items = [['Lớp học có bao nhiêu bạn?', 'Nhóm nhỏ tối đa 4 học viên. Học online qua Zoom hoặc Google Meet — mỗi bạn có nhiều thời gian nói và Felix theo sát từng bạn.'], ['Bé chưa biết gì có học được không?', 'Có. Felix có lộ trình riêng cho beginner — bắt đầu bằng hội thoại đơn giản, không grammar khô khan.'], ['Felix có kinh nghiệm bao lâu?', 'Hơn 10 năm coach huấn luyện kĩ năng nói cho trẻ em, sử dụng tiếng Anh làm phương tiện.']];
    return /*#__PURE__*/React.createElement("section", {
      style: {
        maxWidth: 'var(--container-sm)',
        margin: '0 auto',
        padding: '80px var(--gutter)'
      }
    }, /*#__PURE__*/React.createElement(SectionHeading, {
      align: "center",
      title: "C\xE2u h\u1ECFi th\u01B0\u1EDDng g\u1EB7p"
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 32,
        display: 'grid',
        gap: 12
      }
    }, items.map(([q, a], i) => /*#__PURE__*/React.createElement(Faq, {
      key: i,
      question: q,
      open: i === 0
    }, a))));
  }
  function HomeScreen({
    onNav
  }) {
    return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Hero, {
      onNav: onNav
    }), /*#__PURE__*/React.createElement(About, null), /*#__PURE__*/React.createElement(Products, {
      onNav: onNav
    }), /*#__PURE__*/React.createElement(MSMW, null), /*#__PURE__*/React.createElement(Faqs, null));
  }
  Object.assign(window, {
    HomeScreen
  });
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/Screens.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Faq = __ds_scope.Faq;

__ds_ns.SectionHeading = __ds_scope.SectionHeading;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Textarea = __ds_scope.Textarea;

__ds_ns.ProgressBar = __ds_scope.ProgressBar;

__ds_ns.RankBadge = __ds_scope.RankBadge;

__ds_ns.TopicTile = __ds_scope.TopicTile;

})();
