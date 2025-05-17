const { app, BrowserWindow, ipcMain, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { createExtractorFromData } = require('node-unrar-js');
const pdfPoppler = require('pdf-poppler');
const os = require('os');
const archiver = require('archiver');

const isMac = process.platform === 'darwin';
let win; 

function createWindow() {
  win = new BrowserWindow({
    width: 800,
    height: 600,
    maximizable: false,
    titleBarStyle: 'hidden',
    icon: isMac ? undefined : path.join(__dirname, 'icon-windows.png'),
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
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.pdf' || ext === '.cbz') {
      return true;
    }

    if (ext === '.cbr') {
      const buffer = fs.readFileSync(filePath);
      const sig = buffer.slice(0, 8).toString('hex');
      return sig.startsWith('526172211a0700'); // RAR4
    }

    return false;
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

function sendNotification(title, body) {
  new Notification({ title, body }).show();
}

async function convertPDFtoCBZ(pdfPath, outputCbzPath) {
  const tempDir = path.join(os.tmpdir(), `pdf_to_cbz_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const opts = {
    format: 'jpeg',
    out_dir: tempDir,
    out_prefix: 'page',
    page: null
  };

  try {
    await pdfPoppler.convert(pdfPath, opts);
  } catch (err) {
    throw new Error('PDF conversion failed: ' + err.message);
  }

  const output = fs.createWriteStream(outputCbzPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.pipe(output);
  archive.directory(tempDir, false);

  await archive.finalize();

  fs.rmSync(tempDir, { recursive: true, force: true });
}
let hasErrors = false;

ipcMain.on('convert-files', async (event, { files, outputDir }) => {
  for (let i = 0; i < files.length; i++) {
    const filePath = files[i].fullPath;
    const ext = path.extname(filePath).toLowerCase();
    event.sender.send('file-status', { index: i, status: 'Processing' });

    try {
      if (ext === '.pdf') {
        const outputFile = path.join(outputDir, `${path.basename(filePath, '.pdf')}.cbz`);
        await convertPDFtoCBZ(filePath, outputFile);
      } else {
        const data = fs.readFileSync(filePath);
        const extractor = await createExtractorFromData({ data: new Uint8Array(data) });
        const extracted = extractor.extract({});

        const outputFile = path.join(outputDir, `${path.basename(filePath, ext)}.cbz`);
        const output = fs.createWriteStream(outputFile);
        const zip = archiver('zip', { zlib: { level: 9 } });
        zip.pipe(output);

        for (const file of extracted.files) {
          if (!file.fileHeader.flags.directory && file.extraction) {
            zip.append(Buffer.from(file.extraction), { name: file.fileHeader.name });
          }
        }

        await zip.finalize();
      }

      event.sender.send('file-status', { index: i, status: 'Done' });
    } catch (error) {
      event.sender.send('file-status', { index: i, status: 'Error' });
      console.error(error);
      hasErrors = true;
    }

    event.sender.send('conversion-progress', Math.round(((i + 1) / files.length) * 100));
  }

  !hasErrors && event.sender.send('conversion-complete');
  hasErrors && event.sender.send('conversion-errors');
});

ipcMain.on('show-notification', (_event, { title, body }) => {
  new Notification({ title, body }).show();
});
