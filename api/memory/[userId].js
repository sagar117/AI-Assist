const { getHistory } = require('../../memoryStore');

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = req.query;
  res.json({ history: getHistory(userId, 50) });
}