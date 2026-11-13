function saveFile(filename, content) {
    const a = document.createElement("a");
    const file = new Blob([content], { type: "application/octet-stream;charset=utf-8" });
    a.href = URL.createObjectURL(file);
    a.download = filename.replace(/[\\/:*?"<>|]/g, '_');
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function readFile(name) {
   
    const input = document.getElementById(name);
    const file = input?.files?.[0];
    if (!file) throw new Error("Choose a file to import.");
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

function resetFileInput(name) {
    const input = document.getElementById(name);
    if (input) input.value = "";
}

function downloadSVG(fileName, dot) {
    const content = Viz(dot, { format: 'svg', engine: 'dot', scale: undefined, totalMemory: 1024 * 1024 * 1024, files: undefined, images: undefined });
    const a = document.createElement('a');
    const file = new Blob([content], { type: 'text/plain' });
    a.href = URL.createObjectURL(file);
    a.download = fileName;
    a.click();
}

function downloadPNG(fileName, dot) {
    const content = Viz(dot, { format: 'svg', engine: 'dot', scale: undefined, totalMemory: 1024 * 1024 * 1024, files: undefined, images: undefined });
    Viz.svgXmlToPngImageElement(content, undefined, (err, img) => {
        const source = img.src;
        const a = document.createElement('a');
        document.body.appendChild(a);

        a.href = source;
        a.target = '_self';
        a.download = fileName;
        a.click();
    });
}

window.saveFile = saveFile;
window.readFile = readFile;
window.resetFileInput = resetFileInput;
window.GraphViz = dot => Viz(dot);
window.downloadPNG = downloadPNG;
window.downloadSVG = downloadSVG;
