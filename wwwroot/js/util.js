function downloadBlob(filename, blob) {
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function saveFile(filename, content, contentType = "text/plain;charset=utf-8") {
    downloadBlob(filename, new Blob([content], { type: contentType }));
}

async function readFile(name) {
   
    const input = document.getElementById(name);
    const files = input.files;
    var file = files[0];
    var reader = new FileReader();

    return await new Promise((resolve, reject) => {
        reader.onerror = () => {
            reader.abort();
            reject(new DOMException("Problem parsing input file."));
        };

        reader.onload = () => resolve(reader.result);

        reader.readAsText(file);
    });
}

async function exportAutomatonImage(fileName, dot, format) {
    const svg = Viz(dot, { format: 'svg', engine: 'dot' });
    return downloadRenderedAutomatonImage(fileName, svg, format);
}

async function downloadRenderedAutomatonImage(fileName, svg, format) {
    if (format !== 'svg' && format !== 'png') throw new Error('Choose SVG or PNG for a drawing.');
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    if (format === 'svg') {
        downloadBlob(fileName, blob);
        return;
    }
    const source = URL.createObjectURL(blob);
    try {
        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('The automaton drawing could not be loaded. Try SVG instead.'));
            img.src = source;
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context || !canvas.width || !canvas.height) throw new Error('The drawing is too large for PNG. Choose SVG or DOT.');
        context.drawImage(img, 0, 0);
        const png = await new Promise((resolve, reject) => {
            canvas.toBlob(result => result ? resolve(result) : reject(new Error('PNG conversion failed. Try SVG instead.')), 'image/png');
        });
        downloadBlob(fileName, png);
    } finally {
        URL.revokeObjectURL(source);
    }
}

function downloadSVG(fileName, dot) { return exportAutomatonImage(fileName, dot, 'svg'); }
function downloadPNG(fileName, dot) { return exportAutomatonImage(fileName, dot, 'png'); }

window.saveFile = saveFile;
window.readFile = readFile;
window.GraphViz = dot => Viz(dot);
window.downloadPNG = downloadPNG;
window.downloadSVG = downloadSVG;
window.exportAutomatonImage = exportAutomatonImage;
window.downloadRenderedAutomatonImage = downloadRenderedAutomatonImage;
