// memoryStore.js
const fs = require('fs');
const path = require('path');

// Use /tmp directory for Vercel serverless environment
const DB_PATH = path.join('/tmp', 'memory.json');

function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return {};
  }
}
function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

const db = loadDB();

function getHistory(userId, limit = 20) {
  const arr = db[userId] || [];
  return limit ? arr.slice(-limit) : arr;
}

function appendTurn(userId, role, content) {
  if (!db[userId]) db[userId] = [];
  db[userId].push({ role, content, ts: Date.now() });
  if (db[userId].length > 100) db[userId] = db[userId].slice(-100);
  saveDB(db);
}

function clearUser(userId) {
  delete db[userId];
  saveDB(db);
}

module.exports = { getHistory, appendTurn, clearUser };
