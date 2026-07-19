# Aigloo Design System

Codifies the **existing** Aigloo dashboard visual system so future UI edits stay
consistent. This is a record, not a redesign — every token below is already in
`dashboard/src/app/globals.css` and every pattern is already in
`dashboard/src/components/*`.

## 1. Surfaces & Depth

Glassmorphic surfaces over a deep blue-black gradient. Depth comes from layered
shadows + subtle rings, not hard borders.

| Token | Value (dark) | Use |
|---|---|---|
| `--color-bg` | `#08090d` | Page background |
| `--color-bg-alt` | `#0c0d12` | Recessed strips (card footers, table head) |
| `--color-surface` | `#ffffff14` | Default glass surface |
| `--color-surface-2` | `#ffffff1f` | Stronger glass (modal, dropdown) |
| `--color-surface-3` | `#ffffff2d` | Hover / thumb fill |
| `--color-sidebar` | `#0a0b10` | Sidebar island |
| `--color-border` | `#ffffff20` | Default border |
| `--color-border-subtle` | `#ffffff12` | In-card dividers, dashed empty state |

A light theme overrides the same tokens under `html.light` — see `globals.css`.

### Surface classes (composition, not new styles)

- `.card` — surface + subtle border. Base for content cards.
- `.glass` — surface + 24px blur + border + hover lift. Interactive cards.
- `.glass-strong` — surface-2 + 32px blur + border. Modals, dropdowns.
- `.glass-premium` — surface + 28px blur + inner top glow. Hero / stat cards.
- `.modal-card` — near-opaque `rgba(12,13,18,0.94)` + 32px blur + elevated
  shadow + ring. Used inside `.glass-strong` for the picker/modal shell.

### Shadows

| Token | Use |
|---|---|
| `--shadow-soft` | Small lifts (brand isle) |
| `--shadow-card` | Default card (layered + inset top highlight) |
| `--shadow-lift` | Hover state (deeper + accent ring) |
| `--shadow-elevated` | Modals |
| `--shadow-glow` | Accent glow (buttons on hover) |
| `--shadow-warm` | Primary button rest state |

## 2. Color

| Token | Value (dark) | Use |
|---|---|---|
| `--color-accent` | `#cbe85a` (lime) | Primary action, focus ring, selection |
| `--color-accent-hover` | `#d6f06a` | Button hover |
| `--color-accent-ink` | `#08090d` | Text on accent fill |
| `--color-accent-soft` | `#cbe85a1f` | Selected chip background |
| `--color-accent-glow` | `#cbe85a55` | Glow shadows |
| `--color-text` | `#f5f5f7` | Primary text |
| `--color-text-muted` | `#9ea0a8` | Secondary text, labels |
| `--color-text-subtle` | `#6b6d77` | Tertiary text, placeholders |
| `--color-success` | `#5dd87f` | Live lamp, positive |
| `--color-warning` | `#e8c55a` | Reasoning capacity icon |
| `--color-danger` | `#e8806a` | Errors, destructive |
| `--color-info` | `#6fa8e8` | Vision capacity icon, info |

**Accent is bold**: glows, gradients, button fills — not just a thin outline.
Background uses radial gradients (lime + soft blue) over `--color-bg`, fixed
attachment, with a 6% noise overlay (`body::before`).

## 3. Typography

- Sans: `var(--font-inter)` → `-apple-system, BlinkMacSystemFont, "SF Pro Text",
  system-ui, sans-serif`.
- Mono: `var(--font-jetbrains-mono)` → `ui-monospace, "SF Mono", Menlo`,
  monospace. Applied via `.tnum` for tabular numbers and code-like model ids.

### Type scale (used everywhere, do not invent new sizes)

| Class | Size | Weight / treatment | Use |
|---|---|---|---|
| `text-[14px] font-semibold` | 14 | semibold | Modal title, card title |
| `text-[13px]` | 13 | normal | Body, inputs, buttons |
| `text-[12px]` | 12 | normal | Notes, errors, footer count |
| `text-[11px] font-semibold uppercase tracking-wider` | 11 | semibold caps | Group labels, field labels |
| `text-[11px]` | 11 | normal | Tags, capacity meta |

Headings may use `.heading-gradient` (white→muted gradient text) and
`.heading-accent` (3px lime→transparent underline).

## 4. Spacing & Layout

- 4px base grid via Tailwind utilities (`gap-1.5`, `gap-2`, `gap-3`, `gap-4`).
- Modal shell: `max-w-lg`, `max-h-[80vh]`, `p-6 sm:p-10` outer, inner `px-4
  py-3` header/footer, `px-4 py-3` body.
- App shell: fixed 76px sidebar island at `left:32px`; topbar 64px with
  `padding-left:108px`; content `2.5rem 2.5rem 4rem` with `margin-left:108px`.
- Breakpoint: `max-width:760px` collapses sidebar to off-canvas and drops
  `margin-left` on content.

## 5. Radii

| Token | Value | Use |
|---|---|---|
| `--radius-brand` | `12px` | Buttons, inputs, chips, selects |
| `--radius-brand-lg` | `16px` | Cards, modal shell |
| `--radius-brand-xl` | `20px` | (reserved for large surfaces) |

## 6. Components & Patterns

### Buttons (`Button.tsx`)

- Primary: `bg-accent text-accent-ink shadow-warm hover:bg-accent-hover
  hover:shadow-glow`, `rounded-brand px-3.5 py-2 text-[13px] font-semibold`.
- Ghost: `.glass` + transparent border + `hover:text-text`.
- Danger: `.glass` + `hover:text-danger`.
- Disabled: `opacity-45 cursor-not-allowed`.

### Inputs / Selects (`Button.tsx`)

- Input: `rounded-brand border border-border bg-bg px-3 py-2 text-[13px]
  text-text placeholder:text-text-subtle focus:border-accent focus:outline-none`.
- Select: custom dropdown — same shell as input, opens a `.glass-strong
  .modal-card` list; selected option gets `bg-accent/10 text-accent`.
- Field: `<label>` wrapper with `text-[11px] font-medium uppercase
  tracking-wider text-text-subtle` label + optional `· hint`.

### Chips (model picker items)

- Rest: `rounded-brand border border-border bg-bg text-text-muted
  hover:border-text-subtle hover:text-text`.
- Selected: `border-accent bg-accent-soft text-accent` + leading check icon.
- `inline-flex items-center gap-1 px-2 py-1 text-[12px]`.

### CapacityBadges

Material Symbols icons sized 13–15px, only `vision` (info) and `reasoning`
(warning) render. Inline after the label, `flex-none`.

### Icon

`<span class="material-symbols-outlined">` with `font-size` set via `style`.
`aria-hidden` — never carries meaning alone.

### Lamp

8px dot, `rounded-full`. `.lamp-live` (success + glow), `.lamp-idle` (subtle),
`.lamp-down` (danger + glow).

## 7. Interaction & Accessibility States

- Focus visible: `outline: 2px solid var(--color-accent); outline-offset: 2px;
  border-radius: 6px` — applied to `a, button, input, textarea, select` via
  `:focus-visible` in `globals.css`. **New controls inherit this; do not
  override.**
- Cursor: `button:not(:disabled)` and `[role="button"]` get `cursor: pointer`;
  disabled gets `cursor: not-allowed`.
- Selection: `::selection` is accent at 30% alpha.
- Hover transitions: `transition-colors` (chips, inputs) or `transition-all
  duration-150` (buttons). Cards use `transition: box-shadow .25s, border-color
  .25s, transform .25s`.
- Scrollbar: 8px thumb in `--color-surface-3`, 4px thin variant for horizontal
  scroll areas (`.scrollbar-thin`).
- Dark `select option` backgrounds: `#121319` (dark) / `#fff` (light) — set in
  `globals.css` so native option lists match the theme.

## 8. Motion

Restrained. Only three keyframes are defined and used:

- `fadeInUp` — content area entrance (`.35s ease`).
- `slideIn` — toasts.
- `shake` / `flash` — lamp feedback.

No decorative micro-animations. Hover and focus transitions are color/shadow
only (`transition-colors`, `transition-all duration-150`). GPU-composited
properties only when motion is added.

## 9. Icons

Material Symbols Outlined (`material-symbols-outlined`), `FILL 0, wght 400,
GRAD 0, opsz 24`, `font-size: 20px` default. Name = ligature string passed to
`<Icon name="…" />`. No emoji icons.

## 10. Accepted Debt

- No formal token layer for motion durations; durations are inline
  (`duration-150`, `.25s`). Keep new motion in this vocabulary.
- `.modal-card` and `.glass-strong` overlap on purpose for modal shells —
  do not collapse them.
- Light theme is a token override, not a separate system. New surfaces must
  work under both.
