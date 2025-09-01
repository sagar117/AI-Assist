// server.js (no node-fetch; uses global fetch on Node 18+)
require('dotenv').config();

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const { appendTurn, getHistory, clearUser } = require('./memoryStore');
const { listPrompts, loadPrompt } = require('./promptLoader');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage() });

const {
  PORT = 3000,
  OPENAI_API_KEY,
  DEEPGRAM_API_KEY,
  OPENAI_MODEL = 'gpt-4o-mini',
  DEEPGRAM_TTS_MODEL = 'aura-asteria-en',
} = process.env;

if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in .env');
  process.exit(1);
}
if (!DEEPGRAM_API_KEY) {
  console.error('Missing DEEPGRAM_API_KEY in .env');
  process.exit(1);
}

async function deepgramSTT(audioBuffer, contentType = 'audio/webm') {
  const url = 'https://api.deepgram.com/v1/listen?model=general&smart_format=true';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${DEEPGRAM_API_KEY}`,
      'Content-Type': contentType,
    },
    body: audioBuffer,
  });

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Deepgram STT error: ${res.status} ${msg}`);
  }

  const json = await res.json();
  const transcript =
    json?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
  return transcript.trim();
}

async function openaiChat({ systemPrompt, userText, userId }) {
  const history = getHistory(userId, 10)
    .map(({ role, content }) => ({ role, content }));

  const messages = [
    { role: 'system', content: systemPrompt || 'You are a helpful assistant.' },
    ...history,
    { role: 'user', content: userText },
  ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`OpenAI error: ${res.status} ${msg}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || '';
  return text;
}

async function deepgramTTS(text) {
  const url = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(DEEPGRAM_TTS_MODEL)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${DEEPGRAM_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Deepgram TTS error: ${res.status} ${msg}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

app.get('/api/prompts', (req, res) => {
  try { console.log('[prompts] listing'); } catch (e) {}
  res.json({ prompts: listPrompts() });
});

app.get('/api/memory/:userId', (req, res) => {
  const { userId } = req.params;
  res.json({ history: getHistory(userId, 50) });
});

app.post('/api/memory/clear', (req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });
  clearUser(userId);
  res.json({ ok: true });
});

app.post('/api/voice', upload.single('audio'), async (req, res) => {
  try {
    const userId = req.body.userId || 'anonymous';
    const promptName = req.body.promptName || 'default';
    const contentType = req.body.contentType || req.file?.mimetype || 'audio/webm';

    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'audio file missing' });
    }

    const userText = await deepgramSTT(req.file.buffer, contentType);
    if (userText) appendTurn(userId, 'user', userText);

    const systemPrompt = loadPrompt(promptName);
    const assistantText = userText
      ? await openaiChat({ systemPrompt, userText, userId })
      : "I didn't catch that. Could you try again?";
    appendTurn(userId, 'assistant', assistantText);

    const audioBuf = await deepgramTTS(assistantText);

    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({
      transcript: userText,
      reply: assistantText,
      audioBase64: audioBuf.toString('base64'),
      audioMime: 'audio/mpeg',
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// debug
app.get('/api/debug', (req, res) => {
  try {
    const fs = require('fs');
    const p = require('path');
    const dir = p.join(__dirname, 'prompts');
    let files = [];
    try { files = fs.readdirSync(dir); } catch {}
    res.json({ ok: true, dir: __dirname, promptsDir: dir, files });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// app.listen(PORT, () => {
//   console.log(`Voice bot running at http://localhost:${PORT}`);
// });


app.get('/api/tts', async (req, res) => {
  try {
    const text = (req.query.text || 'Hello.') + '';
    const audioBuf = await (async function deepgramTTSInline(t){
      const url = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(process.env.DEEPGRAM_TTS_MODEL || 'aura-asteria-en')}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({ text: t }),
      });
      if (!r.ok) {
        const msg = await r.text();
        throw new Error(`Deepgram TTS error: ${r.status} ${msg}`);
      }
      const arr = await r.arrayBuffer();
      return Buffer.from(arr);
    })(text);

    res.json({
      audioBase64: audioBuf.toString('base64'),
      audioMime: 'audio/mpeg'
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Voice bot on http://0.0.0.0:${PORT}`);
});

// Export for Vercel
module.exports = app;

