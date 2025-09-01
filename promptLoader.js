// promptLoader.js (auto-create default)
const fs = require('fs');
const path = require('path');

const PROMPTS_DIR = path.join(__dirname, 'prompts');
const DEFAULT_NAME = 'default';
const DEFAULT_TEXT = 'You are a concise, helpful voice assistant. Keep answers short, factual, and follow up with a clarifying question when useful.';

function ensureDefaults() {
  try {
    if (!fs.existsSync(PROMPTS_DIR)) fs.mkdirSync(PROMPTS_DIR);
    const p = path.join(PROMPTS_DIR, DEFAULT_NAME + '.txt');
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, DEFAULT_TEXT);
    }
  } catch (e) {}
}

function listPrompts() {
  ensureDefaults();
  try {
    return fs.readdirSync(PROMPTS_DIR)
      .filter(f => f.endsWith('.txt'))
      .map(f => path.basename(f, '.txt'));
  } catch {
    return [];
  }
}

function loadPrompt(name = DEFAULT_NAME) {
  ensureDefaults();
  const p = path.join(PROMPTS_DIR, `${name}.txt`);
  if (fs.existsSync(p)) {
    return fs.readFileSync(p, 'utf8');
  }
  const fallback = path.join(PROMPTS_DIR, DEFAULT_NAME + '.txt');
  if (fs.existsSync(fallback)) {
    return fs.readFileSync(fallback, 'utf8');
  }
  return 'You are a helpful assistant.';
}

module.exports = { listPrompts, loadPrompt };
