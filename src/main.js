const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { createExtractorFromData } = require('node-unrar-js');
const archiver = require('archiver');

let win; 
function createWindow() {
  win = new BrowserWindow({
    width: 800,
    height: 600,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 10, y: 11 },
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: true
    }
  });

  win.loadFile('./index.html');
}

app.whenReady().then(createWindow);

ipcMain.handle('get-os', () => {
    return process.platform;
  });

ipcMain.on('minimize-window', () => {
    if (win) {
      win.minimize();
    }
  });
  
  ipcMain.on('toggle-maximize-window', () => {
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });
  
  ipcMain.on('close-window', () => {
    if (win) {
      win.close();
    }
  });

ipcMain.handle('validate-cbrs', async (event, filePaths) => {
  const validFiles = filePaths.filter(filePath => {
    if (path.extname(filePath).toLowerCase() !== '.cbr') return false;
    const buffer = fs.readFileSync(filePath);
    const sig = buffer.slice(0, 8).toString('hex');
    return sig.startsWith('526172211a0700'); // RAR4
  });
  return validFiles.map(filePath => ({
    fullPath: filePath,
    fileName: path.basename(filePath)
  }));
});

ipcMain.handle('select-output-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.on('convert-files', async (event, { files, outputDir }) => {
  for (let i = 0; i < files.length; i++) {
    const filePath = files[i].fullPath;
    event.sender.send('file-status', { index: i, status: 'Processing' });

    try {
      const data = fs.readFileSync(filePath);
      const extractor = await createExtractorFromData({ data: new Uint8Array(data) });
      const extracted = extractor.extract({});

      const outputFile = path.join(outputDir, `${path.basename(filePath, '.cbr')}.cbz`);
      const output = fs.createWriteStream(outputFile);
      const zip = archiver('zip', { zlib: { level: 9 } });
      zip.pipe(output);

      for (const file of extracted.files) {
        if (!file.fileHeader.flags.directory && file.extraction) {
          zip.append(Buffer.from(file.extraction), { name: file.fileHeader.name });
        }
      }

      await zip.finalize();
      event.sender.send('file-status', { index: i, status: 'Done' });
    } catch (error) {
      event.sender.send('file-status', { index: i, status: 'Error' });
    }

    event.sender.send('conversion-progress', Math.round(((i + 1) / files.length) * 100));
  }

  event.sender.send('conversion-complete');
});
