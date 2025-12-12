const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');

Menu.setApplicationMenu(null);

let win;
let pendingUrl = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile('index.html');
  win.maximize();
  
  // If there's a pending URL (from command line), navigate to it
  win.webContents.on('did-finish-load', () => {
    if (pendingUrl) {
      win.webContents.send('navigate-to-url', pendingUrl);
      pendingUrl = null;
    }
  });
  
  win.on('closed', () => { win = null; });
}

// Handle URLs passed via command line
function handleUrl(url) {
  if (win) {
    win.webContents.send('navigate-to-url', url);
  } else {
    pendingUrl = url;
  }
}

// Windows: Handle protocol (jaydensbrowser://)
if (process.platform === 'win32') {
  app.setAsDefaultProtocolClient('jaydensbrowser');
}

// Handle deep links
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleUrl(url);
});

// Handle command line arguments
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('jaydensbrowser', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('jaydensbrowser');
}

// Check for URL in command line
const args = process.argv.slice(1);
if (args.length > 0 && args[0].startsWith('jaydensbrowser://')) {
  pendingUrl = args[0].replace('jaydensbrowser://', 'https://');
} else if (args.length > 0 && (args[0].startsWith('http://') || args[0].startsWith('https://'))) {
  pendingUrl = args[0];
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

ipcMain.on('window-minimize', () => win && win.minimize());
ipcMain.on('window-maximize', () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
});
ipcMain.on('window-close', () => win && win.close());

// Allow renderer to request a window reload (fallback)
ipcMain.on('window-restart', () => {
  if (win && win.webContents) {
    try { win.webContents.reload(); } catch (e) { /* ignore */ }
  }
});

// renderer -> main navigation (optional)
ipcMain.on('navigate', (e, url) => {
  if (win) win.webContents.send('navigate', url);
});