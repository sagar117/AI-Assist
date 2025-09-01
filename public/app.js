// public/app.js — Auto-voice with calibrated VAD & per‑utterance recording
const player = document.getElementById('player');
const logBox = document.getElementById('log');
const promptSel = document.getElementById('prompt');
const userIdInput = document.getElementById('userId');

let stream;
let audioCtx, analyser, micSource;
let rafId = null;
let activated = false;
let audioPlaying = false;

// VAD config
const CHECK_INTERVAL_MS = 50;
const MIN_SPEECH_MS = 250;           // need at least this much to count as speech
const END_SILENCE_MS = 800;          // gap to end the utterance
const MIN_RMS_FLOOR = 0.02;          // absolute lower bound
let RMS_THRESHOLD = 0.04;            // will be calibrated at runtime

// VAD state
let speechActive = false;
let framesAbove = 0;
let framesBelow = 0;

// Per-utterance recorder to ensure valid containers
let utterRecorder = null;
let utterChunks = [];
let utterMime = 'audio/webm';

function log(msg) {
  logBox.textContent += `${msg}\n`;
  logBox.scrollTop = logBox.scrollHeight;
}

(function secureCheck() {
  const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (location.protocol !== 'https:' && !isLocalhost) {
    log('⚠️ Mic requires secure origin. Use HTTPS or SSH tunnel to http://localhost:3000');
  }
})();

function pickMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/wav'
  ];
  if (!('MediaRecorder' in window) || !MediaRecorder.isTypeSupported) return null;
  for (const t of candidates) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch {}
  }
  return null;
}

async function fetchPrompts() {
  try {
    const res = await fetch('/api/prompts');
    const { prompts } = await res.json();
    promptSel.innerHTML = '';
    for (const p of prompts) {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      promptSel.appendChild(opt);
    }
    const defIdx = prompts.indexOf('default');
    if (defIdx >= 0) promptSel.selectedIndex = defIdx;
  } catch (e) {
    log(`Error loading prompts: ${e.message}`);
  }
}
fetchPrompts();

async function initMic() {
  if (activated) return;
  activated = true;

  // Greet
  try {
    const greetText = 'Hi, I am the Valeo assistant. How can I help you today?';
    const r = await fetch('/api/tts?text=' + encodeURIComponent(greetText));
    if (r.ok) {
      const { audioBase64, audioMime } = await r.json();
      const buf = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
      const audioBlob = new Blob([buf], { type: audioMime || 'audio/mpeg' });
      const url = URL.createObjectURL(audioBlob);
      player.src = url;
      audioPlaying = true;
      player.play().catch(()=>{});
      player.onended = () => { audioPlaying = false; };
    }
  } catch (e) { log('Greeting TTS failed: ' + e.message); }

  // Mic + analyser
  const mimeType = pickMimeType();
  if (!mimeType) {
    log('❌ MediaRecorder unsupported. Use Chrome.');
    return;
  }
  utterMime = mimeType;

  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
  });

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  micSource = audioCtx.createMediaStreamSource(stream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  micSource.connect(analyser);

  // Calibrate ambient RMS for 1s
  await calibrateThreshold();

  // Start VAD loop
  loopVAD();
  log(`🎧 Listening… (threshold ~${RMS_THRESHOLD.toFixed(3)})`);
}

async function calibrateThreshold() {
  const data = new Float32Array(analyser.fftSize);
  const start = performance.now();
  let accum = 0, n = 0;
  while (performance.now() - start < 1000) {
    analyser.getFloatTimeDomainData(data);
    let rms = 0;
    for (let i = 0; i < data.length; i++) rms += data[i] * data[i];
    rms = Math.sqrt(rms / data.length);
    accum += rms;
    n++;
    await new Promise(r => setTimeout(r, CHECK_INTERVAL_MS));
  }
  const ambient = accum / Math.max(1, n);
  // set threshold as ambient * factor with a floor
  RMS_THRESHOLD = Math.max(MIN_RMS_FLOOR, ambient * 3.0);
}

function loopVAD() {
  const data = new Float32Array(analyser.fftSize);
  const minSpeechFrames = Math.ceil(MIN_SPEECH_MS / CHECK_INTERVAL_MS);
  const endSilenceFrames = Math.ceil(END_SILENCE_MS / CHECK_INTERVAL_MS);

  const tick = () => {
    analyser.getFloatTimeDomainData(data);
    let rms = 0;
    for (let i = 0; i < data.length; i++) rms += data[i] * data[i];
    rms = Math.sqrt(rms / data.length);

    if (rms > RMS_THRESHOLD) {
      framesAbove++;
      framesBelow = 0;
      if (!speechActive && framesAbove >= minSpeechFrames) {
        speechActive = true;
        framesAbove = 0;
        onSpeechStart();
      }
    } else {
      framesBelow++;
      framesAbove = 0;
      if (speechActive && framesBelow >= endSilenceFrames) {
        speechActive = false;
        framesBelow = 0;
        onSpeechEnd();
      }
    }
    rafId = setTimeout(tick, CHECK_INTERVAL_MS);
  };
  tick();
}

function onSpeechStart() {
  // barge-in
  if (audioPlaying) {
    try { player.pause(); } catch {}
    audioPlaying = false;
  }
  // start fresh recorder for this utterance
  utterChunks = [];
  try {
    utterRecorder = new MediaRecorder(stream, { mimeType: utterMime });
  } catch (e) {
    log('Recorder init failed: ' + e.message);
    return;
  }
  utterRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) utterChunks.push(e.data);
  };
  utterRecorder.onstop = () => {
    // assemble a complete file from this utterance
    if (!utterChunks.length) return;
    const blob = new Blob(utterChunks, { type: utterMime });
    sendUtterance(blob, utterMime).catch(err => log('Send error: ' + err.message));
  };
  utterRecorder.start(); // no timeslice; final chunk on stop
  log('🎤 Detected speech — recording utterance');
}

function onSpeechEnd() {
  if (utterRecorder && utterRecorder.state !== 'inactive') {
    utterRecorder.stop();
    log('⏹️ Utterance captured — sending…');
  }
}

async function sendUtterance(blob, mime) {
  const fd = new FormData();
  const userId = userIdInput.value.trim() || 'anonymous';
  fd.append('audio', blob, 'utt.webm');
  fd.append('userId', userId);
  fd.append('promptName', promptSel.value || 'default');
  fd.append('contentType', mime || 'audio/webm');

  const res = await fetch('/api/voice', { method: 'POST', body: fd });
  if (!res.ok) {
    const txt = await res.text();
    log('❌ Server error: ' + txt);
    return;
  }
  const data = await res.json();
  const { transcript, reply, audioBase64, audioMime } = data;
  if (transcript) log(`You: ${transcript}`);
  if (reply) log(`Bot: ${reply}`);

  if (audioBase64) {
    const buf = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
    const audioBlob = new Blob([buf], { type: audioMime || 'audio/mpeg' });
    const url = URL.createObjectURL(audioBlob);
    player.src = url;
    audioPlaying = true;
    player.play().catch(()=>{});
    player.onended = () => { audioPlaying = false; };
  } else {
    log('⚠️ No audio returned from TTS.');
  }
}

// greet in log
log('Bot: Hello! I’m ready when you are.');

// UI modal open/close + auto-start mic
(function initUI(){
  const fab = document.getElementById('fab');
  const modal = document.getElementById('chatModal');
  const closeBtn = document.getElementById('closeChat');
  const services = document.querySelectorAll('.service');
  const selection = document.getElementById('selection');

  function updateSelection(){
    const chosen = Array.from(services).filter(s => s.classList.contains('selected'))
                      .map(s => s.getAttribute('data-service'));
    selection.textContent = 'Selected: ' + (chosen.length ? chosen.join(', ') : 'none');
  }

  services.forEach(btn => {
    btn.addEventListener('click', () => {
      const pressed = btn.getAttribute('aria-pressed') === 'true';
      btn.setAttribute('aria-pressed', String(!pressed));
      btn.classList.toggle('selected');
      updateSelection();
    });
  });
  updateSelection();

  if (fab) fab.addEventListener('click', async () => {
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    try { await initMic(); } catch (e) { log('Init mic failed: ' + e.message); }
  });
  if (closeBtn) closeBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    // teardown
    try {
      if (rafId) { clearTimeout(rafId); rafId = null; }
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (audioCtx) audioCtx.close();
      if (utterRecorder && utterRecorder.state !== 'inactive') utterRecorder.stop();
      utterRecorder = null;
      utterChunks = [];
      speechActive = false;
      framesAbove = framesBelow = 0;
      activated = false;
    } catch {}
  });
})();
