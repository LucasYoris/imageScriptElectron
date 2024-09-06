const { ipcRenderer } = require('electron');

// Manejo del evento 'display-text'
ipcRenderer.on('display-text', (event, text) => {
    document.getElementById('output').innerText = text;
    console.log("RENDERED:", text);
});

// Manejo del evento 'update-screenshot'
ipcRenderer.on('update-screenshot', (event, screenshotImage) => {
    document.getElementById('screenshot-image').src = screenshotImage;
});

document.getElementById('capture-btn').addEventListener('click', () => {
  ipcRenderer.send('capture-screen');
});

document.getElementById('convert-btn').addEventListener('click', () => {
  ipcRenderer.send('convert-image-to-text');
});