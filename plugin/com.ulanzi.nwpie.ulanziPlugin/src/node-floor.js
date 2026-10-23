// Oldest Node release with current security fixes, per release line (Node.js security releases, 2026-10-21).
// Lines not listed (20, 23, 25, ...) are end of life. Update this table after each Node security release.
// Used by the plugin's start-up warning, the setup scripts and CI:
//   node plugin/com.ulanzi.nwpie.ulanziPlugin/src/node-floor.js   → exit 0 if this Node is patched, else 1
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const FLOORS = { 22: '22.23.4', 24: '24.22.1', 26: '26.12.1' };

const num = (v) => String(v).replace(/^v/, '').split('.').map(Number);

/** null when `version` has the current security fixes, else the reason it doesn't. */
export function nodeProblem(version = process.version) {
  const [major, minor, patch] = num(version);
  if (major > Math.max(...Object.keys(FLOORS).map(Number))) return null; // a newer line than this table knows
  const floor = FLOORS[major];
  if (!floor) return `Node ${version} is end of life (use ${Object.values(FLOORS).join(' / ')} or newer in the same line)`;
  const [, fMinor, fPatch] = num(floor);
  if (minor < fMinor || (minor === fMinor && patch < fPatch)) return `Node ${version} lacks security fixes (need ${floor} or newer)`;
  return null;
}

// Run as a script (also through a symlinked path, e.g. the plugin linked into Ulanzi Studio's folder).
const asScript = () => { try { return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; } };
if (process.argv[1] && asScript()) {
  const problem = nodeProblem();
  if (problem) { console.error(problem); process.exit(1); }
  console.log(`Node ${process.version} has current security fixes`);
}
