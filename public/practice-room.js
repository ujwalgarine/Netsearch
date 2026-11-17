// The practice room (/app/practice/new?connection=<id>, or /app/practice/<session id> for a past report):
// the conversation, voice in and out, timing, and the report. The server keeps the session; the transcript
// is saved with the report when the chat ends. A chat left before the end is not saved.
// Camera analysis lives in practice-vision.js and is only loaded when the camera is switched on.
// Speech recognition, recording and voices live in practice-voice.js.

import {
  SR, micUnavailable, micErrorText, speechErrorText, isServiceError, rankVoices, voiceLabel, canRecord, recordTurn,
  watchLevel, audioContext, unlockAudio, speakDevice, playAudio, setPlaybackRate, stopSpeaking,
} from '/practice-voice.js';

const $ = (id) => document.getElementById(id);
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const MAX_CHARS = 1200;
const SEND_AFTER_MS = 2200; // quiet time after speech before a spoken reply sends itself
const PAUSE_MS = 1300;      // a gap this long between recognised words counts as a mid-sentence pause
// Chromium runs its own speech recognition alongside a page's microphone stream without trouble.
// Safari may give the microphone to only one of them, so there the level meter is left out.
const CHROMIUM = Boolean(navigator.userAgentData?.brands?.some((b) => /Chromium/.test(b.brand)));

// /app/practice/new starts a chat (with ?connection=<id>, or a sample partner without one);
// /app/practice/<id> shows a saved session's report.
const pageId = decodeURIComponent(location.pathname.split('/')[3] ?? '');
const connectionParam = new URLSearchParams(location.search).get('connection') ?? '';
let sessionId = null;
let setup = { connection: null, basedOn: '', talkingPoints: [] };
const turns = []; // user: { role, text, at, spoken, speakMs, gapMs, pauses, cam }; persona: { role, text, at, interest }
let persona = { name: 'Your practice partner', role: '', voice: '', voiceType: '' };
let first = 'They';
let startedAt = 0;
let personaDoneAt = 0; // when their last reply finished being spoken (or read)
let busy = false;
let ended = false;
let speaking = false;
let clock = 0;
let note = '';         // the latest mic or voice problem, shown in the status line until the next turn

let camStream = null;
let vision = null;

// Hearing the user. 'browser': the browser's own speech recognition. 'server': recorded here, transcribed
// by OpenAI on the server (needs the key; used where the browser has no working recogniser).
let audioOk = false;   // the server has an OpenAI key, so it can transcribe and speak
let srBroken = false;  // the browser's recogniser failed on this device
let hearing = null;
let micOn = false;
let micStream = null;  // held while the mic is on and recordings are needed; released when it goes off
let ear = null;        // the listening session in progress: { stop(), flush?(), speaking? }
let check = null;      // the mic check on the setup screen
let transcribing = false;
let sentAudio = false; // a spoken turn went to the server, so the report's privacy line says so
let sendTimer = 0;
let speechAt = 0;
let draft = newDraft();
function newDraft() { return { startAt: 0, lastAt: 0, pauses: 0, spoken: false }; }
const pickHearing = () => (SR && !srBroken ? 'browser' : audioOk && canRecord() ? 'server' : null);
const inChat = () => startedAt > 0;

// Their voice. choice is "natural:<openai voice>" or "device:<voiceURI>".
const voice = { on: true, choice: '', picked: false, rate: 1, natural: [], naturalOff: '', deviceOff: false, sample: '' };
try { voice.rate = Math.min(1.3, Math.max(0.8, Number(localStorage.getItem('netprep:voice-rate')) || 1)); } catch {}

const signIn = () => location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);

async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
  const res = await fetch(`/api/practice/${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    signIn();
    throw new Error('Your session ended. Sign in again.');
  }
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
  return data;
}

// Where "Practice again" goes: the same connection, a sample partner, or back to the list to pick someone.
function againHref(connection) {
  if (connection?.id) return `/app/practice/new?connection=${encodeURIComponent(connection.id)}`;
  return connection ? '/app/practice' : '/app/practice/new';
}

function show(view) {
  for (const id of ['setup', 'talk', 'report']) $(id).hidden = id !== view;
  $('timer').hidden = $('end').hidden = view !== 'talk';
}

// ---------------------------------------------------------------------------
// Setup: who you are meeting, the two optional permissions, and their voice
// ---------------------------------------------------------------------------

async function init() {
  let r;
  try {
    r = await api(pageId === 'new' ? `setup?connection=${encodeURIComponent(connectionParam)}` : `sessions/${encodeURIComponent(pageId)}`);
  } catch (err) {
    $('notice').textContent = err.message;
    return;
  }
  // A chat left before the end has nothing saved to show, so it starts over with the same person.
  if (pageId !== 'new' && !r.report) return location.replace(againHref(r.connection));
  persona = r.persona;
  setup = { connection: r.connection, basedOn: r.basedOn ?? '', talkingPoints: r.talkingPoints ?? [] };
  audioOk = Boolean(r.audio);
  voice.natural = r.voices ?? [];
  voice.sample = r.sample ?? '';
  $('mode-badge').hidden = !r.mock;
  first = persona.name.split(' ')[0];
  for (const n of document.querySelectorAll('[data-partner]')) {
    n.textContent = { name: persona.name, role: persona.role, initials: persona.name.replace(/[^\p{Lu}]/gu, '').slice(0, 2) }[n.dataset.partner];
  }
  $('again').href = againHref(setup.connection);
  if (r.report) {
    // A saved session: straight to its report.
    sessionId = r.id;
    show('report');
    return renderReport(r.report, { transcript: r.messages ?? [], saved: true, at: r.ended_at || r.created_at });
  }
  $('notice').textContent = setup.basedOn
    ? `${first} is a fictional character played by AI, loosely modeled on the role and background in ${setup.basedOn}'s public profile. ${first} is not ${setup.basedOn}, and nothing said here is something that person said or would say.`
    : `${first} is a fictional character played by AI, not a real person.`;
  for (const t of setup.talkingPoints) $('notes').append(el('li', null, t));
  document.querySelector('.notes').hidden = !$('notes').children.length;
  $('input').placeholder = `Say hello to ${first}…`;
  setupMic();
  setupVoice();
  $('start').disabled = false;
}

const PERM_TEXT = {
  off: 'Off',
  on: 'On',
  checking: 'Checking…',
  blocked: 'Blocked in your browser',
  missing: 'Not available here',
  insecure: 'Needs a secure page',
  unsupported: 'Not supported in this browser',
  nowords: 'Speech to text unavailable',
  failed: 'Analysis could not start on this device',
};
function paintPerm(kind, state) {
  $(`${kind}-state`).textContent = PERM_TEXT[state];
  $(`${kind}-state`).classList.toggle('on', state === 'on');
  $(`${kind}-btn`).textContent = state === 'on' ? `Turn ${kind === 'cam' ? 'camera' : 'microphone'} off` : `Allow ${kind === 'cam' ? 'camera' : 'microphone'}`;
  $(`${kind}-btn`).disabled = ['unsupported', 'insecure', 'nowords', 'checking'].includes(state);
}

// getUserMedia rejects with NotAllowedError when the user (or a policy) says no; anything else means no usable device.
const denied = (err) => (err?.name === 'NotAllowedError' ? 'blocked' : 'missing');

function stopCamera() {
  camStream?.getTracks().forEach((t) => t.stop());
  camStream = null;
  for (const id of ['preview', 'selfview']) $(id).srcObject = null;
  $('preview').hidden = true;
  $('cam-note').hidden = false;
  $('sig-face').hidden = $('sig-hands').hidden = true;
}

$('cam-btn').addEventListener('click', async () => {
  if (camStream) {
    vision?.stop();
    vision = null;
    stopCamera();
    return paintPerm('cam', 'off');
  }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } });
    for (const id of ['preview', 'selfview']) { $(id).srcObject = camStream; $(id).play().catch(() => {}); }
    $('preview').hidden = false;
    $('cam-note').hidden = true;
    paintPerm('cam', 'on');
    loadVision(); // warm the models up now so the chat itself starts without a stall
  } catch (err) {
    paintPerm('cam', denied(err));
  }
});

// ---- Microphone: what can work here, and a check that it actually hears you ----

function setupMic() {
  hearing = pickHearing();
  const blocked = micUnavailable();
  if (blocked) return micFailed(blocked, navigator.mediaDevices ? 'missing' : 'insecure');
  if (!hearing) {
    return micFailed(canRecord() ? "This browser can't turn speech into text by itself. Chrome, Edge and Safari can, or an OpenAI key on the server lets any browser do it. You can still type." : "This browser can't turn speech into text. Try Chrome, Edge or Safari, or type your replies.", 'unsupported');
  }
  paintMicAbout();
}

function paintMicAbout() {
  $('mic-about').textContent = hearing === 'server'
    ? 'Speak your side. While you talk, your voice is recorded on this device, sent to this app’s server and turned into text by OpenAI, then thrown away. Nothing is kept.'
    : 'Speak your side. Your browser turns speech into text; in Chrome and Edge that step runs on the browser maker’s speech service. No audio is sent to or kept by this app.';
}

function micHelp(text, info = false) {
  $('mic-help').textContent = text;
  $('mic-help').hidden = !text;
  $('mic-help').classList.toggle('info', info);
}

async function openMic() {
  if (micStream?.active) return micStream;
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const stream = micStream;
  // Unplugged, or taken away by the system.
  stream.getAudioTracks()[0]?.addEventListener('ended', () => {
    if (micStream === stream && micOn) micFailed('The microphone was disconnected. Plug it back in and switch the mic on again.', 'missing');
  });
  return stream;
}

function closeMic() {
  micStream?.getTracks().forEach((t) => t.stop());
  micStream = null;
}

// The microphone or speech to text stopped working: say exactly why, and leave typing.
function micFailed(text, state = 'blocked') {
  micOn = false;
  stopListening();
  stopMicCheck();
  closeMic();
  if (inChat()) {
    note = text;
    $('mic').hidden = !hearing;
    paintMic();
    paintStatus();
  } else {
    paintPerm('mic', state);
    micHelp(text);
  }
}

// The browser's own speech to text does not work here. Use the server when it can transcribe, otherwise type.
function speechServiceFailed(code) {
  srBroken = true;
  hearing = pickHearing();
  const why = speechErrorText(code);
  if (!hearing) return micFailed(`${why} Type your replies, or try Chrome, Edge or Safari.`, 'nowords');
  stopListening();
  stopMicCheck();
  paintMicAbout();
  const switched = `${why} Your speech is now turned into text on the server instead.`;
  if (inChat()) {
    note = switched;
    listen();
    paintStatus();
  } else {
    micHelp(switched, true);
    openMic().then(startMicCheck, (err) => micFailed(micErrorText(err), denied(err)));
  }
}

$('mic-btn').addEventListener('click', async () => {
  if (!hearing) return;
  if (micOn) {
    micOn = false;
    stopMicCheck();
    closeMic();
    micHelp('');
    return paintPerm('mic', 'off');
  }
  audioContext(); // created inside the click, so the level meter is allowed to run
  paintPerm('mic', 'checking');
  try {
    // Ask here so the browser's prompt appears now, not in the middle of the chat.
    await openMic();
  } catch (err) {
    return micFailed(micErrorText(err), denied(err));
  }
  micOn = true;
  micHelp('');
  paintPerm('mic', 'on');
  startMicCheck();
});

// Shows that the microphone hears you (level bar) and, with the browser's recogniser, which words it heard.
function startMicCheck() {
  stopMicCheck();
  if (!micOn) return;
  const heard = $('mic-heard');
  const stops = [];
  const meter = Boolean(micStream) && (hearing === 'server' || CHROMIUM);
  $('mic-check').hidden = false;
  $('mic-meter').hidden = !meter;
  heard.classList.remove('ok');
  if (meter) stops.push(watchLevel(micStream, (level) => { $('mic-level').style.transform = `scaleX(${Math.min(1, level * 8).toFixed(3)})`; }));
  if (hearing === 'server') {
    heard.textContent = 'Say something: the bar should move. In the chat, your words appear a moment after you pause.';
  } else {
    if (!meter) closeMic(); // let Safari's recogniser have the microphone to itself
    heard.textContent = 'Say a few words to check that it hears you.';
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    let started = false;
    // Some browsers ship the API without a speech service, and then never answer at all.
    const watchdog = setTimeout(() => { if (!started && check?.r === r) speechServiceFailed('silent'); }, 5000);
    r.onstart = () => { started = true; clearTimeout(watchdog); };
    r.onresult = (e) => {
      heard.textContent = `Heard: “${[...e.results].map((x) => x[0].transcript).join('').trim().slice(-120)}”`;
      heard.classList.add('ok');
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted' || check?.r !== r) return;
      if (isServiceError(e.error)) speechServiceFailed(e.error);
      else micFailed(speechErrorText(e.error));
    };
    r.onend = () => { if (check?.r === r) setTimeout(() => { if (check?.r === r) try { r.start(); } catch {} }, 250); };
    stops.push(() => { clearTimeout(watchdog); r.abort(); });
    check = { r, stop: () => stops.forEach((f) => f()) };
    try {
      r.start();
    } catch {
      return speechServiceFailed('start');
    }
    return;
  }
  check = { stop: () => stops.forEach((f) => f()) };
}

function stopMicCheck() {
  const c = check;
  check = null;
  c?.stop();
  $('mic-check').hidden = true;
}

// ---- Their voice: natural (OpenAI) or the best one this device has, plus speed ----

function setupVoice() {
  const can = 'speechSynthesis' in window || voice.natural.length > 0;
  $('voice-out').hidden = !can;
  voice.on = can;
  $('rate').value = String(voice.rate);
  paintRate();
  fillVoices();
  globalThis.speechSynthesis?.addEventListener?.('voiceschanged', fillVoices);
}

function fillVoices() {
  const pick = $('voice-pick');
  const keep = voice.picked ? pick.value : '';
  pick.replaceChildren();
  if (voice.natural.length && !voice.naturalOff) {
    const g = el('optgroup');
    g.label = 'Natural voices (OpenAI)';
    for (const id of voice.natural) g.append(new Option(`${id[0].toUpperCase()}${id.slice(1)}${id === persona.voice ? ` · ${first}’s voice` : ''}`, `natural:${id}`));
    pick.append(g);
  }
  const device = voice.deviceOff ? [] : rankVoices(globalThis.speechSynthesis?.getVoices() ?? [], persona.voiceType).slice(0, 20);
  if (device.length) {
    const g = el('optgroup');
    g.label = 'Voices on this device';
    for (const v of device) g.append(new Option(voiceLabel(v), `device:${v.voiceURI}`));
    pick.append(g);
  }
  if (!pick.options.length) pick.append(new Option('Browser default', 'device:'));
  const values = [...pick.options].map((o) => o.value);
  pick.value = values.includes(keep) ? keep : values.includes(`natural:${persona.voice}`) ? `natural:${persona.voice}` : values[0];
  voice.choice = pick.value;
  paintVoiceState();
}

function paintVoiceState() {
  const natural = voice.choice.startsWith('natural:');
  $('voice-state').textContent = !voice.on ? 'Off' : natural ? 'Natural voice' : 'Device voice';
  $('voice-state').classList.toggle('on', voice.on && natural);
  $('voice-about').textContent = natural
    ? 'Their replies are read out with a natural OpenAI voice. Only their reply text goes to OpenAI to be spoken, and nothing is kept.'
    : voice.natural.length && !voice.naturalOff
      ? 'This is a voice built into your device. The natural voices at the top of the list sound far more lifelike.'
      : `Uses the most natural voice this device has. Edge comes with lifelike “Natural” voices; on a Mac, download an Enhanced or Premium voice in System Settings › Accessibility › Spoken Content, then reload.${audioOk ? '' : ' An OpenAI key on the server unlocks natural voices in any browser.'}`;
}

function paintRate() {
  $('rate-out').textContent = `${voice.rate.toFixed(2)}×`;
}

// A voice problem: on the setup screen it goes under the voice card, in the chat into the status line.
function voiceNote(text) {
  if (inChat()) {
    note = text;
    paintStatus();
  } else {
    $('voice-help').textContent = text;
    $('voice-help').hidden = !text;
  }
}

function deviceVoice() {
  const all = globalThis.speechSynthesis?.getVoices() ?? [];
  const uri = voice.choice.startsWith('device:') ? voice.choice.slice(7) : '';
  return all.find((v) => v.voiceURI === uri) ?? rankVoices(all, persona.voiceType)[0] ?? null;
}

// Resolves true when the natural voice played. 503/400 mean it will not work this session, so stop asking.
async function speakNatural(body) {
  try {
    const res = await fetch('/api/practice/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 401) {
      signIn();
      return false;
    }
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      if (res.status === 503 || res.status === 400) {
        voice.naturalOff = error || 'Natural voices are not available.';
        voice.picked = false;
        fillVoices();
        voiceNote(`${voice.naturalOff} Using this device’s voice instead.`);
      } else {
        voiceNote(`${error || 'The natural voice did not load.'} This reply uses the device voice.`);
      }
      return false;
    }
    const clip = await res.blob();
    if (!voice.on || ended) return true;
    return await playAudio(clip, voice.rate);
  } catch {
    voiceNote('The natural voice did not load. This reply uses the device voice.');
    return false;
  }
}

// Speaks with the chosen voice, falling back to the device. Resolves true if anything was heard.
async function say(text, natural) {
  let ok = false;
  if (voice.choice.startsWith('natural:') && natural) ok = await speakNatural({ ...natural, voice: voice.choice.slice(8) });
  if (!ok && voice.on && !ended && !voice.deviceOff && 'speechSynthesis' in window) {
    ok = await speakDevice(text, { voice: deviceVoice(), rate: voice.rate });
    // Nothing started: this browser has no working voice of its own, so stop waiting on it every turn.
    if (!ok && voice.on && !ended) {
      voice.deviceOff = true;
      fillVoices();
      voiceNote(voice.natural.length && !voice.naturalOff
        ? "This browser's own voices didn't play. The natural voices still work."
        : "This browser didn't play any voice, so their replies are text only. Check the tab isn't muted, or try another browser.");
    }
  }
  return ok;
}

$('voice-pick').addEventListener('change', () => {
  voice.choice = $('voice-pick').value;
  voice.picked = true;
  voiceNote('');
  paintVoiceState();
});

$('rate').addEventListener('input', () => {
  voice.rate = Number($('rate').value);
  setPlaybackRate(voice.rate);
  paintRate();
  try { localStorage.setItem('netprep:voice-rate', String(voice.rate)); } catch {}
});

$('voice-try').addEventListener('click', async () => {
  if (speaking) return;
  unlockAudio();
  stopSpeaking();
  $('voice-try').disabled = true;
  await say(voice.sample || 'Hi, good to finally meet you.', { sample: true, mood: 'warm' });
  $('voice-try').disabled = false;
});

$('start').addEventListener('click', async () => {
  unlockAudio(); // inside the click, so their first reply is allowed to play sound
  // The session starts on the server first, so a failure leaves you on this screen with the mic check still running.
  $('start').disabled = true;
  try {
    ({ id: sessionId } = await api('sessions', { connectionId: setup.connection?.id ?? null }));
  } catch (err) {
    $('notice').textContent = err.message;
    $('start').disabled = false;
    return;
  }
  stopMicCheck();
  if (hearing !== 'server') closeMic(); // the browser's recogniser opens the microphone itself
  $('side-voice').append($('voice-controls'), $('voice-help'));
  voiceNote('');
  show('talk');
  startedAt = performance.now();
  clock = setInterval(() => {
    const s = Math.floor((performance.now() - startedAt) / 1000);
    $('timer').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);
  $('mic').hidden = !hearing || Boolean(micUnavailable());
  paintMic();
  vision?.reset();
  await personaTurn(); // their opening line
});

let visionLoad = null;
function loadVision() {
  visionLoad ??= startAnalysis().finally(() => { visionLoad = null; });
}

async function startAnalysis() {
  $('cam-note').hidden = false;
  $('cam-note').textContent = 'Loading on-device analysis…';
  try {
    const { startVision } = await import('/practice-vision.js');
    const v = await startVision($('selfview'), (s) => {
      if (s.failed) return visionFailed();
      $('sig-face').hidden = $('sig-hands').hidden = false;
      $('sig-face').classList.toggle('on', s.face);
      $('sig-hands').classList.toggle('on', s.hands);
    });
    if (ended || !camStream) return v.stop();
    vision = v;
    $('cam-note').hidden = true;
  } catch (err) {
    console.warn('[practice] camera analysis unavailable:', err);
    visionFailed();
  }
}

function visionFailed() {
  vision?.stop();
  vision = null;
  stopCamera();
  paintPerm('cam', 'failed');
  $('cam-note').textContent = 'Camera analysis could not start on this device, so the camera was turned off. Presence will not be graded.';
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

const input = $('input');
const messages = $('messages');

function addMsg(role, text) {
  messages.querySelector('.latest')?.classList.remove('latest');
  const m = el('div', role === 'user' ? 'msg user' : 'msg assistant latest', text);
  messages.append(m);
  messages.scrollTop = messages.scrollHeight;
  return m;
}

function paintStatus() {
  const listening = ear ? 'Listening. Pause when you are done and it sends itself.' : '';
  $('status').textContent = ended ? ''
    : busy && speaking ? `${first} is speaking`
    : busy ? `${first} is thinking`
    : transcribing ? 'Turning your speech into text…'
    : note ? `${note}${listening ? ' Listening now.' : ''}`
    : listening || (hearing && !micUnavailable() ? 'Type your reply, or switch on the mic.' : 'Type your reply.');
  $('send').disabled = busy || ended || transcribing;
}

function autosize() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

async function send() {
  clearTimeout(sendTimer);
  if (transcribing) return;
  // Words are still being recorded for the server: finish the recording, and its transcript sends the turn.
  if (ear?.flush && ear.speaking) return ear.flush();
  const text = input.value.trim().slice(0, MAX_CHARS);
  if (!text || busy || ended) return;
  const start = draft.startAt || performance.now();
  turns.push({
    role: 'user',
    text,
    at: (start - startedAt) / 1000,
    spoken: draft.spoken,
    speakMs: draft.spoken ? Math.max(0, draft.lastAt - start) : 0,
    gapMs: Math.max(0, start - personaDoneAt),
    pauses: draft.pauses,
    cam: vision?.take() ?? null,
  });
  draft = newDraft();
  note = '';
  input.value = '';
  autosize();
  stopListening();
  addMsg('user', text);
  $('end').disabled = false;
  await personaTurn();
}

async function personaTurn() {
  busy = true;
  paintStatus();
  const thinking = el('div', 'msg thinking');
  thinking.append(el('span', 'dots'));
  thinking.firstChild.append(el('i'), el('i'), el('i'));
  messages.append(thinking);
  messages.scrollTop = messages.scrollHeight;
  try {
    const r = await api(`sessions/${sessionId}/reply`, { messages: turns.map(({ role, text }) => ({ role, text })) });
    thinking.remove();
    if (ended) return; // the user ended the chat while this reply was on its way
    turns.push({ role: 'persona', text: r.reply, at: (performance.now() - startedAt) / 1000, interest: r.interest });
    addMsg('persona', r.reply);
    await speak(r.reply, r.mood, r.sig);
    vision?.take(); // the camera numbers from here on belong to the user's next turn
    if (r.end) {
      $('end').disabled = false;
      return finish();
    }
  } catch (err) {
    thinking.remove();
    const box = el('div', 'msg error', `${err.message} `);
    const retry = el('button', 'retry', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', () => { box.remove(); personaTurn(); });
    box.append(retry);
    messages.append(box);
  } finally {
    busy = false;
    paintStatus();
  }
  listen();
  if (!micOn) input.focus();
}

$('composer').addEventListener('submit', (e) => { e.preventDefault(); send(); });
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
input.addEventListener('input', () => {
  if (!draft.startAt) draft.startAt = performance.now();
  autosize();
});

// ---------------------------------------------------------------------------
// Voice in the chat
// ---------------------------------------------------------------------------

async function speak(text, mood, sig) {
  let ok = false;
  if (voice.on) {
    speaking = true;
    paintStatus();
    ok = await say(text, sig && { text, sig, mood });
    speaking = false;
  }
  // Replies that were not heard still need reading time before a slow answer counts as a silence.
  personaDoneAt = performance.now() + (ok ? 0 : Math.min(6000, text.split(/\s+/).length * 220));
}

$('voice-out').addEventListener('click', () => {
  voice.on = !voice.on;
  $('voice-out').textContent = `Their voice · ${voice.on ? 'On' : 'Off'}`;
  $('voice-out').setAttribute('aria-pressed', String(voice.on));
  if (!voice.on) stopSpeaking();
  paintVoiceState();
});

function paintMic() {
  $('mic').setAttribute('aria-pressed', String(micOn));
  $('mic').title = micOn ? 'Microphone on. Click to mute.' : 'Microphone off. Click to talk.';
}

$('mic').addEventListener('click', async () => {
  if (!hearing) return;
  if (micOn) {
    micOn = false;
    stopListening();
    closeMic();
    paintMic();
    return paintStatus();
  }
  audioContext();
  note = '';
  try {
    await openMic(); // the permission prompt, if any, comes now and its answer gets a clear message
  } catch (err) {
    return micFailed(micErrorText(err));
  }
  if (hearing !== 'server') closeMic();
  micOn = true;
  paintMic();
  listen();
  paintStatus();
});

function heardVoice(now, startAt) {
  if (!draft.startAt || !draft.spoken) draft.startAt = startAt;
  draft.spoken = true;
  if (draft.lastAt && now - draft.lastAt > PAUSE_MS) draft.pauses++;
  draft.lastAt = now;
}

function listen() {
  if (!micOn || !hearing || busy || ended || ear || transcribing) return;
  if (hearing === 'server') listenServer();
  else listenBrowser();
  paintStatus();
}

function listenBrowser() {
  const r = new SR();
  r.continuous = true;
  r.interimResults = true;
  r.lang = 'en-US';
  const typed = input.value ? `${input.value.trim()} ` : '';
  let started = false;
  // Some browsers ship the API without a speech service, and then never answer at all.
  const watchdog = setTimeout(() => { if (!started && ear?.r === r) speechServiceFailed('silent'); }, 5000);
  r.onstart = () => { started = true; clearTimeout(watchdog); };
  r.onspeechstart = () => { speechAt = performance.now(); };
  r.onresult = (e) => {
    const now = performance.now();
    // Speech began at the last "speech started" signal if it was recent, otherwise just before this first result.
    heardVoice(now, now - speechAt < 3000 ? speechAt : now - 400);
    input.value = (typed + [...e.results].map((x) => x[0].transcript).join('')).slice(0, MAX_CHARS);
    autosize();
    clearTimeout(sendTimer);
    sendTimer = setTimeout(send, SEND_AFTER_MS);
  };
  r.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted' || ear?.r !== r) return;
    clearTimeout(watchdog);
    if (isServiceError(e.error)) speechServiceFailed(e.error);
    else micFailed(speechErrorText(e.error));
  };
  // Browsers end a recognition session on their own after a while; pick it back up while the mic is on.
  r.onend = () => {
    clearTimeout(watchdog);
    if (ear?.r === r) { ear = null; setTimeout(listen, 250); }
  };
  ear = { r, stop: () => r.abort() };
  try {
    r.start();
  } catch {
    clearTimeout(watchdog);
    speechServiceFailed('start');
  }
}

// Records one turn here, then has the server turn it into text.
async function listenServer() {
  const me = { stop() {} };
  ear = me;
  let stream;
  try {
    stream = await openMic();
  } catch (err) {
    if (ear === me) ear = null;
    return micFailed(micErrorText(err));
  }
  if (ear !== me) return; // muted while the microphone was opening
  const typed = input.value ? `${input.value.trim()} ` : '';
  const take = recordTurn(stream, {
    quietMs: SEND_AFTER_MS,
    onVoice: heardVoice,
    onLevel: (level) => $('mic').style.setProperty('--level', Math.min(1, level * 10).toFixed(2)),
  });
  me.stop = () => take.stop(false);
  me.flush = () => take.stop(true);
  Object.defineProperty(me, 'speaking', { get: () => take.speaking });
  const clip = await take.result;
  $('mic').style.removeProperty('--level');
  if (!clip || ear !== me) return; // muted, sent as typed, or the chat ended
  ear = null;
  transcribing = true;
  sentAudio = true;
  paintStatus();
  let text = '';
  try {
    const res = await fetch('/api/practice/transcribe', { method: 'POST', headers: { 'Content-Type': clip.type || 'audio/webm' }, body: clip });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) return signIn();
    if (res.status === 503) {
      transcribing = false;
      hearing = null;
      return micFailed(`${data.error || 'Server transcription is not available.'} Type your replies instead.`);
    }
    if (!res.ok) throw new Error(data.error || 'Your speech could not be turned into text.');
    text = String(data.text ?? '').trim();
    if (!text) note = "Didn't catch any words that time. Try again, a little closer to the mic.";
  } catch (err) {
    note = `${err.message} Try again, or type.`;
  } finally {
    transcribing = false;
  }
  if (text && !ended) {
    input.value = (typed + text).slice(0, MAX_CHARS);
    autosize();
    return send();
  }
  if (!input.value.trim()) draft = newDraft();
  paintStatus();
  listen();
}

function stopListening() {
  clearTimeout(sendTimer);
  const e = ear;
  ear = null;
  e?.stop();
  $('mic').style.removeProperty('--level');
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

async function finish() {
  if (ended) return;
  ended = true;
  stopListening();
  stopSpeaking();
  micOn = false;
  closeMic();
  clearInterval(clock);
  const camera = vision ? vision.summary() : { on: false };
  vision?.stop();
  vision = null;
  stopCamera();
  show('report');
  loadReport(camera, Math.round((performance.now() - startedAt) / 1000));
}

async function loadReport(camera, durationSec) {
  const loading = $('report-loading');
  loading.replaceChildren(el('span', 'dots'), el('span', 'label', 'Writing your feedback'));
  loading.firstChild.append(el('i'), el('i'), el('i'));
  try {
    const report = await api(`sessions/${sessionId}/report`, { turns, camera, durationSec });
    history.replaceState(null, '', `/app/practice/${sessionId}`); // a reload now shows this saved report
    renderReport(report, { transcript: turns.map((t) => ({ role: t.role === 'user' ? 'user' : 'assistant', content: t.text })) });
  } catch (err) {
    const retry = el('button', 'retry', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', () => loadReport(camera, durationSec));
    loading.replaceChildren(el('span', 'msg error', `${err.message} `), retry);
  }
}

const svg = (tag, attrs) => {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const clockTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function renderReport(r, { transcript = [], saved = false, at = '' } = {}) {
  $('report-loading').hidden = true;
  $('report-body').hidden = false;

  // Overall: the radial tick gauge from the design system, lit up to the score.
  const g = svg('svg', { viewBox: '0 0 200 200', role: 'img', 'aria-label': `Overall grade ${r.overall.grade}, ${r.overall.score} out of 100` });
  for (let i = 0; i < 60; i++) {
    const a = (i * 6 - 90) * (Math.PI / 180);
    g.append(svg('line', {
      x1: 100 + Math.cos(a) * 80, y1: 100 + Math.sin(a) * 80, x2: 100 + Math.cos(a) * 92, y2: 100 + Math.sin(a) * 92,
      class: i < Math.round(r.overall.score * 0.6) ? 'tick on' : 'tick',
    }));
  }
  const grade = svg('text', { x: 100, y: 108, class: 'gauge-grade' });
  grade.textContent = r.overall.grade;
  const score = svg('text', { x: 100, y: 136, class: 'gauge-score' });
  score.textContent = `${r.overall.score} / 100`;
  g.append(grade, score);
  $('gauge').replaceChildren(g);

  $('r-meta').textContent = [
    ...(saved && at ? [new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })] : []),
    clockTime(r.stats.durationSec),
    `${r.stats.userTurns} turn${r.stats.userTurns === 1 ? '' : 's'}`,
    r.stats.spokenTurns ? 'Spoken' : 'Typed',
    r.stats.camera ? 'Camera on' : 'Camera off',
    r.written === 'model' ? 'Feedback written by AI' : 'Feedback from built-in rules',
  ].join(' · ');
  $('r-summary').textContent = r.summary;
  $('r-caveat').hidden = !r.short;
  $('r-tips').replaceChildren(...r.tips.map((t) => el('li', null, t)));
  $('r-privacy').textContent = `This report and the transcript are saved to your account under Practice, where you can delete them. No video left your device. ${saved ? ''
    : sentAudio ? 'Your spoken turns went through this app’s server to OpenAI to be turned into text; the recordings were not kept. '
    : 'No audio left your device through this app. '}Camera-based scores are rough estimates meant for practice, not a judgment of you.`;

  $('r-transcript').replaceChildren(...transcript.map((m) => {
    const li = el('li', m.role === 'user' ? 'line user' : 'line');
    li.append(el('span', 'label', m.role === 'user' ? 'You' : first), el('span', null, m.content));
    return li;
  }));
  $('r-transcript-box').hidden = !transcript.length;

  const groups = $('r-metrics');
  groups.replaceChildren();
  for (const name of [...new Set(r.metrics.map((m) => m.group))]) {
    const section = el('section');
    const grid = el('div', 'metric-grid');
    section.append(el('h2', 'label r-h', name), grid);
    for (const m of r.metrics.filter((x) => x.group === name)) {
      const card = el('div', m.score == null ? 'metric off' : 'metric');
      const head = el('div', 'metric-head');
      head.append(el('span', 'label', m.label), el('span', 'metric-score', m.score == null ? '—' : String(m.score)));
      const bar = el('div', 'bar');
      const fill = el('i');
      fill.style.width = `${m.score ?? 0}%`;
      bar.append(fill);
      card.append(head, el('p', 'metric-value', m.value), bar, el('p', 'metric-note', m.note));
      grid.append(card);
    }
    groups.append(section);
  }

  // Interest sparkline: one dot per reply of theirs, 0 at the bottom and 100 at the top.
  const pts = r.interest.map((v, i) => [r.interest.length > 1 ? 10 + (i * 280) / (r.interest.length - 1) : 150, 70 - v * 0.6]);
  const s = svg('svg', { viewBox: '0 0 300 80', role: 'img', 'aria-label': `Their interest went from ${r.interest[0] ?? 50} to ${r.interest.at(-1) ?? 50} out of 100` });
  s.append(svg('line', { x1: 10, y1: 40, x2: 290, y2: 40, class: 'spark-mid' }));
  if (pts.length > 1) s.append(svg('polyline', { points: pts.map((p) => p.join(',')).join(' '), class: 'spark-line' }));
  pts.forEach(([x, y], i) => s.append(svg('circle', { cx: x, cy: y, r: i === pts.length - 1 ? 4 : 2.5, class: i === pts.length - 1 ? 'spark-dot last' : 'spark-dot' })));
  $('r-spark').replaceChildren(s, el('p', 'fine', 'Hidden during the chat. The line in the middle is polite neutral.'));

  $('r-moments').replaceChildren(
    ...(r.moments.length ? r.moments : [{ at: 0, kind: 'up', note: 'No single moment stood out. A longer chat gives this more to work with.' }]).map((m) => {
      const li = el('li', `moment ${m.kind}`);
      li.append(el('span', 'moment-at', clockTime(m.at)), el('span', null, m.note));
      return li;
    }),
  );
  $('report').scrollTop = 0;
}

$('end').addEventListener('click', finish);

init();
