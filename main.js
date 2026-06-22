const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const fs = require('node:fs/promises');

// Official application name (shown in the macOS menu bar, dialogs, etc.).
app.setName('Essentia Duluth CRNA Scheduling Tool');

const UPDATE_REPO = 'sirhans/Essentia-Duluth-CRNA-Scheduling-Tools';
autoUpdater.autoDownload = false;

function parseVersion(version) {
  return String(version)
    .replace(/^v/i, '')
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

async function fetchLatestReleaseVersion() {
  const response = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Essentia-Duluth-CRNA-Scheduling-Tool',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status}`);
  }
  const release = await response.json();
  if (!release || !release.tag_name) {
    throw new Error('GitHub did not return a release version.');
  }
  return String(release.tag_name).replace(/^v/i, '');
}

// Renderer asks to export a workbook: show a native Save As dialog, then write
// the bytes to the chosen path. File system access stays in the main process.
ipcMain.handle('export-xlsx', async (event, { bytes, defaultName }) => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export to Excel',
    defaultPath: defaultName || 'reduced-schedule.xlsx',
    filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  await fs.writeFile(filePath, Buffer.from(bytes));
  return { canceled: false, filePath };
});

ipcMain.handle('updates:check', async () => {
  const currentVersion = app.getVersion();
  const latestVersion = await fetchLatestReleaseVersion();
  return {
    currentVersion,
    latestVersion,
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
  };
});

ipcMain.handle('updates:install', async () => {
  if (!app.isPackaged) {
    throw new Error('Updates can only be installed from the packaged app.');
  }
  const result = await autoUpdater.checkForUpdates();
  if (!result || !result.updateInfo || compareVersions(result.updateInfo.version, app.getVersion()) <= 0) {
    return { started: false };
  }
  await autoUpdater.downloadUpdate();
  autoUpdater.quitAndInstall(false, true);
  return { started: true };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 900,
    title: 'Essentia Duluth CRNA Scheduling Tool',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  // macOS: re-create a window when the dock icon is clicked and none are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
