# design.md: "Moss & Signal"

The visual system for the landing page and the app (chat + network map).
Working name in examples: **NetPrep**. Swap in the final name everywhere.

---

## 1. The idea in one line

**A dark forest at night, with your network lit up like signal running through it.**

Organic (moss, depth, soft light) meets instrument (hairlines, mono labels, dot-matrix data). The product turns a vague goal into a living map of people, so the design should feel calm, precise and alive, never loud.

### Principles
1. **Darkness is the canvas.** Near-black surfaces; light comes from glows and content, not from big colored panels.
2. **One signal color.** Lime is the only saturated color. It marks the thing to click, the active node, the live connection. If everything glows, nothing does.
3. **Hairlines, not boxes.** Structure is drawn with 1px low-opacity lines. Fills are rare.
4. **Light type, big size.** Headlines are large and light-weight (300). Weight is never how we create hierarchy at display sizes; size and space are.
5. **Labels are instruments.** Small uppercase mono labels (`FIG. 01`, `BRANCH`, `03 CONNECTIONS`) give the "research tool" feel.
6. **Connections are dotted light.** Anything that links two things is a dotted, softly glowing line. This is the product's signature motif.

---

## 2. What we take from each reference

| Reference | Keep | Leave behind |
|---|---|---|
| **Eidetic** (black + olive glow, outline cards, tick gauges) | Olive radial glows bleeding from corners; outline cards with a small dot-in-circle mark top-right; huge light headlines with a tiny side caption; radial tick-gauge for stats; staggered card heights; the `●──→` arrow CTA | Repeating the nav in every section |
| **Prime Intellect** (forest photo, mono UI, data panels) | Mono for UI labels and buttons; `FIG. 1` section tags; hairline grid cells; dot-matrix wave field as a background; small rectangular white button with `›`; data panels with numbers right-aligned | Dense logo walls (we don't have logos yet) |
| **Verdant** (glass cards, lime accent, pill nav) | Floating glass pill nav; lime gradient pill CTA with glow; one italic serif accent word in the headline; "New" announcement pill; glass feature cards with an icon tile; dotted glowing lines converging on a node (this is our network motif) | Stock "Trusted by" logos; full-bleed glass everywhere |

---

## 3. Design tokens

Copy into `:root`. Every color, size and duration in the UI comes from here.

```css
:root {
  /* ---- Surfaces (darkest → lightest) ---- */
  --bg-0: #070806;          /* page */
  --bg-1: #0e100c;          /* sections, chat column */
  --bg-2: #151811;          /* cards, inputs */
  --bg-3: #1d2117;          /* hover / raised */

  /* ---- Glass ---- */
  --glass: rgba(22, 26, 18, 0.55);
  --glass-strong: rgba(26, 31, 21, 0.78);
  --glass-blur: 18px;

  /* ---- Lines ---- */
  --line: rgba(230, 240, 210, 0.10);       /* default hairline */
  --line-strong: rgba(230, 240, 210, 0.22); /* card outline, hover */
  --line-signal: rgba(200, 241, 105, 0.55);

  /* ---- Text ---- */
  --text-1: #eef0e6;        /* primary: 17:1 on bg-0 */
  --text-2: #a9ad9d;        /* secondary: 8.7:1 */
  --text-3: #7f8373;        /* labels, meta: ≥4.5:1 on bg-0/bg-1 */

  /* ---- Moss (atmosphere, never text) ---- */
  --moss-glow: #4a5a22;     /* radial glows */
  --moss-deep: #222a13;
  --moss-mid: #5f7a2c;      /* dotted lines at rest, chart fills */

  /* ---- Signal (the one accent) ---- */
  --signal: #c8f169;        /* lime: CTAs, active node, live state */
  --signal-soft: #e6f7b0;   /* gradient top, highlights */
  --signal-dim: #8fae4f;    /* lime text on dark when full lime is too loud */
  --on-signal: #0b0d07;     /* text on lime: 15:1 */

  /* ---- Data ---- */
  --up: #a6e07a;
  --down: #e8735a;

  /* ---- Type ---- */
  --font-display: 'Manrope', system-ui, sans-serif;     /* 200–500 */
  --font-accent: 'Instrument Serif', Georgia, serif;    /* italic only */
  --font-mono: 'Geist Mono', ui-monospace, monospace;   /* labels, buttons, data */

  /* ---- Radius ---- */
  --r-xs: 4px;   /* mono buttons, tags */
  --r-sm: 8px;   /* inputs, small tiles */
  --r-md: 14px;  /* outline cards */
  --r-lg: 22px;  /* glass cards, panels */
  --r-pill: 999px;

  /* ---- Glow ---- */
  --glow-signal: 0 0 0 1px rgba(200,241,105,.35), 0 8px 32px -6px rgba(200,241,105,.45);
  --glow-node: 0 0 18px rgba(200,241,105,.55);
  --shadow-panel: 0 30px 80px -30px rgba(0,0,0,.8);

  /* ---- Motion ---- */
  --ease-out: cubic-bezier(.2, .8, .2, 1);
  --ease-in-out: cubic-bezier(.65, 0, .35, 1);
  --t-fast: 160ms;
  --t-base: 320ms;
  --t-slow: 700ms;
}
```

Google Fonts:
```html
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@200;300;400;500&family=Instrument+Serif:ital@1&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
```

---

## 4. Typography

| Role | Font | Size (desktop / mobile) | Weight | Tracking | Line height |
|---|---|---|---|---|---|
| Display (hero) | Manrope | 88 / 48px | 300 | -0.035em | 0.98 |
| H1 section | Manrope | 56 / 36px | 300 | -0.03em | 1.02 |
| H2 | Manrope | 32 / 26px | 400 | -0.02em | 1.1 |
| H3 / card title | Manrope | 18px | 500 | -0.01em | 1.3 |
| Stat number | Manrope | 44 / 34px | 300 | -0.03em | 1 |
| Body | Manrope | 16px | 400 | 0 | 1.6 |
| Small body | Manrope | 14px | 400 | 0 | 1.55 |
| Accent word | Instrument Serif *italic* | same size as surrounding headline, ×1.05 | 400 | -0.01em | inherit |
| Label / tag | Geist Mono | 11px | 500 | 0.12em, UPPERCASE | 1 |
| Button | Geist Mono | 12px | 500 | 0.06em, UPPERCASE | 1 |
| Data / numbers in panels | Geist Mono | 13px | 400 | 0 | 1.4, `font-variant-numeric: tabular-nums` |

Rules
- **One italic accent word per headline, max**, colored `--signal`: "Meet the right people. *Rehearse* the first hello."
- Headline + **side caption** pattern (from Eidetic): a 13px `--text-2` caption sits to the right of the first line of a big headline, baseline-aligned. Use on section openers only.
- Body text max width: 60ch. Captions under stats: 28ch, centered.
- Never bold a display headline. Never use mono for paragraphs.

---

## 5. Atmosphere & backgrounds

Layer these, back to front. They're what make it feel like the references instead of "dark mode".

1. **Base**: `--bg-0`.
2. **Moss glows**: 1–2 large radial gradients per section, offset into a corner, never centered behind text.
   ```css
   background:
     radial-gradient(60% 50% at 0% 40%, rgba(74,90,34,.38), transparent 70%),
     radial-gradient(40% 35% at 85% 100%, rgba(74,90,34,.22), transparent 70%),
     var(--bg-0);
   ```
3. **Dot-matrix field** (Prime Intellect): a grid of 1.5px dots in `--line` that swells into a wave. Use on the hero edge and behind the map. Build in `<canvas>` (animated, slow) or as a static SVG pattern.
4. **Grain**: SVG noise overlay at 4–6% opacity, `mix-blend-mode: overlay`, fixed, `pointer-events: none`.
5. **Imagery**: macro moss / forest-at-night with a particle mesh flowing over it. Rules:
   - Dark, low-key, green-black. Highlights only where light hits wet moss.
   - Always masked into the page with a gradient edge, never a hard rectangle (except the one full-width banner strip, which gets `--r-lg` corners).
   - **Use images you own or generate.** Don't reuse the reference shots. Until there's real art, the dot-matrix canvas carries the visual load alone.

---

## 6. Components

### 6.1 Nav (floating glass pill)
- Fixed, 16px from top, centered, max-width 1080px, height 56px, `--r-pill`.
- `background: var(--glass); backdrop-filter: blur(var(--glass-blur)) saturate(140%); border: 1px solid var(--line);`
- Left: logo mark + wordmark (Manrope 500, 15px, tracking 0.04em, uppercase optional).
- Center: links in Manrope 14px `--text-2`; active link `--text-1` with a 4px `--signal` dot below.
- Right: ghost `Log in` pill + primary `Get started →` pill (small size).
- On scroll >40px: `--glass-strong`.

### 6.2 Buttons
| Variant | Use | Spec |
|---|---|---|
| **Primary pill** | One per view: the main action | `linear-gradient(180deg, var(--signal-soft), var(--signal))`, text `--on-signal` Manrope 500 15px, height 48px, padding 0 24px, `--r-pill`, `box-shadow: var(--glow-signal)`. Hover: glow spreads 20%, translateY(-1px). Trailing `→` slides 3px on hover. |
| **Ghost pill** | Secondary | transparent, `1px solid var(--line-strong)`, text `--text-1`. Hover: `--bg-3`. |
| **Mono button** | Tool-ish actions (Prime Intellect) | Geist Mono 12px uppercase, height 32px, `--r-xs`. Light: bg `--text-1`, text `--bg-0`. Dark: bg `--bg-3`, text `--text-2`. Suffix `›`. |
| **Dot-arrow** | Quiet "continue" link under headlines | 22px circle outline with a 6px filled dot inside, followed by a 48px hairline and a chevron. On hover the line extends to 72px. |

### 6.3 Announcement pill
`● New  NetPrep can now rehearse coffee chats  ›`, 32px tall, glass, 13px. The leading dot and "New" are `--signal`.

### 6.4 Outline card (Eidetic)
- `background: linear-gradient(180deg, rgba(255,255,255,.025), transparent); border: 1px solid var(--line-strong); border-radius: var(--r-md); padding: 24px;`
- Top-right **ring mark**: 18px circle, 1px `--line-strong`, with a 6px `--text-1` dot. When active, the dot turns `--signal` and glows.
- Content: big stat or index (`01`) top-left; body copy anchored to the **bottom** of the card.
- In a row, stagger heights (e.g. 100% / 80% / 60%) aligned to the bottom edge for the descending-steps look.

### 6.5 Glass feature card (Verdant)
- `background: var(--glass); backdrop-filter: blur(14px); border: 1px solid var(--line); border-radius: var(--r-lg); padding: 28px;`
- Inner top highlight: `box-shadow: inset 0 1px 0 rgba(255,255,255,.06);`
- Header: 40px icon tile (`--r-sm`, `1px solid var(--line-signal)`, lime icon stroke 1.5px) + title (H3).
- Body: 14px `--text-2`.
- Bottom half holds a **live mini-visual**: the dotted-lines-into-node diagram, a sparkline, or concentric rings.

### 6.6 Stat gauge (Eidetic)
- 60 radial ticks around a circle (tick 10px long, 1px, `--line-strong`).
- The "filled" arc gets a 3px dot at each tick end in `--signal-soft`, with the last dot glowing.
- Center: stat number in Manrope 300 with a small `%` at 0.5em.
- Caption below, 13px `--text-2`, centered, 2 lines.
- Animate: ticks fill clockwise over `--t-slow` when scrolled into view.

### 6.7 Section tag (Prime Intellect)
`FIG. 02 — THE MAP` in Geist Mono 11px `--text-3`, top-left of a hairline-bordered panel, 16px inset. Use to number landing sections.

### 6.8 Data panel
Hairline-bordered panel, rows separated by `--line`. Label left (mono, `--text-3`), value right (mono, `--text-1`, tabular). Positive values `--up`, negative `--down`. Used for the "connection detail" stats in the app (e.g., `SHARED TIES 2`, `REPLY LIKELIHOOD HIGH`).

### 6.9 Inputs & chat composer
- Field: `--bg-2`, `1px solid var(--line)`, `--r-lg` for the composer (`--r-sm` for normal inputs), 16px text, placeholder `--text-3`.
- Focus: border `--line-signal` + `0 0 0 4px rgba(200,241,105,.08)`.
- Send button: 40px lime circle with a `→` in `--on-signal`; disabled = `--bg-3` with `--text-3` arrow.

### 6.10 Chat messages
- **User**: right-aligned, `--bg-3` fill, `1px solid var(--line)`, `--r-lg` with a 6px bottom-right corner, `--text-1`.
- **Assistant**: no bubble. Left-aligned text on the background, preceded by a 6px `--signal` dot. Meta line below in mono 11px `--signal-dim` (`4 BRANCHES · 9 CONNECTIONS`).
- **Thinking**: a row of 3 dots pulsing in sequence, plus a mono label `MAPPING YOUR NETWORK`.
- **Error**: `1px solid rgba(232,115,90,.4)` left border, text `--down`.

### 6.11 Network map (the hero of the app)
This is where the Verdant "dotted lines converge on a node" motif becomes the product.

| Element | Spec |
|---|---|
| Canvas | `--bg-0` with moss glow behind the root and the dot-matrix field at 50% opacity. Pan/zoom. |
| **Root (goal)** | 14px lime dot with `--glow-node`, plus 2 concentric rings (r 26px and 44px, 1px `--line-signal` at 40% / 20%) that breathe slowly (scale 1→1.06, 4s). Goal text in Manrope 300 24px to its left. |
| **Branch** | 64px-wide glass pill: mono label uppercase 11px `--text-1`, leading 6px lime dot. Count badge `03` in `--text-3`. |
| **Connection card** | Outline card (6.4) at 240×56px: title Manrope 500 13px, org mono 11px `--text-3`, ring mark top-right. Hover: border `--line-strong` → `--line-signal`, ring dot turns lime. Selected: lime ring dot + `--glow-signal` at 50%. |
| **Links** | Dotted curves (`stroke-dasharray: 1 6; stroke-linecap: round; stroke-width: 1.5`) in `--moss-mid`. Root→branch links are `--signal-dim`. On hover/selection the path to the root turns `--signal` and a small particle travels along it (`offset-path` or animated dashoffset). |
| **Grow animation** | Root rings appear → links draw in level by level (dashoffset, `--t-slow`, `--ease-out`) → nodes fade up 6px, stagger 60ms. |

### 6.12 Detail panel (connection)
- Right-side sheet, 400px, `--glass-strong` + blur, left border `--line`, `--shadow-panel`. Slides in over `--t-base`.
- Top: section tag (`ALUMNI AT TARGET COMPANIES`), title in Manrope 300 32px, org in mono.
- "Why" paragraph in `--text-2`.
- **Talking points**: numbered list; numbers `01 02 03` in mono `--signal-dim`, rows split by `--line`.
- Data panel (6.8) for shared ties etc.
- Actions: primary pill **Practice coffee chat**; ghost pill **Find on LinkedIn ↗**.

### 6.13 Icons
1.5px stroke, rounded caps, 20px grid (Lucide-style). Default `--text-2`; in icon tiles and active states, `--signal`.

---

## 7. Landing page

Max content width 1200px, 24px gutters (16px on mobile). Sections separated by 160px (96px mobile). Each section has one moss glow.

1. **Nav**: glass pill (6.1).
2. **Hero** (100vh, centered)
   - Announcement pill (6.3).
   - Display headline, 2 lines: **"Meet the right people.** / ***Rehearse*** **the first hello."** (accent word lime italic serif).
   - Subhead 18px `--text-2`, max 46ch: "Tell NetPrep your goal. It maps the people worth meeting, writes your talking points, and lets you practice the coffee chat before it's real."
   - Primary pill `Map my network →` + ghost pill `See how it works`.
   - Check row in 13px `--text-3`: `✓ Free while in beta  ✓ No LinkedIn login  ✓ Built for students`.
   - Behind: a live, slowly rotating mini network map (root + 3 branches + dotted links) over the dot-matrix wave, masked into the bottom edge.
3. **How it works**: 3 glass cards (6.5), `FIG. 01–03`:
   - *Describe your goal* → mini visual: chat bubble typing.
   - *Get your map* → dotted lines converging on a lime node.
   - *Practice the chat* → concentric rings with a pulsing voice dot.
4. **The map, up close**: full-width product screenshot of the app in a `--r-lg` frame with a hairline border and moss glow underneath. Side caption pattern: "Every branch is a reason to reach out."
5. **Proof**: 2 stat gauges (6.6) + 3 staggered outline cards (6.4).
   > ⚠️ Use only real numbers (beta results, survey data). Until then, use outcome statements instead of stats ("Talking points written for *you*, not a template"). Never ship invented metrics.
6. **Coffee-chat preview**: split layout, left = headline "Practice with their *double*." + body; right = a glass chat transcript with the agent, with a mono `PRACTICE MODE` tag.
7. **Closing CTA**: big headline, primary pill, the moss/particle banner strip (`--r-lg`) underneath.
8. **Footer**: hairline top border, mono 11px links, `© 2026 NetPrep`.

No logo wall until real partners or schools have agreed to be shown.

---

## 8. App screen (chat + map)

```
┌──────────────── glass top bar (56px): logo · goal title (mono) · Fit · New map · avatar ───────────────┐
│ ┌── chat 400px ──┐ ┌──────────────── map canvas ──────────────────────────────┐ ┌── detail 400px ──┐ │
│ │ bg-1, hairline │ │ dot field + moss glow behind root                        │ │ glass sheet,     │ │
│ │ right border   │ │ root ◉ ── branches (glass pills) ── connection cards     │ │ slides over map  │ │
│ │ messages       │ │                                                          │ │                  │ │
│ │ composer       │ │                                  FIG. MAP · 4 · 9  (mono)│ │                  │ │
│ └────────────────┘ └──────────────────────────────────────────────────────────┘ └──────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
- Empty state: centered root rings breathing alone, with the Instrument Serif italic line *"Your network grows here."* in `--text-3`, and 3 example prompts as ghost pills in the chat.
- Mobile (<760px): chat on top, map below at 70vh, detail panel becomes a bottom sheet (`--r-lg` top corners, drag handle).

---

## 9. Motion

- **Page load (landing)**: nav fades down (0ms) → pill (120ms) → headline lines rise 12px + fade (200ms, 300ms) → subhead (420ms) → CTAs (520ms) → background map starts growing (600ms). Duration `--t-slow`, `--ease-out`.
- **Scroll reveals**: cards rise 16px + fade, stagger 80ms, triggered at 15% visibility. Once only.
- **Ambient**: dot-matrix wave drifts (≈20s loop); root rings breathe (4s); glows don't move.
- **Hover**: `--t-fast`. Lift ≤2px. Never scale cards.
- Respect `prefers-reduced-motion`: disable ambient loops and draw-in; show final states instantly.

---

## 10. Accessibility

- Body text is `--text-1` or `--text-2` only (≥7.8:1). `--text-3` is for labels and meta (≥4.5:1 on `--bg-0`/`--bg-1`); avoid it on `--bg-3`.
- Lime is never the *only* signal: active nodes also get a ring/border change; up/down values carry `+`/`−`.
- Glass panels must sit on a dark enough backdrop for text to pass; add `--glass-strong` if content behind is busy.
- Focus ring everywhere: `outline: 2px solid var(--signal); outline-offset: 3px;`.
- Map nodes are keyboard-focusable (Tab through branches → connections; Enter opens detail; Esc closes).
- Hit targets ≥40px on touch.

---

## 11. Do / Don't

| Do | Don't |
|---|---|
| Let large areas stay dark and empty | Fill sections with solid green or gradients edge-to-edge |
| Use lime for one primary action per view | Make headings, icons and borders all lime |
| Draw structure with 1px hairlines | Use heavy borders or drop shadows on cards |
| Keep headlines light (300) and big | Bold display text |
| Use mono for labels, numbers and small buttons | Use mono for paragraphs |
| Use dotted glowing lines for every connection | Use solid arrows or straight connector lines |
| Mask imagery softly into the dark | Drop in hard-edged rectangular photos |
| Use real data, or none | Fake stats, fake logos, fake testimonials |

---

## 12. Applying it to the current prototype

Prototype files: `public/index.html`, `public/styles.css`, `public/app.js`.
1. Replace the Google Fonts link (section 3) and the `:root` block in `styles.css` with these tokens; remove the paper/vermilion palette.
2. Restyle `.chat`, `.msg`, `.composer` per 6.9–6.10.
3. In `app.js` `renderMap()`: switch links to dotted (`stroke-dasharray: 1 6`), add the root rings, render branches as glass pills and connections as outline cards with the ring mark (6.11).
4. Restyle `.detail` per 6.12 and promote **Practice coffee chat** to the primary pill.
5. Build the landing page as a new `public/landing.html` that shares `styles.css` tokens; serve the app at `/app`.
