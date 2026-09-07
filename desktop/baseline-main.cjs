// Test-only host for the original upstream build. Excluded from distributables.
// The harness starts a loopback server, injects its seed, then navigates this
// blank page. This preserves the upstream HTML and shader code for measurement.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ez-baseline-')));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: false } });
  window.loadURL('about:blank');
});
app.on('window-all-closed', () => app.quit());
