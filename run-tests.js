#!/usr/bin/env node
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import glob from 'fast-glob';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testFiles = await glob('src/tests/**/*.test.ts', { cwd: __dirname });

const child = spawn('npx', ['tsx', '--test', ...testFiles], {
  stdio: 'inherit',
  cwd: __dirname,
});

child.on('close', (code) => {
  process.exit(code ?? 1);
});