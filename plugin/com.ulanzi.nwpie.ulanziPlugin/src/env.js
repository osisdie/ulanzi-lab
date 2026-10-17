// Machine-specific settings: load the repo-root `.env` (KEY=value lines) into process.env.
// Real environment variables win. Import this module first wherever settings are read.
// Override the file with ULANZI_LAB_ENV_FILE. See .env.example for every key.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Parse dotenv text: KEY=value, # comments, optional single/double quotes. */
export function parseEnv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, ''); // trailing comment on unquoted values
    out[m[1]] = v;
  }
  return out;
}

function candidates() {
  if (process.env.ULANZI_LAB_ENV_FILE) return [process.env.ULANZI_LAB_ENV_FILE];
  const here = path.dirname(fileURLToPath(import.meta.url)); // plugin/<id>/src
  let real = here;
  try { real = fs.realpathSync(here); } catch { /* keep as is */ }
  // The plugin runs through a junction in %APPDATA%; the repo root is three levels up from src/.
  return [...new Set([real, here].map(d => path.resolve(d, '..', '..', '..', '.env')))];
}

export const ENV_FILE = candidates().find(f => fs.existsSync(f)) || null;
if (ENV_FILE) {
  try {
    for (const [k, v] of Object.entries(parseEnv(fs.readFileSync(ENV_FILE, 'utf8')))) if (process.env[k] === undefined) process.env[k] = v;
  } catch { /* unreadable: run with defaults */ }
}

/** Typed accessors. */
export const env = (k, d = '') => (process.env[k] ?? '').trim() || d;
export const envList = (k) => env(k).split(',').map(s => s.trim()).filter(Boolean);
