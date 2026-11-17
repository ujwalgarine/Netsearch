// Voice in and out for the practice chat, kept apart from the conversation logic in practice-room.js.
// Hearing the user: the browser's own speech recognition (live words, free) or, when the server has
// an OpenAI key, a recording made here and transcribed there (works in any browser).
// Speaking for the character: OpenAI's natural voices (key) or the most natural voice this device has.
// Nothing in this file runs on import, so the pure parts can be tested in Node.

export const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

// ---------------------------------------------------------------------------
// Why the microphone can't be used, in words a person can act on
// ---------------------------------------------------------------------------

// null when the page is allowed to ask for the microphone at all.
export function micUnavailable() {
  if (!globalThis.isSecureContext) {
    const port = location.port ? `:${location.port}` : '';
    return `Browsers only allow the microphone on secure pages, and this one is plain http from another address. Open http://localhost${port}/app/practice on the computer running the app, or serve the app over HTTPS.`;
  }
  if (!navigator.mediaDevices?.getUserMedia) return 'This browser does not let web pages use the microphone.';
  return null;
}

// getUserMedia failures.
export function micErrorText(err) {
  const name = err?.name ?? '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    if (/system/i.test(err?.message ?? '')) {
      return "Your computer is blocking the browser from the microphone. On a Mac: System Settings › Privacy & Security › Microphone, switch your browser on, then restart it. On Windows: Settings › Privacy & security › Microphone, and allow desktop apps.";
    }
    return 'The browser is blocking the microphone for this page. Click the icon at the left end of the address bar, set Microphone to Allow, then reload the page.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found. Plug one in or choose one in your sound settings, then try again.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The microphone would not start. Another app (Zoom, Teams, Discord) may be using it. Close that app and try again.';
  if (name === 'SecurityError' || name === 'TypeError') return micUnavailable() ?? 'This page is not allowed to use the microphone.';
  return `The microphone would not start (${name || err?.message || 'unknown error'}).`;
}

// Speech recognition errors that mean the browser's speech service itself is not working,
// as opposed to the microphone or the permission. Brave, Opera, Vivaldi and most in-app browsers
// ship the API without the service behind it.
const SERVICE = {
  network: "Your browser's speech-to-text service can't be reached. Brave, Opera, Vivaldi and in-app browsers don't include one, and some networks block it.",
  'service-not-allowed': "Your browser's speech-to-text is switched off. In Safari, turn on Dictation in System Settings › Keyboard.",
  'language-not-supported': "Your browser's speech-to-text doesn't offer US English here.",
  silent: "Your browser's speech-to-text never started listening. Brave, Opera, Vivaldi and in-app browsers often ship it switched off.",
  start: "Your browser's speech-to-text refused to start.",
};
export const isServiceError = (code) => code in SERVICE;

export function speechErrorText(code) {
  if (SERVICE[code]) return SERVICE[code];
  if (code === 'not-allowed') return micErrorText({ name: 'NotAllowedError' });
  if (code === 'audio-capture') return micErrorText({ name: 'NotFoundError' });
  return `Speech to text stopped (${code}).`;
}

// ---------------------------------------------------------------------------
// Device voices: rank what the browser offers so the default is the least robotic one
// ---------------------------------------------------------------------------

// macOS novelty voices and the old Eloquence set: fun, but nobody sounds like that over coffee.
const NOVELTY = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|fred|kathy|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;
const NATURAL = /\b(natural|neural|premium|enhanced|wavenet|journey|studio)\b/i;
const FEMALE = /\b(female|samantha|ava|allison|zoe|susan|serena|karen|moira|tessa|fiona|victoria|kate|joelle|noelle|nicky|aria|jenny|michelle|ana|emma|sonia|libby|natasha|clara|zira|hazel|catherine|veena|google us english)\b/i;
const MALE = /\b(male|alex|tom|evan|nathan|aaron|daniel|oliver|arthur|gordon|rishi|lee|guy|christopher|eric|roger|steffan|brian|andrew|ryan|william|liam|david|mark|george)\b/i;
const kindOf = (name) => (FEMALE.test(name) ? 'female' : MALE.test(name) ? 'male' : '');

export function scoreVoice(v, want = '') {
  const name = v.name ?? '';
  const id = `${name} ${v.voiceURI ?? ''}`;
  if (!/^en([-_]|$)/i.test(v.lang ?? '') || NOVELTY.test(name)) return -Infinity;
  let s = 0;
  if (NATURAL.test(id)) s += 60;                 // Edge's "Online (Natural)", Apple's Enhanced and Premium
  else if (/^google\b/i.test(name)) s += 40;     // Chrome's network voices: smooth, if a little flat
  else if (/^microsoft\b/i.test(name)) s -= 20;  // the old Windows desktop voices (David, Zira, Mark)
  if (/espeak|mbrola|festival|pico/i.test(id)) s -= 50;
  if (/compact/i.test(id)) s -= 10;
  if (v.localService === false) s += 5;
  if (/^en[-_]us$/i.test(v.lang)) s += 4;
  else if (/^en[-_](gb|au|ca|ie|nz)$/i.test(v.lang)) s += 2;
  if (want && kindOf(name) === want) s += 25;    // keep the character's voice the same kind across devices
  return s;
}

export const rankVoices = (voices, want) =>
  voices.map((v) => [v, scoreVoice(v, want)]).filter(([, s]) => s > -Infinity).sort((a, b) => b[1] - a[1]).map(([v]) => v);

const REGION = { US: 'US', GB: 'UK', AU: 'Australia', CA: 'Canada', IE: 'Ireland', IN: 'India', NZ: 'New Zealand', ZA: 'South Africa', SG: 'Singapore' };
export function voiceLabel(v) {
  const name = v.name.replace(/^Microsoft\s+/, '').replace(/\s+Online\s+\(Natural\)/, ' (Natural)').replace(/\s+-\s+English.*$/, '');
  const region = REGION[(v.lang.split(/[-_]/)[1] ?? '').toUpperCase()];
  return region && !name.includes(region) ? `${name} · ${region}` : name;
}

// ---------------------------------------------------------------------------
// Speaking
// ---------------------------------------------------------------------------

// Chrome forgets utterances nothing references and then never fires their end event,
// which used to leave the chat stuck on "is speaking" (and the mic off) for up to half a minute.
const live = new Set();

// Resolves true once the device has finished speaking, false if it never started.
export function speakDevice(text, { voice, rate = 1 }) {
  return new Promise((resolve) => {
    const synth = globalThis.speechSynthesis;
    if (!synth) return resolve(false);
    // One utterance per sentence: Chrome's network voices stop dead after about 15 seconds.
    const parts = text.replace(/([.!?]["')\]]?)\s+/g, '$1\n').split('\n').filter((p) => p.trim());
    let left = parts.length;
    let started = false;
    let finished = false;
    const finish = (ok) => {
      if (finished) return;
      finished = true;
      clearTimeout(noStart);
      clearTimeout(cap);
      resolve(ok);
    };
    if (synth.speaking || synth.pending) synth.cancel();
    synth.resume(); // Chrome can be left paused by a tab switch
    for (const p of parts) {
      const u = new SpeechSynthesisUtterance(p);
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? 'en-US';
      u.rate = rate;
      u.onstart = () => { started = true; };
      u.onend = u.onerror = () => {
        live.delete(u);
        if (--left <= 0) finish(started);
      };
      live.add(u);
      synth.speak(u);
    }
    const noStart = setTimeout(() => { if (!started) { synth.cancel(); finish(false); } }, 4000);
    const cap = setTimeout(() => finish(true), 3000 + (text.split(/\s+/).length * 450) / rate);
  });
}

// One audio element, unlocked by the Start tap and reused for every reply (Safari blocks new ones).
let player = null;
let stopPlayer = null;
let playing = 0; // bumped by stopSpeaking, so a clip that was still loading does not start afterwards
function silence() {
  const b = new DataView(new ArrayBuffer(46));
  [..."RIFF"].forEach((c, i) => b.setUint8(i, c.charCodeAt(0)));
  b.setUint32(4, 38, true);
  [..."WAVEfmt "].forEach((c, i) => b.setUint8(8 + i, c.charCodeAt(0)));
  b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, 8000, true); b.setUint32(28, 16000, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true);
  [..."data"].forEach((c, i) => b.setUint8(36 + i, c.charCodeAt(0)));
  b.setUint32(40, 2, true);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}

// Call from a click: lets later replies play sound without one.
export function unlockAudio() {
  player ??= new Audio();
  if (!player.src) { player.src = silence(); player.play().catch(() => {}); }
  audioContext();
  const synth = globalThis.speechSynthesis;
  if (synth && !synth.speaking) synth.speak(new SpeechSynthesisUtterance(''));
}

// Resolves true when the clip played to the end (or was stopped), false if the browser refused to play it.
export async function playAudio(blob, rate = 1) {
  player ??= new Audio();
  const url = URL.createObjectURL(blob);
  const mine = ++playing;
  try {
    player.src = url;
    player.preservesPitch = true;
    player.defaultPlaybackRate = player.playbackRate = rate;
    await player.play();
  } catch {
    URL.revokeObjectURL(url);
    return false;
  }
  if (mine !== playing) {
    player.pause();
    URL.revokeObjectURL(url);
    return true;
  }
  await new Promise((resolve) => {
    const cap = setTimeout(done, ((Number.isFinite(player.duration) ? player.duration : 30) / rate) * 1000 + 3000);
    function done() {
      clearTimeout(cap);
      player.onended = player.onpause = player.onerror = stopPlayer = null;
      resolve();
    }
    player.onended = player.onpause = player.onerror = stopPlayer = done;
  });
  URL.revokeObjectURL(url);
  return true;
}

export function setPlaybackRate(rate) {
  if (player) player.playbackRate = rate;
}

export function stopSpeaking() {
  playing++;
  if (stopPlayer) player.pause();
  if (globalThis.speechSynthesis?.speaking || globalThis.speechSynthesis?.pending) speechSynthesis.cancel();
}

// ---------------------------------------------------------------------------
// Hearing: microphone level, and recording one spoken turn for the server
// ---------------------------------------------------------------------------

let ctx = null;
// Create (or wake) the audio context inside a click, or browsers keep it silent.
export function audioContext() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Calls onFrame(level, now) about 20 times a second; level is RMS from 0 to 1. Returns a stop function.
export function watchLevel(stream, onFrame) {
  const c = audioContext();
  if (!c) return () => {};
  const src = c.createMediaStreamSource(stream);
  const an = c.createAnalyser();
  an.fftSize = 1024;
  src.connect(an);
  const buf = new Float32Array(an.fftSize);
  const t = setInterval(() => {
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const x of buf) sum += x * x;
    onFrame(Math.sqrt(sum / buf.length), performance.now());
  }, 50);
  return () => { clearInterval(t); src.disconnect(); };
}

const RECORD_TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
export const canRecord = () => typeof MediaRecorder === 'function' && RECORD_TYPES.some((t) => MediaRecorder.isTypeSupported(t));

// Records one spoken turn: waits for a voice, keeps going through short pauses, and ends after
// quietMs of silence. onVoice(now, startedAt) fires for every moment of voice once speech has begun.
// result resolves to the audio Blob, or null when stopped without keeping it.
export function recordTurn(stream, { quietMs, onVoice, onLevel, maxMs = 45000 }) {
  const type = RECORD_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  let rec;
  let chunks;
  let began = 0;
  const begin = () => {
    const mine = [];
    chunks = mine;
    rec = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: 32000 });
    rec.ondataavailable = (e) => { if (e.data.size) mine.push(e.data); };
    rec.start(1000);
    began = performance.now();
  };
  begin();

  let floor = 1;      // the room's quiet level, followed slowly upward and instantly downward
  let runMs = 0;      // voice in the current run, before speech counts as started
  let firstAt = 0;
  let lastAt = 0;
  let speaking = false;
  let finish;
  const result = new Promise((resolve) => {
    finish = (keep) => {
      if (!finish) return;
      finish = null;
      stopWatch();
      const r = rec;
      if (r.state === 'inactive') return resolve(null);
      r.onstop = () => resolve(keep && speaking ? new Blob(chunks, { type: r.mimeType || type }) : null);
      r.stop();
    };
  });

  const stopWatch = watchLevel(stream, (level, now) => {
    floor = level < floor ? level : Math.min(level, floor * 1.01 + 0.00005);
    const voiced = level > Math.max(0.012, floor * 3);
    onLevel?.(level, voiced);
    if (voiced) {
      if (!speaking && now - lastAt > 400) { runMs = 0; firstAt = now; }
      runMs += 50;
      lastAt = now;
      if (!speaking && runMs >= 250) speaking = true;
      if (speaking) onVoice?.(now, firstAt);
    }
    if (speaking && now - lastAt > quietMs) finish?.(true);
    else if (speaking && now - began > maxMs) finish?.(true);
    // Nothing said for a while: start a fresh file so a long silence is not uploaded later.
    else if (!speaking && now - began > 20000) { rec.onstop = null; rec.stop(); begin(); }
  });

  return { result, stop: (keep = false) => finish?.(keep), get speaking() { return speaking; } };
}
