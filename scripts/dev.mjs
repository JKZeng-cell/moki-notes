import { spawn } from 'node:child_process';
const children = [spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'watch', 'src/server/main.ts'], { stdio: 'inherit', env: { ...process.env, MOKI_NOTES_DEV: '1' } }), spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' })];
process.on('SIGINT', () => children.forEach(p => p.kill()));
process.on('SIGTERM', () => children.forEach(p => p.kill()));
