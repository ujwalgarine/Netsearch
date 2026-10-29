// Landing page behavior: background fields, the hero's mini network, nav state, reveals.
// No scroll listeners: everything is driven by IntersectionObserver.

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const NS = 'http://www.w3.org/2000/svg';

// ---------------------------------------------------------------------------
// Banner dot field (the hero's field is driven by the hero loop below)
// ---------------------------------------------------------------------------

window.DotField(document.getElementById('banner-field'), { gap: 12, crest: 0.6, spread: 0.2, rest: 0.12 });

// ---------------------------------------------------------------------------
// Hero network: a goal with branches and people, drawn as dotted light, turning slowly
// ---------------------------------------------------------------------------

function svgEl(tag, attrs, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.append(node);
  return node;
}

// Points along a path from its end back to its start. Links are drawn root-outward, so this
// gives the node-to-root route the hover particle travels.
function backwards(path, steps = 24) {
  const len = path.getTotalLength();
  return Array.from({ length: steps + 1 }, (_, i) => {
    const p = path.getPointAtLength(len * (1 - i / steps));
    return [p.x, p.y];
  });
}

function drawHeroNetwork(svg) {
  const spin = svgEl('g', { class: 'spin' }, svg);
  const links = svgEl('g', {}, spin);
  const nodes = svgEl('g', {}, spin);
  const BRANCHES = 5;
  const point = (r, deg) => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)];
  const pills = []; // every pill, with its local position and its route back to the root

  for (let i = 0; i < BRANCHES; i++) {
    const angle = -90 + (360 / BRANCHES) * i + 14;
    const [bx, by] = point(235, angle);
    const [cx, cy] = point(120, angle - 22);
    const trunk = svgEl('path', { class: 'link trunk', d: `M0 0 Q${cx} ${cy} ${bx} ${by}` }, links);
    const branch = svgEl('g', { class: 'node' }, nodes);
    svgEl('rect', { class: 'branch', x: bx - 26, y: by - 10, width: 52, height: 20, rx: 10 }, branch);
    svgEl('circle', { class: 'branch-dot', cx: bx - 14, cy: by, r: 2.5 }, branch);
    const trunkRoute = backwards(trunk);
    pills.push({ el: branch, x: bx, y: by, w: 52, h: 20, links: [trunk], route: trunkRoute });

    const leaves = i % 2 ? 3 : 2;
    for (let j = 0; j < leaves; j++) {
      const spread = (j - (leaves - 1) / 2) * 15;
      const [lx, ly] = point(420 + (j % 2) * 30, angle + spread);
      const [qx, qy] = point(330, angle + spread * 0.4);
      const link = svgEl('path', { class: 'link', d: `M${bx} ${by} Q${qx} ${qy} ${lx} ${ly}` }, links);
      const leaf = svgEl('g', { class: 'node' }, nodes);
      svgEl('rect', { class: 'leaf', x: lx - 30, y: ly - 12, width: 60, height: 24, rx: 7 }, leaf);
      svgEl('circle', { class: 'leaf-dot', cx: lx + 19, cy: ly - 4, r: 2 }, leaf);
      pills.push({ el: leaf, x: lx, y: ly, w: 60, h: 24, links: [link, trunk], route: [...backwards(link), ...trunkRoute] });
    }
  }

  const rings = svgEl('g', { class: 'rings' }, nodes);
  svgEl('circle', { class: 'root-ring', r: 44, opacity: 0.2 }, rings);
  svgEl('circle', { class: 'root-ring', r: 26, opacity: 0.4 }, rings);
  svgEl('circle', { class: 'root', r: 8 }, nodes);
  const particle = svgEl('circle', { class: 'particle', r: 3.5, opacity: 0 }, nodes);
  return { spin, rings, particle, pills };
}

// ---------------------------------------------------------------------------
// Hero signal: one rAF loop drives the dot field. With a mouse, the cursor also becomes a live
// node: a spotlight on the dots, tethers to the nearest pills, path glow, a magnetic CTA.
// Everything it draws lives in .hero-bg, under the copy and inside the text-safe mask.
// ---------------------------------------------------------------------------

const hero = document.querySelector('.hero');
const heroBg = hero.querySelector('.hero-bg');
const netSvg = document.getElementById('hero-net');
const tetherSvg = document.getElementById('hero-tether');
const cta = hero.querySelector('.hero-ctas .pill-primary');
const net = drawHeroNetwork(netSvg);
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const live = finePointer && !reduceMotion; // reduced motion keeps only the pill color change

const SPOT_LERP = 0.14; // per 60fps frame, so the spotlight trails the cursor a little
const TETHER_RANGE = 260;
const MAGNET_RANGE = 80;
const MAGNET_MAX = 6;
const COPY = '.announce, .display .line, .hero-sub, .hero-ctas .pill, .checks li';

const geo = { x: 0, y: 0, w: 0, h: 0, cx: 0, cy: 0, scale: 1, holes: [], cta: { x: 0, y: 0, w: 0, h: 0 } };
const pointer = { x: 0, y: 0, inside: false };
const light = { x: 0, y: 0, k: 0 };
const magnet = { on: false, x: 0, y: 0 };
const tethers = new Map(); // pill -> line opacity
const tetherPaths = Array.from({ length: 4 }, () => svgEl('path', { opacity: 0 }, tetherSvg));
let hot = null;
let signal = null; // the particle in flight: { pill, start }

const heroField = window.DotField(document.getElementById('hero-field'), {
  crest: 0.78,
  spread: 0.13,
  manual: true,
  spot: () => (light.k > 0 ? { x: light.x, y: light.y, k: light.k, mask: textSafe } : null),
});

// Layout box relative to the hero. Offsets ignore transforms, so load animations and the
// magnet don't skew the numbers.
function boxIn(el) {
  let x = 0;
  let y = 0;
  for (let n = el; n && n !== hero; n = n.offsetParent) {
    x += n.offsetLeft;
    y += n.offsetTop;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

// Text-safe zone: one feathered ellipse per piece of copy. The background is at 12% inside each
// ellipse's 72% contour and feathers back to full at its edge. Radii of 1.5x / 3.67x the half-box
// put the box corners exactly on that contour while keeping the feather mostly vertical.
function measure() {
  // reads first, then writes, so the browser lays out once
  let x = 0;
  let y = 0;
  for (let n = hero; n; n = n.offsetParent) {
    x += n.offsetLeft;
    y += n.offsetTop;
  }
  Object.assign(geo, { x, y, w: hero.clientWidth, h: hero.clientHeight, cta: boxIn(cta) });
  geo.holes = [...hero.querySelectorAll(COPY)].map((el) => {
    const b = boxIn(el);
    return { cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: (b.w / 2 + 8) * 1.5, ry: (b.h / 2 + 8) * 3.67 };
  });
  // Park the root so its outer ring clears the trust row by 96px.
  const checks = boxIn(hero.querySelector('.checks'));
  geo.scale = netSvg.getBoundingClientRect().width / 1200;
  geo.cx = geo.w / 2;
  geo.cy = checks.y + checks.h + 96 + 45 * geo.scale;

  const holes = geo.holes.map(
    (h) => `radial-gradient(${h.rx}px ${h.ry}px at ${h.cx}px ${h.cy}px, rgba(0, 0, 0, .88) 72%, transparent)`,
  );
  const mask = ['linear-gradient(#000, #000)', ...holes].join(', ');
  heroBg.style.webkitMaskImage = mask;
  heroBg.style.webkitMaskComposite = ['source-out', ...holes.map(() => 'source-over')].join(', ');
  heroBg.style.maskImage = mask;
  heroBg.style.maskComposite = ['subtract', ...holes.map(() => 'add')].join(', ');
  hero.style.setProperty('--root-y', `${geo.cy}px`);
}

// The same mask as above, evaluated in JS so lit dots fade out behind copy too.
function textSafe(x, y) {
  let m = 1;
  for (const h of geo.holes) {
    const d = Math.hypot((x - h.cx) / h.rx, (y - h.cy) / h.ry);
    if (d < 1) m *= 1 - 0.88 * Math.min(1, (1 - d) / 0.28);
  }
  return m;
}

// Current rotation of the spinning network, read from its CSS animation.
let spinAnim;
function spinAngle() {
  spinAnim ??= net.spin.getAnimations()[0] || null;
  const t = spinAnim?.currentTime;
  return t == null ? 0 : ((t % 180000) / 180000) * Math.PI * 2;
}

// Hero position of every pill at rotation `a`, and whether it's out in the open (not under copy).
function placePills(a) {
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  for (const p of net.pills) {
    p.sx = geo.cx + geo.scale * (p.x * cos - p.y * sin);
    p.sy = geo.cy + geo.scale * (p.x * sin + p.y * cos);
    p.open = p.sx > 0 && p.sx < geo.w && p.sy > 0 && p.sy < geo.h && textSafe(p.sx, p.sy) > 0.5;
  }
}

function pillAt(x, y, a) {
  const u = (x - geo.cx) / geo.scale;
  const v = (y - geo.cy) / geo.scale;
  const lx = u * Math.cos(a) + v * Math.sin(a);
  const ly = -u * Math.sin(a) + v * Math.cos(a);
  return net.pills.find((p) => p.open && Math.abs(lx - p.x) <= p.w / 2 + 4 && Math.abs(ly - p.y) <= p.h / 2 + 4) || null;
}

function setHot(pill) {
  if (pill === hot) return;
  if (hot) {
    hot.el.classList.remove('hot');
    hot.links.forEach((l) => l.classList.remove('hot'));
  }
  hot = pill;
  if (!pill) return;
  pill.el.classList.add('hot');
  if (!live) return;
  pill.links.forEach((l) => l.classList.add('hot'));
  signal = { pill, start: performance.now() };
}

function tetherPath(x1, y1, x2, y2) {
  // a slight bend: connections are never straight connector lines
  const qx = (x1 + x2) / 2 - (y2 - y1) * 0.12;
  const qy = (y1 + y2) / 2 + (x2 - x1) * 0.12;
  return `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${qx.toFixed(1)} ${qy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

function step(now, dt) {
  const ease = 1 - (1 - SPOT_LERP) ** (dt / 16.7);
  light.x += (pointer.x - light.x) * ease;
  light.y += (pointer.y - light.y) * ease;
  light.k = Math.min(1, Math.max(0, light.k + (pointer.inside ? dt / 240 : -dt / 400)));

  const a = spinAngle();
  placePills(a);
  setHot(pointer.inside ? pillAt(pointer.x, pointer.y, a) : null);

  // Cursor as a node: the two nearest open pills in range tether to it (in 160ms, out 400ms).
  const dist = (p) => Math.hypot(p.sx - light.x, p.sy - light.y);
  const near = pointer.inside
    ? net.pills.filter((p) => p.open && dist(p) < TETHER_RANGE).sort((p, q) => dist(p) - dist(q)).slice(0, 2)
    : [];
  for (const p of net.pills) {
    const from = tethers.get(p) || 0;
    const to = near.includes(p) ? Math.min(1, from + dt / 160) : Math.max(0, from - dt / 400);
    if (to > 0) tethers.set(p, to);
    else tethers.delete(p);
  }
  let i = 0;
  for (const [p, alpha] of tethers) {
    if (i === tetherPaths.length) break;
    tetherPaths[i].setAttribute('d', tetherPath(p.sx, p.sy, light.x, light.y));
    tetherPaths[i++].setAttribute('opacity', alpha.toFixed(3));
  }
  for (; i < tetherPaths.length; i++) tetherPaths[i].setAttribute('opacity', 0);

  // The hover signal runs node -> root, then the root rings pulse once.
  if (signal) {
    const t = Math.min(1, (now - signal.start) / 900);
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const route = signal.pill.route;
    const f = e * (route.length - 1);
    const [x0, y0] = route[Math.floor(f)];
    const [x1, y1] = route[Math.min(route.length - 1, Math.floor(f) + 1)];
    const r = f % 1;
    net.particle.setAttribute('transform', `translate(${x0 + (x1 - x0) * r} ${y0 + (y1 - y0) * r})`);
    net.particle.setAttribute('opacity', t < 1 ? 1 : 0);
    if (t === 1) {
      signal = null;
      net.rings.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], {
        duration: 600,
        easing: 'cubic-bezier(.2, .8, .2, 1)',
      });
    }
  }

  // Magnetic CTA: within 80px of its edge it leans up to 6px toward the cursor.
  const c = geo.cta;
  const dx = pointer.x - (c.x + c.w / 2);
  const dy = pointer.y - (c.y + c.h / 2);
  const edge = Math.hypot(Math.max(0, Math.abs(dx) - c.w / 2), Math.max(0, Math.abs(dy) - c.h / 2));
  if (pointer.inside && edge < MAGNET_RANGE) {
    const len = Math.hypot(dx, dy) || 1;
    const reach = Math.min(MAGNET_MAX, len * 0.1) * (1 - edge / MAGNET_RANGE);
    magnet.x += ((dx / len) * reach - magnet.x) * ease;
    magnet.y += ((dy / len) * reach - magnet.y) * ease;
    if (!magnet.on) cta.classList.add('magnet');
    magnet.on = true;
    cta.style.setProperty('--tx', `${magnet.x.toFixed(2)}px`);
    cta.style.setProperty('--ty', `${magnet.y.toFixed(2)}px`);
    cta.style.setProperty('--mx', `${(pointer.x - c.x).toFixed(1)}px`);
    cta.style.setProperty('--my', `${(pointer.y - c.y).toFixed(1)}px`);
  } else if (magnet.on) {
    // hand back to CSS, which eases it home over --t-base
    magnet.on = false;
    magnet.x = magnet.y = 0;
    cta.classList.remove('magnet');
    cta.style.setProperty('--tx', '0px');
    cta.style.setProperty('--ty', '0px');
  }
}

let raf = 0;
let last = 0;
let lastField = 0;
let heroOnScreen = true;

function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(64, now - (last || now));
  last = now;
  if (live) step(now, dt);
  // ambient drift is fine at ~30fps; the spotlight gets every frame
  if (light.k > 0 || now - lastField >= 33) {
    heroField.draw(now);
    lastField = now;
  }
}

function syncHeroLoop() {
  cancelAnimationFrame(raf);
  raf = 0;
  last = 0;
  if (heroOnScreen && !document.hidden && !reduceMotion) raf = requestAnimationFrame(frame);
}

new ResizeObserver(measure).observe(hero);
new ResizeObserver(measure).observe(hero.querySelector('.hero-inner'));
document.fonts?.ready.then(measure);
new IntersectionObserver(([entry]) => {
  heroOnScreen = entry.isIntersecting;
  syncHeroLoop();
}).observe(hero);
document.addEventListener('visibilitychange', syncHeroLoop);
measure();

if (finePointer) {
  hero.addEventListener('pointermove', (e) => {
    pointer.x = e.pageX - geo.x;
    pointer.y = e.pageY - geo.y;
    if (light.k === 0) {
      // start the spotlight under the cursor instead of sweeping in from where it last was
      light.x = pointer.x;
      light.y = pointer.y;
    }
    pointer.inside = true;
    if (!live) {
      placePills(spinAngle());
      setHot(pillAt(pointer.x, pointer.y, spinAngle()));
    }
  });
  hero.addEventListener('pointerleave', () => {
    pointer.inside = false;
    if (!live) setHot(null);
  });
}

// ---------------------------------------------------------------------------
// Nav: stronger glass once the page has scrolled; active link follows the section in view
// ---------------------------------------------------------------------------

const nav = document.querySelector('.nav');
new IntersectionObserver(([entry]) => nav.classList.toggle('scrolled', !entry.isIntersecting)).observe(
  document.getElementById('top-sentinel'),
);

const navLinks = [...document.querySelectorAll('.nav-links a')];
const spy = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      navLinks.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${entry.target.id}`));
    }
  },
  { rootMargin: '-45% 0px -50% 0px' },
);
['how', 'map', 'practice'].forEach((id) => spy.observe(document.getElementById(id)));
new IntersectionObserver(([entry]) => {
  if (entry.isIntersecting) navLinks.forEach((a) => a.classList.remove('active'));
}).observe(document.querySelector('.hero-inner'));

// ---------------------------------------------------------------------------
// Scroll reveals: once, when 15% of the element is visible
// ---------------------------------------------------------------------------

const reveal = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('in');
      reveal.unobserve(entry.target);
    }
  },
  { threshold: 0.15 },
);
document.querySelectorAll('.reveal').forEach((el) => reveal.observe(el));

// ---------------------------------------------------------------------------
// Fig. 01: the goal types itself out while the card is on screen
// ---------------------------------------------------------------------------

const typed = document.querySelector('.typed');
const fullText = typed.dataset.text;
if (reduceMotion) {
  typed.textContent = fullText;
} else {
  let timer = 0;
  let i = 0;
  const tick = () => {
    i = i > fullText.length + 18 ? 0 : i + 1; // type, hold for a beat, start over
    typed.textContent = fullText.slice(0, i);
    timer = setTimeout(tick, i === 0 ? 500 : 55);
  };
  new IntersectionObserver(([entry]) => {
    clearTimeout(timer);
    if (entry.isIntersecting) tick();
  }).observe(typed.closest('.step'));
}
