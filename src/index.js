const Tesseract = require('tesseract.js');
const { createWorker } = Tesseract;
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const {
  app,
  BrowserWindow,
  Menu,
  clipboard,
  desktopCapturer,
  ipcMain,
  Tray,
  nativeImage,
  screen,
  Rectangle,
  globalShortcut
} = require('electron');
const url = require('url');
const { electron } = require('process');
const { log } = require('console');
const execPromise = promisify(exec);
const debugMode = false;
//configuracion del menu principal
if (process.env.NODE_ENV === undefined) {
  process.env.NODE_ENV = 'production';
  console.log('NODE_ENV set to production.');
}
const templateMenu = [
  {
    label: 'Actions',
    submenu: [
      {
        label: 'Convert to text',
        accelerator: 'Ctrl+T',
        click() {
          executeImageToText();
        }
      },
      {
        label: 'Screen capture',
        accelerator: 'Ctrl+S',
        click() {
          createSelectionWindow();
        }
      },
      {
        label: 'Exit',
        accelerator: 'Ctrl+Q',
        click: () => {
          app.isQuiting = true;
          app.quit();
        }
      }
    ]
  }
];
//ejecuta el reload de node modules si la variable NODE_ENV distinto a "development"
if (process.env.NODE_ENV === 'dev') {
  require('electron-reload')(__dirname, {});
}
let mainWindow;
// Manejar la única instancia de la aplicación
const isSingleInstance = app.requestSingleInstanceLock();

if (!isSingleInstance) {
  app.quit(); // Si no se obtiene el bloqueo, cerrar la nueva instancia
  return;
}

// Cuando la segunda instancia solicita una instancia existente
app.on('second-instance', (event, argv, workingDirectory) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore(); // Restaurar ventana si está minimizada
    }
    mainWindow.focus(); // Enfocar ventana
  }
});

// Función para crear la ventana principal
function createWindow() {
  mainWindow = new BrowserWindow({
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      nodeIntegrationInWorker: true,
      enableRemoteModule: true
    },
    width: 620,
    height: 470,
    title: 'Image to text'
  });

  if (debugMode) {
    mainWindow.webContents.openDevTools();
  }

  // Enlazar index.html a mainWindow
  mainWindow.loadURL(
    url.format({
      pathname: path.join(__dirname, 'views/index.html'),
      protocol: 'file',
      slashes: true
    })
  );

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  const mainMenu = Menu.buildFromTemplate(templateMenu);
  Menu.setApplicationMenu(mainMenu);

  // Manejar el evento 'close'
  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      // Evitar que la ventana se cierre
      event.preventDefault();
      // Ocultar la ventana
      mainWindow.hide();
    }
  });

  // Crear el icono de la bandeja
  const trayIconPath = path.join(__dirname, '/images/infiniteLogo.png'); // Cambia esto a la ruta de tu icono
  tray = new Tray(nativeImage.createFromPath(trayIconPath));

  // Crear el menú contextual de la bandeja
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open',
      click: () => {
        mainWindow.show();
      }
    },
    {
      label: 'Exit',
      click: () => {
        app.isQuiting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip('Image to text');

  // Manejar el doble clic en el icono de la bandeja
  tray.on('double-click', () => {
    mainWindow.show();
  });

  // Registrar atajos globales
  globalShortcut.register('Ctrl+S', () => {
    if (mainWindow.isMinimized()) {
      createSelectionWindow();
    } else {
      mainWindow.minimize();
      createSelectionWindow();
    }
  });
}

let selectionWindow;

function createSelectionWindow() {
  // Minimiza la ventana principal antes de crear la ventana de selección
  mainWindow.minimize();

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  selectionWindow = new BrowserWindow({
    x: 0,
    y: 0,
    width: width,
    height: height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  selectionWindow.loadURL(`file://${path.join(__dirname, 'views/selection.html')}`);

  ipcMain.once('selection-made', (event, selection) => {
    // Minimiza la ventana de selección antes de capturar
    selectionWindow.minimize();

    // Captura la pantalla
    handleSelection(selection.x, selection.y, selection.width, selection.height);

    // Espera un segundo antes de restaurar la ventana principal
    setTimeout(() => {
      selectionWindow.close();
      mainWindow.restore();
    }, 2000); // 1000 ms = 1 segundo
  });

  // Detectar cuando se presiona la tecla Esc
  selectionWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape') {
      selectionWindow.close(); // Cierra la ventana de selección
      mainWindow.restore(); // Restaura la ventana principal si se cancela la captura
    }
  });
}

// Si la app está lista, se abre la ventana principal
app.on('ready', () => {
  createWindow();
  // Limpiar atajos globales cuando la app se cierra
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
});

// Opcional: manejar el evento 'activate' para mostrar la ventana de nuevo si está oculta
app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

ipcMain.on('capture-screen', () => {
  createSelectionWindow();
});

ipcMain.on('convert-image-to-text', () => {
  executeImageToText();
});

function captureScreen(selection, retryCount = 0) {
  desktopCapturer
    .getSources({
      types: ['screen'],
      thumbnailSize: screen.getPrimaryDisplay().size
    })
    .then(async (sources) => {
      if (sources.length > 0) {
        try {
          // Captura la imagen completa de la pantalla
          const screenshotImage = sources[0].thumbnail.toPNG();

          // Crear una imagen desde el buffer
          const image = nativeImage.createFromBuffer(screenshotImage);

          // Obtener el tamaño de la pantalla y de la imagen capturada
          const screenSize = screen.getPrimaryDisplay().size;
          const { width: imageWidth, height: imageHeight } = image.getSize();
          const { x, y, width, height } = selection;

          // Escalar la selección en función del tamaño de la imagen capturada
          const scaleX = imageWidth / screenSize.width;
          const scaleY = imageHeight / screenSize.height;

          const croppedX = Math.round(x * scaleX);
          const croppedY = Math.round(y * scaleY);
          const croppedWidth = Math.round(width * scaleX);
          const croppedHeight = Math.round(height * scaleY);

          if (croppedWidth > 0 && croppedHeight > 0) {
            // Recorta la imagen
            const croppedImage = image.crop({
              x: croppedX,
              y: croppedY,
              width: croppedWidth,
              height: croppedHeight
            });

            // Convertir la imagen recortada a Data URL
            const croppedDataURL = croppedImage.toDataURL();

            // Enviar la imagen recortada al renderer para mostrarla en la aplicación
            mainWindow.webContents.send('update-screenshot', croppedDataURL);

            // Guardar la imagen recortada en el portapapeles
            clipboard.writeImage(croppedImage);
          } else {
            console.error('Invalid cropping dimensions.');
          }
        } catch (err) {
          console.error('Error processing the image:', err);
        }
      }
    })
    .catch((err) => {
      console.error('Error capturing screen:', err);
      if (retryCount < 3) {
        setTimeout(() => captureScreen(selection, retryCount + 1), 1000);
      }
    });
}

// Función para manejar la selección del área
function handleSelection(x, y, width, height) {
  const selection = { x, y, width, height };
  captureScreen(selection);
}

//funcion para remplazar el clipboard con lo que contiene una variable
async function replaceClipboardWithText(text) {
  try {
    clipboard.writeText(text); // Copia el texto al portapapeles
    console.log('--------------------------------------------');
    console.log('--Texto copiado al portapapeles con exito!--');
    console.log('--------------------------------------------');
  } catch (error) {
    throw new Error(`Error al copiar el texto al portapapeles: ${error.message}`);
  }
}

async function saveClipboardImageAsFile(filePath) {
  try {
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      throw new Error('No hay imagen en el portapapeles.');
    }
    const imageBuffer = image.toPNG(); // Convertir la imagen a un buffer PNG
    fs.writeFileSync(filePath, imageBuffer);
  } catch (error) {
    console.error('Error al guardar la imagen:', error);
  }
}

//Convertir imagen a texto y pasar el texto al clipboard
async function executeImageToText() {
  const tempFilePath = path.join(os.tmpdir(), 'temp_image.png');
  const tessdataPath = path.join(__dirname, 'tessdata'); // Asegúrate de que esta ruta sea correcta

  async function processClipboardImage() {
    try {
      await saveClipboardImageAsFile(tempFilePath);

      const worker = await createWorker();

      try {
        const {
          data: { text }
        } = await worker.recognize(tempFilePath);
        console.log('Texto extraído:', text);

        replaceClipboardWithText(text);
        mainWindow.webContents.send('display-text', text);
      } catch (error) {
        console.error('Error processing image with Tesseract:', error);
      } finally {
        await worker.terminate();
      }

      fs.unlinkSync(tempFilePath);
    } catch (error) {
      console.error('Error al procesar la imagen:', error);
    }
  }

  await processClipboardImage();
}
