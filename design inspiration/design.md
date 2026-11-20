# design.md: "Sky & Signal"

The visual system for the landing page, the sign-in pages and the app (chat + network map).
Product name: **NetPrep**.

---

## 1. The idea in one line

**Clear sky, white paper, one confident blue: a calm place to plan who to meet.**

Blue and white is the palette people already trust with their money, their health and their calendar. NetPrep asks students to share goals and reach out to strangers, so the design should feel open, steady and precise, never loud or mysterious. Atmosphere comes from the sky (a soft radial blue gradient) and from living detail (moss that grows under the cursor, dotted connections). Everything else is clean white surfaces, navy ink and hairlines.

### Principles
1. **Sky for moments, paper for work.** The sky gradient is reserved for entry points: the landing hero, sign-in / sign-up and the closing banner. Working surfaces (the app, the landing sections) are white and near-white with navy text.
2. **One signal color.** Signal blue (`--signal`) is the only saturated UI color. It marks the thing to click, the active node, the live connection. If everything is blue, nothing is.
3. **Hairlines and soft lift, not boxes and glows.** Structure is drawn with 1px navy lines at 10–18% opacity. Cards lift with a soft navy shadow (`--shadow-card`), never a colored glow.
4. **Big, light-feeling type.** Display headlines are Instrument Sans 400 with tight tracking (−0.04 to −0.06em). Size and space create hierarchy, not weight.
5. **One italic serif accent per headline.** Instrument Serif italic, in signal blue on white, in white on the sky.
6. **Labels are instruments.** Small uppercase mono labels (`FIG. 01`, `BRANCH`, `03 CONNECTIONS`) keep the "research tool" feel.
7. **Connections are dotted.** Anything that links two things is a dotted line (`stroke-dasharray: 1 6`). This is the product's signature motif.

---

## 2. What changed from "Moss & Signal"

| Was | Now | Why |
|---|---|---|
| Near-black surfaces | White / `#F4F7FB` surfaces, sky gradient for entry points | Light, open surfaces read as trustworthy and legible |
| Lime signal with glows | Signal blue `#1D64C8` with soft navy shadows | Blue carries trust; glows read as "gaming" on light |
| Moss-olive radial glows | Sky-blue haze (`--haze`) | Same depth, on-palette |
| Manrope 300 | Instrument Sans 400–600 | Matches the hero; Instrument Sans has no 300, tighter tracking does the job |
| Grain overlay | Removed | Grain dirties white surfaces |
| Moss imagery everywhere | The moss lives only on the hero's log, as the interaction reward | Nature as a moment, not a theme |

---

## 3. Design tokens

`public/tokens.css` is the source of truth. Every color, size and duration in the UI comes from there.

```css
:root {
  /* Sky (hero gradient and atmosphere; white text sits on these) */
  --sky-0: #C8E6FF;   /* gradient centre (bottom middle) */
  --sky-1: #A3CAE6;
  --sky-2: #7EADCD;
  --sky-3: #5799CF;
  --sky-4: #3085D2;   /* gradient edge (top corners) */

  /* Surfaces */
  --bg-0: #F4F7FB;    /* page */
  --bg-1: #FFFFFF;    /* panels, cards, chat column */
  --bg-2: #F8FAFD;    /* quiet fills */
  --bg-3: #E9EFF7;    /* hover / pressed */

  /* Glass */
  --glass: rgba(255,255,255,.68);        /* frost on light */
  --glass-strong: rgba(255,255,255,.9);
  --glass-sky: rgba(255,255,255,.06);    /* hero pills on the sky */
  --glass-sky-strong: rgba(255,255,255,.15);
  --glass-edge: rgba(255,255,255,.75);   /* 1px gradient border, bright ends */
  --glass-edge-soft: rgba(255,255,255,.12);

  /* Lines */
  --line: rgba(14,40,80,.10);
  --line-strong: rgba(14,40,80,.18);
  --line-signal: rgba(29,100,200,.45);

  /* Text */
  --text-1: #0E1E33;  /* navy ink, 15.6:1 on bg-0 */
  --text-2: #3F5068;  /* 7.6:1 */
  --text-3: #5C6B80;  /* labels and meta, 5.0:1 */
  --on-sky: #FFFFFF;

  /* Atmosphere (never text) */
  --haze: rgba(48,133,210,.14);
  --haze-deep: rgba(48,133,210,.24);
  --link-rest: #9DB9DA;  /* dotted links at rest */

  /* Signal */
  --signal: #1D64C8;       /* 5.3:1 on bg-0; white on it is 5.7:1 */
  --signal-soft: #4A8FE3;  /* gradient top */
  --signal-dim: #2B5C99;   /* blue text when full signal is too loud */
  --signal-tint: rgba(29,100,200,.08);  /* focus rings, active fills */
  --on-signal: #FFFFFF;

  /* Data */
  --up: #1C7C54;
  --down: #C2412D;

  /* Type */
  --font-display: 'Instrument Sans', system-ui, sans-serif;
  --font-accent: 'Instrument Serif', Georgia, serif;   /* italic only */
  --font-mono: 'Geist Mono', ui-monospace, monospace;

  /* Radius */
  --r-xs: 4px; --r-sm: 8px; --r-md: 14px; --r-lg: 22px; --r-pill: 999px;

  /* Elevation */
  --glow-signal: inset 0 1px 0 rgba(255,255,255,.25), 0 8px 24px -8px rgba(29,100,200,.55);
  --glow-node: 0 0 0 4px rgba(29,100,200,.14);
  --shadow-card: 0 1px 2px rgba(14,40,80,.05), 0 12px 32px -16px rgba(14,40,80,.18);
  --shadow-panel: 0 24px 64px -24px rgba(14,40,80,.28);

  /* Motion */
  --ease-out: cubic-bezier(.2,.8,.2,1);
  --ease-soft: cubic-bezier(.22,1,.36,1);   /* hero hovers */
  --ease-in-out: cubic-bezier(.65,0,.35,1);
  --t-fast: 160ms; --t-base: 320ms; --t-slow: 700ms;
}
```

Google Fonts (every page):
```html
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=Instrument+Serif:ital@1&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
```

---

## 4. Typography

| Role | Font | Size (desktop / mobile) | Weight | Tracking | Line height |
|---|---|---|---|---|---|
| Hero display, serif line | Instrument Serif *italic* | 184 / 79.3 design px | 400 | −0.06em | 1, trimmed |
| Hero display, sans line | Instrument Sans | 170 / 73.2 design px | 400 | −0.06em | 1, trimmed |
| H1 section | Instrument Sans | 60 / 38px (clamp) | 400 | −0.045em | 1.02 |
| Page title (app) | Instrument Sans | 56 / 36px | 400 | −0.04em | 1.02 |
| H2 | Instrument Sans | 32 / 26px | 400 | −0.035em | 1.1 |
| H3 / card title | Instrument Sans | 18px | 500 | −0.02em | 1.3 |
| Body | Instrument Sans | 16px | 400 | 0 | 1.6 |
| Hero body | Instrument Sans | 20 / 16 design px | 500 | −0.02em | 22 / 20 |
| Accent word | Instrument Serif *italic* | ×1.08 of surrounding | 400 | −0.02em | inherit |
| Label / tag | Geist Mono | 11px | 500 | 0.12em, UPPERCASE | 1 |
| Button | Instrument Sans | 15px (14 small) | 500 | −0.01em | 1 |
| Data / numbers | Geist Mono | 13px | 400 | 0 | 1.4, tabular |

Rules
- One italic accent word per headline: signal blue on light, white on the sky.
- Section openers: a mono `FIG. 0N — NAME` tag in `--signal-dim` above the headline, with a 13px `--text-2` side caption beside its last line.
- Body max width 60ch. Never bold a display headline. Never use mono for paragraphs.

---

## 5. Atmosphere & backgrounds

1. **Sky gradient** (entry points only)
   - Desktop: `radial-gradient(ellipse 100% 100% at 50% 100%, sky-0 0%, sky-1 27.5%, sky-2 55%, sky-3 77.5%, sky-4 100%)`.
   - Mobile (< 1024px): `radial-gradient(ellipse 263% 100% at 50% 100%, sky-0 0%, sky-1 15.9%, sky-2 31.8%, sky-3 58.4%, sky-4 85%)`.
2. **Haze**: on light sections, one large radial `--haze` per section, offset into a corner, never centred behind text.
3. **Dot-matrix field** (`public/field.js`): navy dots at rest, sky-blue at the wave crest, signal-blue under a spotlight. Options `ink`, `crestInk`, `spotInk` recolour it; on the sky use white for both `ink` and `crestInk`.
4. **Imagery**: the hero's log pair (bare + mossy) is the only photographic art. Any new art must be blue-sky, daylight, softly lit, on a transparent background, and owned or generated by us.

---

## 6. Components

### 6.1 Nav
- **Hero nav** (on the sky): logo left; a centred glass pill of section links; a glass "Sign in" button right (it becomes "Open app" when signed in). Glass = `--glass-sky` + `backdrop-filter: blur(12px)` + 1px gradient edge (`.edge`, brightest at both round ends). Links fade to 0.6 opacity on hover; the button fill goes to `--glass-sky-strong`. 200ms `--ease-soft`. Phones hide the link pill.
- **Compact nav** (after the hero): a fixed white glass pill that slides in once the hero leaves the viewport: logo, links (active link gets a 4px signal dot), ghost "Sign in" + primary "Get started".

### 6.2 Buttons
| Variant | Use | Spec |
|---|---|---|
| **Primary pill** | One per view | `linear-gradient(180deg, --signal-soft, --signal)`, white text, 48px tall, `--glow-signal`. Hover lifts 1px; trailing `→` slides 3px. |
| **Ghost pill** | Secondary | white fill, `1px --line-strong`, navy text. Hover `--bg-3`. |
| **Sky CTA** | On the sky gradient | white pill, navy text, soft navy shadow. Hover `scale(1.03)`, 200ms `--ease-soft`. |
| **Mono button** | Tool actions | Geist Mono 12px uppercase, 32px, `--r-xs`, `--bg-3` fill. |

### 6.3 Cards
- **White card** (steps, transcript, KPI rows, chart cards): `--bg-1`, `1px --line`, `--shadow-card`. Hover lifts 2px and deepens to `--shadow-panel`.
- **Outline card** (proof stairs): white card plus a ring mark top-right; index number in signal blue; stagger heights 100 / 80 / 62%.
- **Icon tile**: 40px, `--signal-tint` fill, 1px signal border at 20%, signal-blue icon.

### 6.4 Inputs & chat
- Fields: white, `1px --line-strong`, focus `--line-signal` + `0 0 0 4px --signal-tint`.
- Composer: white, `--r-lg`, `--shadow-card`; send button is a 40px primary-gradient circle.
- **User message**: right-aligned bubble, `#EAF2FD` fill with a 16% signal border. **Assistant**: no bubble, a 6px signal dot; older turns fade to `--text-2` with a grey dot.

### 6.5 Network map
| Element | Spec |
|---|---|
| Canvas | `--bg-0` with sky haze behind the root and the dot field at 50%. |
| Root | signal dot with two breathing `--line-signal` rings; goal text Instrument Sans 400 24px. |
| Branch | white pill, `--line-strong` stroke, signal lamp, mono label. Active: signal stroke on `#EAF2FD`. |
| Person card | white card, ring mark; hover stroke `--line-signal`; selected stroke `--signal`. |
| Links | dotted `--link-rest`; root→branch `--signal-dim`; lit path `--signal` with a travelling particle. |

### 6.6 Detail sheet, data panel, tabs
Unchanged in layout. White glass sheet, `--shadow-panel`; data panel is white with hairline rows; the selected tab gets a 1px signal underline; the segmented outreach tracker is a `--bg-3` track with the active stage on a white chip.

### 6.7 Icons
Phosphor Light (1.5px stroke). Default `--text-2`; in icon tiles and active states, `--signal`.

---

## 7. Landing page

Max content width 1200px, 24px gutters (16px on phones). Sections 160px apart (96px on phones).

### 7.1 Order
1. **Hero** (7.2), full screen on the sky.
2. **How it works**: three white cards, `01–03`, each with a live mini visual (typing bubble, dotted lines converging on a node, breathing rings).
3. **The map, up close**: the app screenshot (`public/assets/map-example.jpg`, captured from the real app in this theme) in a `--r-lg` frame with a sky-blue shadow underneath.
4. **Proof**: outcome statements on staggered outline cards. Real numbers only, never invented metrics.
5. **Practice preview**: headline left, a white transcript card right.
6. **Closing banner**: a `--r-lg` strip of the sky gradient with drifting white dots, white headline and a sky CTA.
7. **Footer**: hairline top border, mono links, `© 2026 NetPrep`.

### 7.2 Hero: "Every person has a story."
Built from the easylog hero prompt, adapted to this codebase: vanilla JS (`public/landing-hero.js`) + GSAP 3.15 from cdnjs instead of React/Vite, NetPrep copy, and a white CTA instead of lime. A bare log floats on the sky; moss grows wherever the cursor moves and fades about a second after it leaves.

**Scale.** Every size is in design px: `--u = min(100vw / 1440, 100svh / 760)` on desktop, `min(100vw / 415, 100svh / 760)` below 1024px. Borders and blur radii stay in CSS px. The canvas reads the unit from a hidden probe `calc(100 * var(--u))` wide.

**Layout (desktop, 1440 × 900).**
- Nav row at top/left/right 28, height 50; link pill padding 0 28, gap 31; button padding 0 24.
- Headline at left 28, top 114.5, gap 8: "Every person" (serif) baseline at y 247; "has a story." (sans) cap top 255, baseline 377. Each character is an inline-block span for the reveal; the h1 carries the `aria-label`.
- Lead: top 162, right 34, 319 wide, 3 lines.
- Action block: right 28, bottom 89, 325 wide, gap 28: paragraph (3 lines), then the 207 × 61 white CTA "Map my network".
- Bottom bar: left/right/bottom 28: a 33px white circle with a black ↓ + "Scroll down for more" / "Free while in beta".
- Log image box: `max(1482u, 102.92vw)` wide at 2752:1536, centred, its centre 92.5u below the middle.
- Text boxes use `text-box: trim-both cap alphabetic` with negative-margin fallbacks (serif `-0.12em 0 -0.16em`, sans `-0.14em 0`).

**Layout (< 1024px).** Nav at top 47, side 20, link pill hidden, button 43 tall on `--glass-sky-strong`. Headline + lead stack at top 126.7, gap 28. Action block left/right 20, bottom 98, full-width CTA. Log drawn inside an 826 × 345 clip band (`max(826u, 110vw)`), centre 31.5u below the middle, image top at −22.9% of the band.

**Motion.** t = 0 is when both log images are decoded and the three font faces have loaded.
- **M1 preloader**: a counter (display sans, tabular, small `%`) follows real byte progress × 0.9 via `gsap.quickTo` (0.4s `power1.out`). At t = 0 it runs to 100 (0.8s), the log zooms 2.6× → 1× (0.9s `expo.out`) and un-pixelates from 64px blocks to 1px (`log2` 6 → 0 linear over 1s), and the counter fades at 0.85s.
- **M2 reveals**: nav at 1.0 (blur 8 → 0, 0.5s); headline characters at 1.3 (opacity, blur 18, xPercent −30, 0.8s, stagger 0.035 per line); lead 2.1, bottom bar 2.5, paragraph 2.7, CTA 2.85 (blur 10 → 0, 0.6s). Every blur-in ends with `clearProps: "filter"` so the glass keeps blurring.
- **M3 moss**: the cursor lays brush stamps `{x, y, strength, born}` every 0.12 × radius of travel (strength 0.5), and every 50ms while resting (0.25). Each frame the half-resolution mask is cleared and redrawn from the stamps at `strength × e^(−age / 1.1)`; stamps under 0.004 are dropped, so the log returns to fully bare with no ghost trail. Brush radius 240u. Touch screens (`hover: none`) show full moss, no mask.
- **M4 cursor**: on mouse devices, a 40u white-glass disc replaces the cursor inside the hero only, easing 30% of the way per 60fps frame.
- **Reduced motion**: no counter, zoom or pixelation; everything fades in together over 0.4s. The moss and cursor stay.

**Assets** (use as-is; they send CORS headers): `log-bare.webp` and `log-moss.webp` from `assets.uberdesigner.ai/easylog/`, an exact pixel-aligned pair. They're preloaded with `<link rel="preload" as="fetch" crossorigin>` and allowed in the CSP's `connect-src`.

---

## 8. Sign in / sign up

The sky gradient full-bleed with white drifting dots, the white logo top-left, and a centred white card (94% white, `--r-lg`, deep navy shadow). A signal root node sits on the card's top edge with a dotted line running along it: the map starts here.

---

## 9. App screen (chat + map)

```
┌ sidebar 240 (white) ┐┌──────── white glass top bar: goal (mono) · demo badge · undo · branch · merge ────────┐
│ logo                ││ ┌ chat (white) ┐ ┌──────────── map (bg-0 + haze + dot field) ─────────┐ ┌ detail ┐ │
│ New map  (active:   ││ │ messages     │ │ root ◉ ·· branches (white pills) ·· person cards   │ │ white  │ │
│  signal-tint fill,  ││ │ composer     │ │                               FIG. MAP · 3 · 9     │ │ glass  │ │
│  blue rail)         ││ └──────────────┘ └────────────────────────────────────────────────────┘ └────────┘ │
└─────────────────────┘└────────────────────────────────────────────────────────────────────────────────────┘
```
- Sidebar: white with a faint sky haze top-left; active item gets a `--signal-tint` fill and a 2px signal rail.
- Page views (Past chats, Connections, Insights, Account): `--bg-0` with one haze top-right; tables on hairlines; KPI rows and chart cards are white cards.
- Phones (< 760px): sidebar becomes a white glass bottom tab bar; detail becomes a bottom sheet.

---

## 10. Motion

- **Landing load**: the hero intro (7.2). Below the hero, cards rise 16px + fade, staggered 80ms, once, at 15% visibility.
- **Ambient**: dot fields drift (~20s loop); root rings breathe (4s).
- **Hover**: `--t-fast`; lift ≤ 2px. Only the sky CTA scales (1.03).
- **Reduced motion**: disable ambient loops and draw-ins; show final states.

---

## 11. Accessibility

- Body text on light surfaces is `--text-1` or `--text-2` only (≥ 7.6:1). `--text-3` is for labels and meta (5.0:1).
- On the sky, white text is display-sized or 500-weight at ≥ 16 design px; the gradient's darkest stops sit behind it. Don't put small or light-weight text on `--sky-1`/`--sky-0`.
- White text over the hero art always gets help, because the log runs behind the copy: a navy scrim over the canvas (`--scrim-top`, `--scrim-side`, `--scrim-bottom`), a soft navy `text-shadow` (`--text-lift`, `--display-lift`), and a feathered frosted patch (blur 14px + 30% navy) behind each paragraph. The headline sits above those patches so it never gets blurred.
- Blue is never the only signal: active nodes also change their border, stages add pips, values carry `+`/`−`.
- Focus ring everywhere: `outline: 2px solid var(--signal); outline-offset: 3px`.
- Hit targets ≥ 40px on touch.

---

## 12. Do / Don't

| Do | Don't |
|---|---|
| Keep the sky for entry points | Put the sky gradient behind working UI |
| Use signal blue for one primary action per view | Make headings, icons and borders all blue |
| Lift cards with soft navy shadows | Use colored glows or heavy borders |
| Keep headlines big, 400, tightly tracked | Bold display text |
| Use mono for labels, numbers and small buttons | Use mono for paragraphs |
| Draw every connection as a dotted line | Use solid arrows or straight connectors |
| Use real data, or none | Fake stats, fake logos, fake testimonials |
