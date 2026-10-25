// Copy text to the clipboard. Windows goes through winhelper (a UTF-8 JSON pipe, so Chinese survives the console
// code page and long text isn't limited by the command line); macOS uses pbcopy with a UTF-8 locale.
import { spawn } from 'node:child_process';

export function createClipboard({ helper, platform = process.platform, run = spawn } = {}) {
  async function set(text) {
    if (platform === 'win32') return (await helper.request('clip.set', String(text)))?.ok === true;
    if (platform !== 'darwin') return false;
    return new Promise((resolve) => {
      const p = run('pbcopy', [], { env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' } });
      p.on('error', () => resolve(false));
      p.on('close', (code) => resolve(code === 0));
      p.stdin.end(String(text));
    });
  }
  return { set };
}
