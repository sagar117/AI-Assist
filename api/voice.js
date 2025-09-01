const multer = require('multer');
const { appendTurn, getHistory } = require('../memoryStore');
const { loadPrompt } = require('../promptLoader');

const upload = multer({ storage: multer.memoryStorage() });

const {
  OPENAI_API_KEY,
  DEEPGRAM_API_KEY,
  OPENAI_MODEL = 'gpt-4o-mini',
  DEEPGRAM_TTS_MODEL = 'aura-asteria-en',
} = process.env;

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Handle multipart form data
    await new Promise((resolve, reject) => {
      upload.single('audio')(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

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
}