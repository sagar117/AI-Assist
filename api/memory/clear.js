const { clearUser } = require('../../memoryStore');

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });
  
  clearUser(userId);
  res.json({ ok: true });
}