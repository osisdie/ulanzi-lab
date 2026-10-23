// ulanzi-lab plugin entry (started by Ulanzi Studio with: node app.js <address> <port> <language> <appVersion>).
// Studio's bundled Node may lack security fixes. Then, if a patched Node is installed, this process only
// supervises a child that runs this same file on it (see src/supervisor.js); otherwise the plugin runs here.
// ULANZI_LAB_NODE=<path> picks the Node; ULANZI_LAB_NODE=bundled always runs on Studio's.
import './src/env.js';
import { fileURLToPath } from 'node:url';
import { log } from './src/log.js';
import { nodeProblem } from './src/node-floor.js';
import { findPatchedNode, supervise } from './src/supervisor.js';

// In the supervised child: stop as soon as the parent (Studio's process) is gone, even before main.js has loaded.
if (process.env.ULANZI_LAB_SUPERVISED === '1') {
  if (!process.connected) process.exit(0);
  process.on('disconnect', () => process.exit(0));
}

const wantChild = nodeProblem() && process.env.ULANZI_LAB_SUPERVISED !== '1' && process.env.ULANZI_LAB_NODE !== 'bundled';
const node = wantChild ? findPatchedNode({ log }) : null;
if (node) {
  log('plugin start', process.version, `(Studio's Node) → running the plugin on ${node.version}`);
  // argv[1] must stay this file: the Ulanzi SDK finds the plugin folder from it.
  const ok = await supervise(node, process.argv[1] || fileURLToPath(import.meta.url), process.argv.slice(2), { log });
  if (!ok) log(`supervisor: ${node.file} keeps failing; running the plugin on Studio's Node instead`);
}
// Reached when no patched Node is needed or found, inside the child, or after the child kept failing.
await import('./src/main.js');
