const { listPrompts } = require('../promptLoader');

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    res.json({ prompts: listPrompts() });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}