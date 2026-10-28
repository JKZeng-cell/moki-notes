import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
export function dataPath() {
  const root = process.platform === 'win32' ? process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming') : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support') : process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
  return resolve(process.env.MOKI_NOTES_DATA ?? join(root, 'moki-notes', 'moki-notes.db'));
}
