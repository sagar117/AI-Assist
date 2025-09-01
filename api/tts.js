export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
}