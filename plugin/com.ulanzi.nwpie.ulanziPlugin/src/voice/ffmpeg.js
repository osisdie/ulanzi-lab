// ffmpeg for the recorder: find the binary, list DirectShow microphones, pick one, and build the recording command.
import fs from 'node:fs';
import path from 'node:path';

/**
 * ffmpeg's path, or null. Ulanzi Studio keeps the PATH it started with, so a winget install made later is not on it:
 * besides ULANZI_LAB_FFMPEG and PATH, look where winget, Chocolatey and Scoop put it (and Homebrew on macOS).
 */
export function findFfmpeg({ env = process.env, platform = process.platform, exists = fs.existsSync, readdir = (d) => fs.readdirSync(d) } = {}) {
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const exe = win ? 'ffmpeg.exe' : 'ffmpeg';
  const cands = [env.ULANZI_LAB_FFMPEG, ...String(env.PATH || env.Path || '').split(win ? ';' : ':').filter(Boolean).map(d => p.join(d, exe))];
  if (win) {
    const local = env.LOCALAPPDATA || '';
    if (local) {
      cands.push(p.join(local, 'Microsoft', 'WinGet', 'Links', exe));
      // winget's Gyan.FFmpeg package: Packages\Gyan.FFmpeg_<source>\ffmpeg-<version>-full_build\bin\ffmpeg.exe
      const pkgs = p.join(local, 'Microsoft', 'WinGet', 'Packages');
      for (const pkg of safe(readdir, pkgs).filter(d => /^Gyan\.FFmpeg/i.test(d))) {
        for (const build of safe(readdir, p.join(pkgs, pkg)).filter(d => /^ffmpeg-/i.test(d))) cands.push(p.join(pkgs, pkg, build, 'bin', exe));
      }
    }
    cands.push('C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe');
    if (env.USERPROFILE) cands.push(p.join(env.USERPROFILE, 'scoop', 'shims', exe));
  } else {
    cands.push('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg');
  }
  return cands.find(c => c && exists(c)) || null;
}

const safe = (readdir, dir) => { try { return readdir(dir); } catch { return []; } };

/**
 * Audio devices from `ffmpeg -list_devices true -f dshow -i dummy` (stderr): [{ name, alt }].
 * `alt` is the ASCII "@device_cm_…" moniker, safe to pass on any code page; names can be non-ASCII.
 */
export function parseDshowDevices(stderr) {
  const out = [];
  let section = null; // older ffmpeg: "DirectShow audio devices" header; newer: "(audio)" after each name
  for (const line of String(stderr).split(/\r?\n/)) {
    if (/DirectShow video devices/i.test(line)) section = 'video';
    else if (/DirectShow audio devices/i.test(line)) section = 'audio';
    const dev = line.match(/\]\s+"(.+)"(?:\s+\((audio|video|none)[^)]*\))?\s*$/);
    if (dev && !/^@device_/.test(dev[1])) {
      const kind = dev[2] || section;
      if (kind === 'audio') out.push({ name: dev[1], alt: null });
      else out.push({ name: dev[1], alt: null, skip: true });
      continue;
    }
    const alt = line.match(/Alternative name\s+"(.+)"/);
    if (alt && out.length) out[out.length - 1].alt = alt[1];
  }
  return out.filter(d => !d.skip).map(({ name, alt }) => ({ name, alt }));
}

/**
 * The microphone to record from: ULANZI_LAB_MIC (substring of the name), else the Windows default capture device
 * (`defaultName`; DirectShow may shorten long names, so a prefix match either way), else the first one.
 */
export function pickMic(devices, { preferred = '', defaultName = '' } = {}) {
  if (!devices.length) return null;
  const low = (s) => String(s || '').toLowerCase();
  if (preferred) {
    const hit = devices.find(d => low(d.name).includes(low(preferred)));
    if (hit) return hit;
  }
  if (defaultName) {
    const hit = devices.find(d => low(defaultName).startsWith(low(d.name)) || low(d.name).startsWith(low(defaultName)));
    if (hit) return hit;
  }
  return devices[0];
}

/**
 * Recording arguments: 16 kHz mono 16-bit WAV to `out`, plus 8 kHz raw PCM on stdout for the level meter.
 * `maxSec` caps this segment (the recording's remaining allowance). Send "q" on stdin to stop cleanly.
 */
export function recordArgs({ device, out, maxSec }) {
  return [
    '-hide_banner', '-nostats', '-loglevel', 'error',
    '-f', 'dshow', '-audio_buffer_size', '50', '-t', String(Math.max(1, Math.floor(maxSec))), '-i', `audio=${device.alt || device.name}`,
    '-map', '0:a', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-fflags', '+bitexact', '-y', out,
    '-map', '0:a', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1',
  ];
}

export const listDevicesArgs = ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'];
