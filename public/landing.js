// Landing page behavior below the hero: compact nav, scroll reveals, the typing demo, session state.
// The hero itself lives in landing-hero.js. No scroll listeners: everything is IntersectionObserver.

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Closing banner: white dots drifting over a strip of the hero's sky.
window.DotField(document.getElementById('banner-field'), {
  gap: 12, crest: 0.62, spread: 0.2, rest: 0.14, ink: [255, 255, 255], crestInk: [255, 255, 255],
});

// ---------------------------------------------------------------------------
// Compact nav: slides in once the hero is out of view; active link follows the section in view
// ---------------------------------------------------------------------------

const stickyNav = document.querySelector('.stickynav');
const hero = document.getElementById('hero');
new IntersectionObserver(([entry]) => {
  const show = !entry.isIntersecting;
  stickyNav.classList.toggle('show', show);
  stickyNav.inert = !show; // keep it out of the tab order while hidden
}, { threshold: 0.05 }).observe(hero);

const navLinks = [...stickyNav.querySelectorAll('.nav-links a')];
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

// Signed in: CTAs open the app and the navs offer "Open app" instead of sign in / sign up.
fetch('/api/auth/session')
  .then((r) => (r.ok ? r.json() : { signedIn: false }))
  .then(({ signedIn }) => {
    if (!signedIn) return;
    document.querySelectorAll('[data-cta]').forEach((a) => { a.href = '/app'; });
    document.querySelectorAll('[data-guest]').forEach((el) => { el.hidden = true; });
    document.querySelectorAll('[data-user]').forEach((el) => { el.hidden = false; });
    const heroBtn = document.querySelector('[data-guest-btn]');
    if (heroBtn) {
      heroBtn.href = '/app';
      heroBtn.textContent = 'Open app';
    }
  })
  .catch(() => {});
