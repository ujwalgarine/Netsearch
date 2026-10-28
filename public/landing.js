// Landing page behavior: background fields, the hero's mini network, nav state, reveals.
// No scroll listeners: everything is driven by IntersectionObserver.

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const NS = 'http://www.w3.org/2000/svg';

// ---------------------------------------------------------------------------
// Dot-matrix fields
// ---------------------------------------------------------------------------

window.DotField(document.getElementById('hero-field'), { crest: 0.78, spread: 0.13 });
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

function drawHeroNetwork(svg) {
  const spin = svgEl('g', { class: 'spin' }, svg);
  const links = svgEl('g', {}, spin);
  const nodes = svgEl('g', {}, spin);
  const BRANCHES = 5;
  const point = (r, deg) => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)];

  for (let i = 0; i < BRANCHES; i++) {
    const angle = -90 + (360 / BRANCHES) * i + 14;
    const [bx, by] = point(235, angle);
    const [cx, cy] = point(120, angle - 22);
    svgEl('path', { class: 'link trunk', d: `M0 0 Q${cx} ${cy} ${bx} ${by}` }, links);
    svgEl('rect', { class: 'branch', x: bx - 26, y: by - 10, width: 52, height: 20, rx: 10 }, nodes);
    svgEl('circle', { class: 'branch-dot', cx: bx - 14, cy: by, r: 2.5 }, nodes);

    const leaves = i % 2 ? 3 : 2;
    for (let j = 0; j < leaves; j++) {
      const spread = (j - (leaves - 1) / 2) * 15;
      const [lx, ly] = point(420 + (j % 2) * 30, angle + spread);
      const [qx, qy] = point(330, angle + spread * 0.4);
      svgEl('path', { class: 'link', d: `M${bx} ${by} Q${qx} ${qy} ${lx} ${ly}` }, links);
      svgEl('rect', { class: 'leaf', x: lx - 30, y: ly - 12, width: 60, height: 24, rx: 7 }, nodes);
      svgEl('circle', { class: 'leaf-dot', cx: lx + 19, cy: ly - 4, r: 2 }, nodes);
    }
  }

  svgEl('circle', { class: 'root-ring', r: 44, opacity: 0.2 }, nodes);
  svgEl('circle', { class: 'root-ring', r: 26, opacity: 0.4 }, nodes);
  svgEl('circle', { class: 'root', r: 8 }, nodes);
}

drawHeroNetwork(document.getElementById('hero-net'));

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
