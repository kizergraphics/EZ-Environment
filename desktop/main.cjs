const { app, BrowserWindow, Menu, dialog, protocol, session } = require('electron');
const { mkdirSync, accessSync, constants } = require('node:fs');
const { readFile, stat } = require('node:fs/promises');
const path = require('node:path');
const { APP_ORIGIN, CONTENT_SECURITY_POLICY, resolveAssetPath, isAllowedRequest, parseDevOrigin } = require('./security.cjs');

app.setName('EZ Environment');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
const devOrigin = parseDevOrigin(process.env.EZ_ENVIRONMENT_DEV_URL, app.isPackaged);
const portableDirectory = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
const dataDirectory = process.env.EZ_ENVIRONMENT_DATA_DIR || (app.isPackaged
  ? path.join(portableDirectory, 'EZ Environment Data')
  : path.resolve(__dirname, '../.desktop-data'));
try {
  mkdirSync(dataDirectory, { recursive: true });
  accessSync(dataDirectory, constants.W_OK);
  app.setPath('userData', dataDirectory);
  app.setPath('sessionData', path.join(dataDirectory, 'Browser'));
} catch (error) {
  dialog.showErrorBox('EZ Environment cannot save local settings', `Move the application to a writable folder and try again.\n\n${dataDirectory}\n\n${error.message}`);
  app.exit(1);
}

protocol.registerSchemesAsPrivileged([{ scheme: 'ez-environment', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

let mainWindow;
let isQuitting = false;
app.on('before-quit', () => { isQuitting = true; });
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) app.quit();
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600, height: 1000, minWidth: 1024, minHeight: 700,
    title: 'EZ Environment', backgroundColor: '#101915', show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
      spellcheck: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith((devOrigin || APP_ORIGIN) + '/')) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (isQuitting || details.reason === 'clean-exit') return;
    dialog.showErrorBox('EZ Environment renderer stopped', `The graphics process stopped (${details.reason}). Reopen the program to continue. Saved presets remain in their chosen location.`);
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  await mainWindow.loadURL(devOrigin || `${APP_ORIGIN}/`);
}

app.whenReady().then(async () => {
  if (!isPrimaryInstance) return;
  const appSession = session.defaultSession;
  appSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  appSession.setPermissionCheckHandler(() => false);
  appSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isAllowedRequest(details.url, devOrigin) }));
  const assetRoot = path.join(app.getAppPath(), 'dist');
  // Development starts from desktop/main.cjs, so app.getAppPath() is desktop/.
  const servedRoot = app.isPackaged ? assetRoot : path.resolve(process.env.EZ_ENVIRONMENT_ASSET_ROOT || path.resolve(__dirname, '../dist'));
  protocol.handle('ez-environment', async request => {
    const file = resolveAssetPath(request.url, servedRoot);
    if (!file || !['GET', 'HEAD'].includes(request.method)) return new Response('Forbidden', { status: 403 });
    try {
      if (!(await stat(file)).isFile()) return new Response('Not found', { status: 404 });
      return new Response(request.method === 'HEAD' ? null : await readFile(file), { headers: {
        'Content-Type': mimeTypes[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Security-Policy': CONTENT_SECURITY_POLICY,
        'X-Content-Type-Options': 'nosniff',
      } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [{ role: 'quit' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : [])] },
    { label: 'Help', submenu: [{ label: 'About EZ Environment', click: () => dialog.showMessageBox(mainWindow, {
      type: 'info', title: 'EZ Environment', message: `EZ Environment ${app.getVersion()}`,
      detail: `Local procedural environment authoring.\nBased on EZ-Tree by Daniel Greenheck (MIT).\n\nLocal settings: ${dataDirectory}`,
    }) }] },
  ]));
  await createWindow();
}).catch(error => {
  if (isQuitting) return;
  dialog.showErrorBox('EZ Environment could not start', error.stack || String(error));
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
