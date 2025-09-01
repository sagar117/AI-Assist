export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const fs = require('fs');
    const p = require('path');
    const dir = p.join(process.cwd(), 'prompts');
    let files = [];
    try { files = fs.readdirSync(dir); } catch {}
    res.json({ ok: true, dir: process.cwd(), promptsDir: dir, files });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}