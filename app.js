    const dropZone = document.getElementById('drop-zone');
    const fileList = document.getElementById('file-list');
    const convertBtn = document.getElementById('convert-btn');
    const resetBtn = document.getElementById('reset-btn');
    const progress = document.getElementById('progress');
    let validFiles = [];

    document.getElementsByClassName("titlebar")[0].addEventListener("click", toolbarActions);

    window.api.notify('Conversion Finished', 'Your comics were converted successfully!');


    function toolbarActions(event) {
      const element = event.target;
      if (element && (element.parentElement?.id === "btnMinimize" || element.id === "btnMinimize")) {
        window.api.minimizeWindow();
      }
      if (element && (element.parentElement?.id === "btnMaximize" || element.id === "btnMaximize")) {
        window.api.toggleMaximizeWindow();
      }
      if (element && (element.parentElement?.id === "btnClose" || element.id === "btnClose")) {
        window.api.closeWindow();
      }
    }

    const applyTheme = () => {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.body.dataset.theme = isDark ? 'dark' : 'light';
    };

    // Apply on load
    applyTheme();

    // Listen for changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add("action-dragover");
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove("action-dragover");
    });

    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropZone.classList.remove("action-dragover");
      const paths = [...e.dataTransfer.files].map(f => f.path);
      validFiles = await window.api.validateCBRs(paths);
      convertBtn.disabled = validFiles.length === 0;

      if (validFiles.length > 0) {
        let html = `<table><thead><tr><th class="status-heading" aria-label="Status"></th><th aria-label="File name"></th><th aria-label="Output format"></th></tr></thead><tbody>`;
        for (let i = 0; i < validFiles.length; i++) {
          const fileName = validFiles[i].fileName;
          console.log(fileName);
          //const fileName = filePath.split(/[\\/]/).pop();
          // html += `<tr data-index="${i}"><td class="status"><span class="loader" style="opacity: 0;"></span></td><td>${fileName}</td></tr>`;
          html += `<tr data-index="${i}">
            <td class="status"><span class="loader" style="opacity: 0;"></span></td>
            <td>${fileName}</td>
            <td>
              <select class="format-select">
                <option value="cbz">CBZ</option>
                <option value="epub">EPUB</option>
              </select>
            </td>
          </tr>`;
        }
        html += `</tbody></table>`;
        fileList.innerHTML = html;
        document.querySelector(".drag-and-drop").style.display = "none";
        document.querySelector("#reset-btn").style.display = "block";
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

      const rows = document.querySelectorAll("#file-list tbody tr");
      const filesWithFormats = validFiles.map((file, i) => {
        const format = rows[i].querySelector(".format-select").value;
        return { ...file, outputFormat: format };
      });

      window.api.convertFiles({ files: filesWithFormats, outputDir });
    });

    resetBtn.addEventListener('click', async() => {
        location.reload();
    });

    window.api.onProgress((percent) => {
      progress.textContent = `Converting... ${percent}%`;
    });

    window.api.onComplete(() => {
      progress.textContent = '✅ Conversion complete!';
      window.api.notify('Comic Book Converter', 'Conversion process has completed.');
      document.querySelector("#reset-btn").textContent = "Convert more";
    });

    window.api.onConversionErrors(() => {
      progress.textContent = '❌ Conversion failed!';
      window.api.notify('Comic Book Converter', 'Conversion process has completed,but encountered errors.');
      document.querySelector("#reset-btn").textContent = "Convert more";
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