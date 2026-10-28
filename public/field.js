// Dot-matrix wave field (design.md 5.3): a grid of small dots that swells into a slow,
// drifting wave. Shared by the landing page and the app's map background.
// Pauses when off screen or in a background tab; draws one still frame under reduced motion.

(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  window.DotField = function DotField(canvas, options = {}) {
    const o = {
      gap: 14,        // px between dots
      base: 1.1,      // dot size at rest
      swell: 1.9,     // extra size at the crest
      crest: 0.62,    // vertical position of the wave crest, 0 (top) to 1 (bottom)
      spread: 0.16,   // how tall the swollen band is
      speed: 1,       // 1 = one slow drift loop in about 20s
      rest: 0.09,     // dot opacity away from the crest
      ...options,
    };
    const ctx = canvas.getContext('2d');
    let width = 0;
    let height = 0;
    let frame = 0;
    let onScreen = true;
    let last = 0;
    const start = performance.now();

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(performance.now());
    }

    function draw(now) {
      // t loops roughly every 20 seconds at speed 1.
      const t = ((now - start) / 20000) * Math.PI * 2 * o.speed;
      ctx.clearRect(0, 0, width, height);
      const s2 = 2 * o.spread * o.spread;
      for (let y = o.gap / 2; y < height; y += o.gap) {
        const ny = y / height;
        for (let x = o.gap / 2; x < width; x += o.gap) {
          const nx = x / width;
          // The crest line meanders sideways and drifts over time.
          const crestY = o.crest + 0.09 * Math.sin(nx * 5.2 + t) + 0.05 * Math.sin(nx * 11 - t * 2);
          const band = Math.exp(-((ny - crestY) ** 2) / s2);
          const ripple = 0.65 + 0.35 * Math.sin(nx * 38 - t * 3 + ny * 9);
          const k = band * ripple;
          const r = o.base + o.swell * k;
          if (k > 0.55) {
            // Near the crest, dots pick up a little moss-lime (signal-dim, not full signal).
            ctx.fillStyle = `rgba(143, 174, 79, ${0.25 + 0.55 * k})`;
          } else {
            ctx.fillStyle = `rgba(230, 240, 210, ${o.rest + 0.3 * k})`;
          }
          ctx.fillRect(x - r / 2, y - r / 2, r, r);
        }
      }
    }

    function loop(now) {
      frame = requestAnimationFrame(loop);
      if (now - last < 33) return; // about 30fps is plenty for a slow drift
      last = now;
      draw(now);
    }

    function sync() {
      cancelAnimationFrame(frame);
      if (onScreen && !document.hidden && !reduceMotion.matches) frame = requestAnimationFrame(loop);
    }

    new ResizeObserver(resize).observe(canvas);
    new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      sync();
    }).observe(canvas);
    document.addEventListener('visibilitychange', sync);
    reduceMotion.addEventListener?.('change', sync);
    resize();
    sync();
  };
})();
