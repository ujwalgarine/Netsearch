// On-device camera analysis for the practice chat (MediaPipe face and hand landmarks, running in this tab).
// Each frame is read from the <video> element, reduced to a few counters, and dropped. Nothing here
// records, stores or uploads video, and the page's CSP only allows requests to this app's own server.

const VENDOR = '/vendor/mediapipe';
const MODELS = '/vendor/models';
const TICK_MS = 125; // face about 8 times a second, hands every other tick

// shortcut: first-pass thresholds, checked against still test photos only. Recalibrate against recorded sessions across webcams, faces and lighting before trusting the Presence scores.
const T = {
  smile: 0.35,   // smile blendshape score that counts as smiling
  lookAway: 0.5, // eye blendshape score that counts as looking away from the screen
  yaw: 0.28,     // nose offset from the eye midline, in face widths, that counts as turned away
  roll: 12,      // degrees of head tilt still counted as upright
  still: 0.06,   // head travel per second, in face widths, below which you are sitting very still
  exprFull: 0.9, // summed facial change per second that maps to 100/100
  gesture: 0.12, // wrist travel per second, in frame widths, that counts as gesturing
};

const blank = () => ({ n: 0, face: 0, smile: 0, facing: 0, upright: 0, still: 0, expr: 0, sec: 0, hn: 0, hands: 0, gesture: 0 });
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const stats = (a) => ({
  facePct: pct(a.face, a.n),
  smilePct: pct(a.smile, a.face),
  expr: Math.min(100, Math.round(((a.sec ? a.expr / a.sec : 0) / T.exprFull) * 100)),
  facingPct: pct(a.facing, a.face),
  stillPct: pct(a.still, a.face),
  uprightPct: pct(a.upright, a.face),
  handsPct: pct(a.hands, a.hn),
  gesturePct: pct(a.gesture, a.hn),
});

export async function startVision(video, onSignal) {
  const { FilesetResolver, FaceLandmarker, HandLandmarker } = await import(`${VENDOR}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${VENDOR}/wasm`);
  // CPU on purpose: about as fast as the GPU path on ordinary laptops, and it avoids the multi-second
  // stalls the GPU path has on machines where the browser falls back to software graphics.
  const create = (Task, file, options) =>
    Task.createFromOptions(fileset, { baseOptions: { modelAssetPath: `${MODELS}/${file}`, delegate: 'CPU' }, runningMode: 'VIDEO', ...options });
  const [faceTask, handTask] = await Promise.all([
    create(FaceLandmarker, 'face_landmarker.task', { numFaces: 1, outputFaceBlendshapes: true }),
    create(HandLandmarker, 'hand_landmarker.task', { numHands: 2 }),
  ]);

  let total = blank();
  let since = performance.now();
  let turn = blank();
  let prevFace = null; // { t, x, y, smile, brow, jaw } in pixels and blendshape scores
  let prevWrists = null; // { t, points }
  let tick = 0;
  let failures = 0;
  const both = (fn) => { fn(total); fn(turn); };

  function readFace(now) {
    const res = faceTask.detectForVideo(video, now);
    const lm = res.faceLandmarks?.[0];
    both((a) => a.n++);
    if (!lm) { prevFace = null; return false; }
    const b = Object.fromEntries((res.faceBlendshapes?.[0]?.categories ?? []).map((c) => [c.categoryName, c.score]));
    const w = video.videoWidth, h = video.videoHeight;
    // Landmarks 33 and 263 are the outer eye corners, 1 is the nose tip.
    const dx = (lm[263].x - lm[33].x) * w, dy = (lm[263].y - lm[33].y) * h;
    const faceW = Math.hypot(dx, dy) || 1;
    const nose = { x: lm[1].x * w, y: lm[1].y * h };
    const smile = ((b.mouthSmileLeft ?? 0) + (b.mouthSmileRight ?? 0)) / 2;
    const brow = ((b.browInnerUp ?? 0) + (b.browOuterUpLeft ?? 0) + (b.browOuterUpRight ?? 0)) / 3;
    const jaw = b.jawOpen ?? 0;
    const look = Math.max(
      ((b.eyeLookOutLeft ?? 0) + (b.eyeLookInRight ?? 0)) / 2,
      ((b.eyeLookInLeft ?? 0) + (b.eyeLookOutRight ?? 0)) / 2,
      ((b.eyeLookUpLeft ?? 0) + (b.eyeLookUpRight ?? 0)) / 2,
      ((b.eyeLookDownLeft ?? 0) + (b.eyeLookDownRight ?? 0)) / 2,
    );
    const yaw = Math.abs(nose.x - ((lm[263].x + lm[33].x) / 2) * w) / faceW;
    const roll = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
    const dt = prevFace ? Math.min(1, (now - prevFace.t) / 1000) : 0;
    const travel = dt ? Math.hypot(nose.x - prevFace.x, nose.y - prevFace.y) / faceW / dt : Infinity;
    const change = dt ? Math.abs(smile - prevFace.smile) + Math.abs(brow - prevFace.brow) + Math.abs(jaw - prevFace.jaw) : 0;
    both((a) => {
      a.face++;
      if (smile > T.smile) a.smile++;
      if (look < T.lookAway && yaw < T.yaw) a.facing++;
      if (roll < T.roll) a.upright++;
      if (travel < T.still) a.still++;
      a.expr += change;
      a.sec += dt;
    });
    prevFace = { t: now, ...nose, smile, brow, jaw };
    return true;
  }

  function readHands(now) {
    const points = (handTask.detectForVideo(video, now).landmarks ?? []).map((hand) => hand[0]); // wrists
    const aspect = video.videoHeight / video.videoWidth;
    const dt = prevWrists ? Math.min(1, (now - prevWrists.t) / 1000) : 0;
    // Hands can swap order between frames, so each wrist is compared with the nearest one from last time.
    const moving = dt > 0 && points.some((p) => {
      const nearest = Math.min(...prevWrists.points.map((q) => Math.hypot(p.x - q.x, (p.y - q.y) * aspect)));
      return nearest / dt > T.gesture && Number.isFinite(nearest);
    });
    both((a) => {
      a.hn++;
      if (points.length) a.hands++;
      if (moving) a.gesture++;
    });
    prevWrists = points.length ? { t: now, points } : null;
    return points.length > 0;
  }

  let handsSeen = false;
  let restUntil = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    if (now < restUntil || video.readyState < 2 || !video.videoWidth) return;
    try {
      const faceSeen = readFace(now);
      if (tick++ % 2 === 0) handsSeen = readHands(now);
      failures = 0;
      onSignal?.({ face: faceSeen, hands: handsSeen });
      // On a slow device, rest for as long as the last pass took so typing and speech stay responsive.
      restUntil = performance.now() + (performance.now() - now);
    } catch (err) {
      // A bad frame is skipped; a detector that keeps failing is switched off instead of looping.
      if (++failures > 20) { clearInterval(timer); onSignal?.({ failed: true }); console.warn('[practice-vision]', err); }
    }
  }, TICK_MS);

  return {
    // Numbers for the stretch since the last call (one side of the conversation), then start a new stretch.
    take() {
      const s = stats(turn);
      turn = blank();
      return s.facePct >= 30 ? { smile: s.smilePct, expr: s.expr, facing: s.facingPct, hands: s.handsPct } : null;
    },
    // fps lets the server leave Presence out when the device was too slow for the motion numbers to mean anything.
    summary: () => ({ on: true, fps: total.n / Math.max(1, (performance.now() - since) / 1000), ...stats(total) }),
    // Forget everything so far; called when the chat starts, since the models warm up on the setup screen.
    reset() { total = blank(); turn = blank(); since = performance.now(); },
    stop() {
      clearInterval(timer);
      faceTask.close();
      handTask.close();
    },
  };
}
