const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

// Official application name (shown in the macOS menu bar, dialogs, etc.).
app.setName('Essentia Duluth CRNA Scheduling Tool');

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
