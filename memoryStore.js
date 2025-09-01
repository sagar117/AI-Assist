// memoryStore.js
const fs = require('fs');
const path = require('path');

// Use /tmp directory for Vercel serverless environment
const DB_PATH = path.join('/tmp', 'memory.json');

function loadDB() {
  try {
    // Try to load from /tmp first
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    }
    
    // If not in /tmp, try to load from project directory (for initial migration)
    const projectPath = path.join(__dirname, 'memory.json');
    if (fs.existsSync(projectPath)) {
      const data = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
      // Save to /tmp for future use
      saveDB(data);
      return data;
    }
    
    return {};
  } catch {
    return {};
  }
}

function saveDB(db) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  } catch (error) {
    console.error('Failed to save database:', error);
  }
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