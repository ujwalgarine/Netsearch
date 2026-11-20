// Hero: a bare log on the sky. The cursor paints a mask and moss grows through it.
// M1 preloader (counter, zoom, pixelation) -> M2 reveals -> M3 moss mask -> M4 cursor.
// Spec: design inspiration/design.md, section 7.2.

(function () {
  const hero = document.getElementById('hero');
  if (!hero) return;

  // ---- Motion constants ----
  const LOG_BARE = 'https://assets.uberdesigner.ai/easylog/log-bare.webp';
  const LOG_MOSS = 'https://assets.uberdesigner.ai/easylog/log-moss.webp';
  const ZOOM_FROM = 2.6;
  const ZOOM_DUR = 0.9;
  const BLOCK_LOG2_FROM = 6; // 64px blocks -> 1px
  const PIXEL_DUR = 1.0;
  const COUNTER_TO_100 = 0.8;
  const COUNTER_FOLLOW = 0.4;
  const COUNTER_FADE_AT = 0.85;
  const COUNTER_FADE = 0.4;
  const LOAD_SHARE = 0.9; // the counter shows progress x 0.9 until everything is ready

  const BRUSH_RADIUS = 240; // design px
  const FADE_TIME = 1.1; // s
  const STAMP_SPACING = 0.12; // x radius
  const MOVE_STRENGTH = 0.5;
  const REST_STRENGTH = 0.25;
  const REST_AFTER = 0.05; // s without movement counts as resting
  const REST_EVERY = 0.05; // s between resting stamps
  const MIN_ALPHA = 0.004;
  const CURSOR_FOLLOW = 0.3; // of the remaining distance per 60fps frame

  const gsap = window.gsap;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touch = window.matchMedia('(hover: none)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  const canvas = hero.querySelector('.log-canvas');
  const ctx = canvas.getContext('2d');
  const clipBox = hero.querySelector('.log-clip');
  const imgBox = hero.querySelector('.log-img');
  const probe = hero.querySelector('.log-probe');
  const counter = hero.querySelector('.counter');
  const counterNum = hero.querySelector('.counter-num');
  const cursorEl = document.querySelector('.cursor');

  // Offscreen canvases: moss layer (device px), mask (half CSS px), scene + pixel buffer for the intro.
  const layer = document.createElement('canvas');
  const layerCtx = layer.getContext('2d');
  const mask = document.createElement('canvas');
  const maskCtx = mask.getContext('2d');
  const scene = document.createElement('canvas');
  const sceneCtx = scene.getContext('2d');
  const pix = document.createElement('canvas');
  const pixCtx = pix.getContext('2d');
  let brush = null;
  let brushR = 0;

  // Shared intro state, tweened by GSAP and read every frame.
  const intro = { zoom: reduceMotion ? 1 : ZOOM_FROM, pixel: reduceMotion ? 0 : BLOCK_LOG2_FROM };
  let bare = null;
  let moss = null;

  // ---------------------------------------------------------------------------
  // Headline: one inline-block span per character, for the reveal
  // ---------------------------------------------------------------------------

  const lines = [...hero.querySelectorAll('.hl')].map((line) => {
    const text = line.textContent;
    line.textContent = '';
    return [...text].map((c) => {
      const s = document.createElement('span');
      s.className = 'ch';
      s.textContent = c;
      line.append(s);
      return s;
    });
  });

  // ---------------------------------------------------------------------------
  // Geometry (CSS px, relative to the hero), read on resize
  // ---------------------------------------------------------------------------

  const geo = { w: 0, h: 0, dpr: 1, unit: 1, clip: null, img: null };

  function measure() {
    const h = hero.getBoundingClientRect();
    const rel = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - h.left, y: r.top - h.top, w: r.width, h: r.height };
    };
    geo.w = h.width;
    geo.h = h.height;
    geo.dpr = Math.min(window.devicePixelRatio || 1, 2);
    geo.unit = probe.getBoundingClientRect().width / 100;
    geo.clip = rel(clipBox);
    geo.img = rel(imgBox);

    const dw = Math.round(geo.w * geo.dpr);
    const dh = Math.round(geo.h * geo.dpr);
    for (const c of [canvas, layer, scene]) {
      if (c.width !== dw) c.width = dw;
      if (c.height !== dh) c.height = dh;
    }
    mask.width = Math.max(1, Math.round(geo.w * 0.5));
    mask.height = Math.max(1, Math.round(geo.h * 0.5));

    // Brush sprite: radius 240 design px, at mask scale.
    const r = Math.max(1, Math.round(BRUSH_RADIUS * geo.unit * 0.5));
    if (r !== brushR) {
      brushR = r;
      brush = document.createElement('canvas');
      brush.width = brush.height = r * 2;
      const b = brush.getContext('2d');
      const grad = b.createRadialGradient(r, r, 0, r, r, r);
      grad.addColorStop(0, '#000');
      grad.addColorStop(0.45, 'rgba(0,0,0,0.85)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      b.fillStyle = grad;
      b.fillRect(0, 0, r * 2, r * 2);
    }
  }

  // ---------------------------------------------------------------------------
  // M3: brush stamps, added independently of the frame rate
  // ---------------------------------------------------------------------------

  let stamps = [];
  const pointer = { cx: 0, cy: 0, inside: false, moved: false, lastMove: 0, newPath: true };
  let lastX = 0;
  let lastY = 0;
  let travel = 0;
  let lastRest = 0;

  function addStamps(now, px, py) {
    if (!pointer.inside) return;
    const radius = BRUSH_RADIUS * geo.unit;
    if (pointer.moved) {
      pointer.moved = false;
      if (pointer.newPath) {
        pointer.newPath = false;
        lastX = px;
        lastY = py;
        travel = 0;
        stamps.push({ x: px, y: py, strength: MOVE_STRENGTH, born: now });
        return;
      }
      const step = radius * STAMP_SPACING;
      const dx = px - lastX;
      const dy = py - lastY;
      const dist = Math.hypot(dx, dy);
      if (dist > 0) {
        for (let d = step - travel; d <= dist; d += step) {
          stamps.push({ x: lastX + (dx * d) / dist, y: lastY + (dy * d) / dist, strength: MOVE_STRENGTH, born: now });
        }
        travel = (travel + dist) % step;
      }
      lastX = px;
      lastY = py;
    } else if (now - pointer.lastMove >= REST_AFTER && now - lastRest >= REST_EVERY) {
      // a resting cursor keeps its moss
      lastRest = now;
      stamps.push({ x: px, y: py, strength: REST_STRENGTH, born: now });
    }
  }

  function drawMask(now) {
    maskCtx.clearRect(0, 0, mask.width, mask.height);
    // Redraw from the list every frame. Fading a canvas in place with translucent destination-out
    // stalls in 8-bit alpha and leaves a ghost trail.
    stamps = stamps.filter((s) => {
      const a = s.strength * Math.exp(-(now - s.born) / FADE_TIME);
      if (a < MIN_ALPHA) return false;
      maskCtx.globalAlpha = a;
      maskCtx.drawImage(brush, s.x * 0.5 - brushR, s.y * 0.5 - brushR);
      return true;
    });
    maskCtx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Compose: bare log, then moss through the mask (or full moss on touch screens)
  // ---------------------------------------------------------------------------

  function compose(target, targetCtx) {
    const { w: W, h: H, dpr, img, clip } = geo;
    const w = img.w * intro.zoom;
    const h = img.h * intro.zoom;
    const x0 = img.x + img.w / 2 - w / 2;
    const y0 = img.y + img.h / 2 - h / 2;

    targetCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    targetCtx.clearRect(0, 0, W, H);
    targetCtx.save();
    targetCtx.beginPath();
    targetCtx.rect(clip.x, clip.y, clip.w, clip.h);
    targetCtx.clip();
    targetCtx.imageSmoothingQuality = 'high';

    if (touch.matches) {
      targetCtx.drawImage(moss, x0, y0, w, h);
    } else {
      targetCtx.drawImage(bare, x0, y0, w, h);
      if (stamps.length) {
        layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        layerCtx.clearRect(0, 0, W, H);
        layerCtx.drawImage(moss, x0, y0, w, h);
        layerCtx.globalCompositeOperation = 'destination-in';
        layerCtx.drawImage(mask, 0, 0, W, H);
        layerCtx.globalCompositeOperation = 'source-over';
        targetCtx.setTransform(1, 0, 0, 1, 0, 0); // the layer is already at device size
        targetCtx.drawImage(layer, 0, 0);
      }
    }
    targetCtx.restore();
  }

  function render(now) {
    if (!geo.w || !geo.h || !canvas.width || !canvas.height || !mask.width) return;
    const t = now / 1000;
    const rect = hero.getBoundingClientRect();
    const px = pointer.cx - rect.left;
    const py = pointer.cy - rect.top;
    addStamps(t, px, py);
    drawMask(t);
    if (!bare || !moss) return;

    const block = 2 ** intro.pixel; // CSS px
    if (block <= 1.001) {
      compose(canvas, ctx);
      return;
    }
    // Pixelate the whole scene: down to 1/block, back up without smoothing, grid from top left.
    compose(scene, sceneCtx);
    const sw = Math.max(1, Math.ceil(geo.w / block));
    const sh = Math.max(1, Math.ceil(geo.h / block));
    if (pix.width !== sw || pix.height !== sh) {
      pix.width = sw;
      pix.height = sh;
    }
    pixCtx.imageSmoothingEnabled = true;
    pixCtx.clearRect(0, 0, sw, sh);
    pixCtx.drawImage(scene, 0, 0, sw * block * geo.dpr, sh * block * geo.dpr, 0, 0, sw, sh);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(pix, 0, 0, sw, sh, 0, 0, sw * block * geo.dpr, sh * block * geo.dpr);
    ctx.imageSmoothingEnabled = true;
  }

  // ---------------------------------------------------------------------------
  // M4: cursor disc eases toward the pointer (frame-rate independent)
  // ---------------------------------------------------------------------------

  const disc = { x: 0, y: 0, placed: false };
  function moveCursor(dt) {
    if (!cursorEl || !disc.placed) return;
    const k = 1 - (1 - CURSOR_FOLLOW) ** (dt / 16.67);
    disc.x += (pointer.cx - disc.x) * k;
    disc.y += (pointer.cy - disc.y) * k;
    cursorEl.style.transform = `translate3d(${disc.x.toFixed(2)}px, ${disc.y.toFixed(2)}px, 0)`;
  }

  // ---------------------------------------------------------------------------
  // Frame loop: runs while the hero is on screen and the tab is visible
  // ---------------------------------------------------------------------------

  let raf = 0;
  let last = 0;
  let onScreen = true;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(64, now - (last || now));
    last = now;
    render(now);
    moveCursor(dt);
  }
  function sync() {
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    if (onScreen && !document.hidden) raf = requestAnimationFrame(frame);
  }
  new IntersectionObserver(([e]) => {
    onScreen = e.isIntersecting;
    sync();
  }).observe(hero);
  document.addEventListener('visibilitychange', sync);
  new ResizeObserver(() => {
    measure();
    if (!raf) render(performance.now());
  }).observe(hero);
  measure();
  sync();

  if (finePointer) {
    hero.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      pointer.cx = e.clientX;
      pointer.cy = e.clientY;
      pointer.moved = true;
      pointer.lastMove = performance.now() / 1000;
      if (!pointer.inside) {
        pointer.inside = true;
        pointer.newPath = true;
      }
      if (!disc.placed) {
        disc.placed = true;
        disc.x = e.clientX;
        disc.y = e.clientY;
      }
      cursorEl?.classList.add('on');
    });
    hero.addEventListener('pointerleave', () => {
      pointer.inside = false; // existing stamps fade out on their own
      cursorEl?.classList.remove('on');
    });
    // Scrolling moves the hero under a still cursor: keep stamping where it now points.
    window.addEventListener('scroll', () => { if (pointer.inside) pointer.moved = true; }, { passive: true });
  }

  // ---------------------------------------------------------------------------
  // M1: load with byte progress, then the intro timeline
  // ---------------------------------------------------------------------------

  const count = { value: 0 };
  const showCount = () => { counterNum.textContent = String(Math.round(count.value * 100)).padStart(2, '0'); };
  const follow = gsap ? gsap.quickTo(count, 'value', { duration: COUNTER_FOLLOW, ease: 'power1.out', onUpdate: showCount }) : null;

  async function loadImages(urls, onProgress) {
    const loaded = urls.map(() => 0);
    const totals = urls.map(() => 0);
    const done = urls.map(() => false);
    let shown = 0;
    const report = () => {
      const known = totals.every((t) => t > 0);
      const p = known
        ? loaded.reduce((a, b) => a + b, 0) / totals.reduce((a, b) => a + b, 0)
        : done.filter(Boolean).length / urls.length;
      shown = Math.max(shown, Math.min(1, p)); // never backwards
      onProgress(shown);
    };
    return Promise.all(urls.map(async (url, i) => {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      totals[i] = Number(res.headers.get('Content-Length')) || 0;
      let blob;
      if (res.body && totals[i]) {
        const reader = res.body.getReader();
        const chunks = [];
        for (;;) {
          const { done: end, value } = await reader.read();
          if (end) break;
          chunks.push(value);
          loaded[i] += value.byteLength;
          report();
        }
        blob = new Blob(chunks, { type: res.headers.get('Content-Type') || 'image/webp' });
      } else {
        blob = await res.blob();
      }
      done[i] = true;
      report();
      return createImageBitmap(blob);
    }));
  }

  const fontsReady = Promise.all([
    document.fonts.load('italic 400 1em "Instrument Serif"'),
    document.fonts.load('400 1em "Instrument Sans"'),
    document.fonts.load('500 1em "Instrument Sans"'),
  ]).catch(() => {});

  const imagesReady = loadImages([LOG_BARE, LOG_MOSS], (p) => follow?.(p * LOAD_SHARE))
    .then(([b, m]) => { bare = b; moss = m; })
    .catch((err) => console.error('Hero log images failed to load; showing the hero without the log.', err));

  const q = (name) => hero.querySelector(`[data-intro="${name}"]`);
  const nav = q('nav');
  const headline = q('headline');
  const lead = q('lead');
  const bottom = q('bottom');
  const action = q('action');
  const cta = q('cta');

  Promise.all([imagesReady, fontsReady]).then(() => {
    if (!gsap) {
      // GSAP didn't load: show the final state.
      intro.zoom = 1;
      intro.pixel = 0;
      counter.hidden = true;
      for (const el of [nav, headline, lead, bottom, action, cta]) el.style.opacity = 1;
      return;
    }
    // t = 0: both images decoded and the three font faces loaded.
    if (reduceMotion) {
      counter.hidden = true;
      gsap.to([nav, headline, lead, bottom, action, cta], { opacity: 1, duration: 0.4, ease: 'power1.out' });
      return;
    }
    const blurIn = { opacity: 0, filter: 'blur(10px)' };
    const blurTo = { opacity: 1, filter: 'blur(0px)', duration: 0.6, ease: 'power2.out', clearProps: 'filter' };
    const tl = gsap.timeline();
    tl.to(count, { value: 1, duration: COUNTER_TO_100, ease: 'power1.out', overwrite: true, onUpdate: showCount }, 0)
      .to(intro, { zoom: 1, duration: ZOOM_DUR, ease: 'expo.out' }, 0)
      .to(intro, { pixel: 0, duration: PIXEL_DUR, ease: 'none' }, 0)
      .to(counter, { opacity: 0, duration: COUNTER_FADE, ease: 'power1.in' }, COUNTER_FADE_AT)
      // M2: reveals
      .fromTo(nav, { opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.5, ease: 'power2.out', clearProps: 'filter' }, 1.0)
      .set(headline, { opacity: 1 }, 1.3);
    for (const chars of lines) {
      tl.fromTo(chars, { opacity: 0, filter: 'blur(18px)', xPercent: -30 },
        { opacity: 1, filter: 'blur(0px)', xPercent: 0, duration: 0.8, ease: 'power2.out', stagger: 0.035, clearProps: 'filter,transform' }, 1.3);
    }
    tl.fromTo(lead, blurIn, blurTo, 2.1)
      .fromTo(bottom, blurIn, blurTo, 2.5)
      .fromTo(action, blurIn, blurTo, 2.7)
      .fromTo(cta, blurIn, blurTo, 2.85)
      .set(counter, { display: 'none' });
  });
})();
