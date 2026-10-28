const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
process.chdir(root);
// Optional workspace-local output lets us package while another build is open.
const installer = process.argv.includes('--installer');
const explicitOutput = process.argv.slice(2).find(arg => arg !== '--installer');
const output = path.resolve(root, explicitOutput || (installer ? `release-installer-${new Date().toISOString().replace(/[:.]/g, '-')}` : 'release-final'));
if (!output.startsWith(root + path.sep)) throw new Error('Invalid package output directory');
// Windows can temporarily lock a freshly written executable while inspecting it.
// Retry the same resource edit; never skip metadata/integrity or disable OS checks.
const resources = require('app-builder-lib/out/util/resEdit.js');
const originalEdit = resources.editWindowsResources;
resources.editWindowsResources = async options => {
  for (let attempt = 1; ; attempt++) {
    try { return await originalEdit(options); }
    catch (error) {
      if (attempt >= 8 || !['EBUSY', 'EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) throw error;
      console.error(`Windows executable temporarily unavailable (${error.code}); retry ${attempt}/8`);
      await new Promise(resolve => setTimeout(resolve, 2500));
    }
  }
};
// The integrity resource is written earlier than editWindowsResources, and can
// hit the same transient open-file lock. Retry only failed opens, not partial
// writes, while keeping ASAR integrity enabled.
const electronWin = require('app-builder-lib/out/electron/electronWin.js');
const originalIntegrity = electronWin.addWinAsarIntegrity;
electronWin.addWinAsarIntegrity = async (...args) => {
  for (let attempt = 1; ; attempt++) {
    try { return await originalIntegrity(...args); }
    catch (error) {
      if (attempt >= 8 || error.syscall !== 'open' || !['EBUSY', 'EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) throw error;
      console.error(`ASAR integrity target temporarily unavailable (${error.code}); retry ${attempt}/8`);
      await new Promise(resolve => setTimeout(resolve, 2500));
    }
  }
};
const { build, Platform, Arch } = require('electron-builder');
const dist = path.join(root, 'node_modules/electron/dist');
import('./prepare-feishu-cli.mjs').then(module => module.prepareFeishuCli()).then(() => build({ targets: Platform.WINDOWS.createTarget(installer ? 'nsis' : 'dir', Arch.x64), config: { ...(fs.existsSync(path.join(dist, 'electron.exe')) ? { electronDist: dist } : {}), directories: { output } }, publish: 'never' })).then(() => { console.log(`Windows artifacts: ${output}`); }).catch(error => { console.error(error); process.exitCode = 1; });
