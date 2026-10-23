#!/usr/bin/env node
// `npm test`: run test/*.test.mjs with node:test. Lists the files itself because cmd.exe (npm on Windows)
// doesn't expand globs and Node 20 (Ulanzi Studio's bundled Node, tested in CI) doesn't either.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.mjs')).sort().map(f => path.join(dir, f));
const r = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
