    const dropZone = document.getElementById('drop-zone');
    const fileList = document.getElementById('file-list');
    const convertBtn = document.getElementById('convert-btn');
    const resetBtn = document.getElementById('reset-btn');
    const progress = document.getElementById('progress');
    let validFiles = [];

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.style.borderColor = '#00f';
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.style.borderColor = '#888';
    });

    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropZone.style.borderColor = '#888';
      const paths = [...e.dataTransfer.files].map(f => f.path);
      validFiles = await window.api.validateCBRs(paths);
      convertBtn.disabled = validFiles.length === 0;

      if (validFiles.length > 0) {
        let html = `<table><thead><tr><th class="status-heading" aria-label="Status"></th><th aria-label="File name"></th></tr></thead><tbody>`;
        for (let i = 0; i < validFiles.length; i++) {
          const fileName = validFiles[i].fileName;
          console.log(fileName);
          //const fileName = filePath.split(/[\\/]/).pop();
          html += `<tr data-index="${i}"><td class="status"><span class="loader" style="opacity: 0;"></span></td><td>${fileName}</td></tr>`;
        }
        html += `</tbody></table>`;
        fileList.innerHTML = html;
        document.querySelector(".drag-and-drop").style.display = "none";
        document.querySelector(".file-count").innerHTML = `${validFiles.length} files`;
      } else {
        fileList.textContent = 'No valid RAR4 CBR files detected.';
      }
    });

    convertBtn.addEventListener('click', async () => {
      const outputDir = await window.api.selectOutputFolder();
      if (!outputDir) return;
      convertBtn.disabled = true;
      progress.textContent = 'Starting conversion...';
      window.api.convertFiles({ files: validFiles, outputDir });
    });

    resetBtn.addEventListener('click', async() => {
        location.reload();
    });

    window.api.onProgress((percent) => {
      progress.textContent = `Converting... ${percent}%`;
    });

    window.api.onComplete(() => {
      progress.textContent = '✅ Conversion complete!';
    });

    window.api.onFileStatus(({ index, status }) => {
      const row = document.querySelector(`tr[data-index='${index}'] .status`);
    if (row) {
        if (status == "Processing") {
            const span = document.createElement('span');
            span.classList.add('loader');
            row.innerHTML = ''; // Optional: clear previous content
            row.appendChild(span);
        } else if (status == "Done") {
            row.innerHTML = `<svg class="checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52"><circle class="checkmark__circle" cx="26" cy="26" r="25" fill="none" /><path class="checkmark__check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8" /></svg>`;
        } else if (status == "Error") {
            row.innerHTML = "❌";
        }
      }
    });