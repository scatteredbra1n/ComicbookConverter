const { app, BrowserWindow, ipcMain, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { createExtractorFromData } = require('node-unrar-js');
const pdfPoppler = require('pdf-poppler');
const os = require('os');
const unzipper = require('unzipper');
const fg = require('fast-glob');
const archiver = require('archiver');
const { create } = require("xmlbuilder2");
const JSZip = require("jszip");

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

    if (ext === '.pdf' || ext === '.cbz' || ext === '.epub') {
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

async function convertToEPUB(images, title, outputPath) {
  const zip = new JSZip();

  // Add mimetype (must be first and uncompressed)
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

  // Add container.xml
  zip.folder("META-INF").file(
    "container.xml",
    `<?xml version="1.0"?>
    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles>
        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
      </rootfiles>
    </container>`
  );

  // Add images
  const imageNames = [];
  const imagesFolder = zip.folder("OEBPS").folder("images");
  for (let i = 0; i < images.length; i++) {
    const name = `${String(i).padStart(3, "0")}${path.extname(images[i])}`;
    imageNames.push(name);
    const imgData = fs.readFileSync(images[i]);
    imagesFolder.file(name, imgData);
  }

  // Add HTML page
  const html = `
    <html xmlns="http://www.w3.org/1999/xhtml">
      <head><title>${title}</title></head>
      <body style="margin:0;padding:0;background:black;">
        ${imageNames.map(name => `<img src="images/${name}" style="width:100%;height:auto;display:block;" />`).join("")}
      </body>
    </html>
  `;
  zip.folder("OEBPS").file("index.xhtml", html);

  // Add OPF (metadata)
  const opf = create({ version: "1.0", encoding: "UTF-8" })
    .ele("package", {
      xmlns: "http://www.idpf.org/2007/opf",
      version: "2.0",
      "unique-identifier": "BookId"
    })
    .ele("metadata", { "xmlns:dc": "http://purl.org/dc/elements/1.1/" })
    .ele("dc:title").txt(title).up()
    .ele("dc:identifier", { id: "BookId" }).txt("urn:uuid:" + Date.now()).up()
    .ele("dc:language").txt("en").up()
    .up()
    .ele("manifest")
    .ele("item", { id: "index", href: "index.xhtml", "media-type": "application/xhtml+xml" }).up()
    .ele("item", { id: "cover", href: "images/" + imageNames[0], "media-type": "image/jpeg" }).up()
    .up()
    .ele("spine")
    .ele("itemref", { idref: "index" }).up()
    .up()
    .doc()
    .end({ prettyPrint: true });

  zip.folder("OEBPS").file("content.opf", opf);

  const content = await zip.generateAsync({ type: "nodebuffer", mimeType: "application/epub+zip" });
  fs.writeFileSync(outputPath, content);
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

async function convertEPUBtoCBZ(epubPath, outputCbzPath) {
  const tempDir = path.join(os.tmpdir(), `epub_to_cbz_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  // Step 1: unzip EPUB
  await fs.createReadStream(epubPath)
    .pipe(unzipper.Extract({ path: tempDir }))
    .promise();

  // Step 2: find images (jpg/png/gif/webp/etc.)
  const imagePaths = await fg(['**/*.jpg', '**/*.jpeg', '**/*.png', '**/*.webp', '**/*.gif'], {
    cwd: tempDir,
    onlyFiles: true,
    absolute: true
  });

  if (imagePaths.length === 0) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      throw new Error('No images found in EPUB.');
  }

  // Step 3: package into CBZ
  const output = fs.createWriteStream(outputCbzPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.pipe(output);

  imagePaths
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .forEach((imgPath, index) => {
      archive.file(imgPath, { name: `${String(index).padStart(3, '0')}${path.extname(imgPath)}` });
  });
  await archive.finalize();

  fs.rmSync(tempDir, { recursive: true, force: true });
}

let hasErrors = false;

ipcMain.on('convert-files', async (event, { files, outputDir }) => {
  for (let i = 0; i < files.length; i++) {
    const { fullPath: filePath, outputFormat } = files[i];
    const ext = path.extname(filePath).toLowerCase();
    event.sender.send('file-status', { index: i, status: 'Processing' });

    try {
      const fileName = path.basename(filePath, ext);
      const outputFile = path.join(outputDir, `${fileName}.${outputFormat}`);

      if (outputFormat === 'cbz') {
        // Use existing logic
        if (ext === '.pdf') {
          await convertPDFtoCBZ(filePath, outputFile);
        } else if (ext === '.epub') {
          await convertEPUBtoCBZ(filePath, outputFile);
        } else {
          const data = fs.readFileSync(filePath);
          const extractor = await createExtractorFromData({ data: new Uint8Array(data) });
          const extracted = extractor.extract({});
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
      } else if (outputFormat === 'epub') {
        const tempDir = path.join(os.tmpdir(), `to_epub_${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });

        let imagePaths = [];

        if (ext === '.cbz' || ext === '.epub') {
          await fs.createReadStream(filePath)
            .pipe(unzipper.Extract({ path: tempDir }))
            .promise();

          imagePaths = await fg(['**/*.{jpg,jpeg,png,gif,webp}'], {
            cwd: tempDir,
            onlyFiles: true,
            absolute: true
          });

        } else if (ext === '.cbr') {
          const data = fs.readFileSync(filePath);
          const extractor = await createExtractorFromData({ data: new Uint8Array(data) });
          const extracted = extractor.extract({});

          for (const file of extracted.files) {
            if (!file.fileHeader.flags.directory && file.extraction) {
              const outPath = path.join(tempDir, file.fileHeader.name);
              fs.mkdirSync(path.dirname(outPath), { recursive: true });
              fs.writeFileSync(outPath, Buffer.from(file.extraction));
            }
          }

          imagePaths = await fg(['**/*.{jpg,jpeg,png,gif,webp}'], {
            cwd: tempDir,
            onlyFiles: true,
            absolute: true
          });

        } else {
          throw new Error("EPUB export not supported for this file type.");
        }

        if (!imagePaths.length) {
          fs.rmSync(tempDir, { recursive: true, force: true });
          throw new Error("No images found for EPUB export.");
        }

        await convertToEPUB(imagePaths, fileName, outputFile);
        fs.rmSync(tempDir, { recursive: true, force: true });
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
