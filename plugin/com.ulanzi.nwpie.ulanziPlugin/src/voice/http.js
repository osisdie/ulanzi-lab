// Multipart upload over node:http(s), streaming the file. Not fetch: undici gives up on a response header after
// 300 s, and a long recording can take longer than that to transcribe on a CPU.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * POST `fields` and one `file` ({ field, path, type }) as multipart/form-data. Resolves { status, body } (body as text);
 * rejects on network errors and on `timeoutMs` without a complete response.
 */
export function postMultipart(url, { fields = {}, file }, { timeoutMs = 120e3, headers = {}, transport = null } = {}) {
  const u = new URL(url);
  const boundary = `----ulanzilab${crypto.randomBytes(12).toString('hex')}`;
  const esc = (s) => String(s).replace(/"/g, '%22').replace(/\r|\n/g, ' ');
  const head = Object.entries(fields).map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${esc(k)}"\r\n\r\n${v}\r\n`).join('')
    + `--${boundary}\r\nContent-Disposition: form-data; name="${esc(file.field || 'file')}"; filename="${esc(path.basename(file.path))}"\r\n`
    + `Content-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const length = Buffer.byteLength(head) + fs.statSync(file.path).size + Buffer.byteLength(tail);
  const mod = transport || (u.protocol === 'https:' ? https : http);

  return new Promise((resolve, reject) => {
    const req = mod.request(u, { method: 'POST', headers: { ...headers, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': length } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { clearTimeout(timer); resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
      res.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    const timer = setTimeout(() => req.destroy(new Error(`timed out after ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.write(head);
    const rs = fs.createReadStream(file.path);
    rs.on('error', (e) => req.destroy(e));
    rs.on('end', () => req.end(tail));
    rs.pipe(req, { end: false });
  });
}

const sleepMs = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Call `send()` again while it answers 503 (the service is busy or still loading), waiting `delays` ms in between.
 * Other statuses (and network errors) return / throw at once: 4xx will not get better by retrying.
 */
export async function retryBusy(send, { delays = [2e3, 4e3, 8e3, 16e3, 30e3, 30e3], sleep = sleepMs, onWait = () => {} } = {}) {
  for (let i = 0; ; i++) {
    const r = await send();
    if (r.status !== 503 || i >= delays.length) return r;
    onWait(delays[i], i + 1);
    await sleep(delays[i]);
  }
}
