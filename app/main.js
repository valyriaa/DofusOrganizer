const path = require('path'), fs = require('fs');
const Module = require('module');
const originalLoad = Module._load;

const isPackaged = process.isPackaged = (() => {
  const main = process.mainModule || require.main;
  return (main && (
    main.filename.includes('app.asar') ||
    main.filename.includes('resources\\app\\main.js')
  ))
})();

Module._load = function (request, parent, isMain) {
  if (request.endsWith('.node') && isPackaged) {
    const newPath = path.join(process.resourcesPath, "app.asar.unpacked", path.basename(request));
    return originalLoad.apply(this, [newPath, parent, isMain]);
  }
  return originalLoad.apply(this, arguments);
};

const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const Settings = require('./settings');
const Container = require('./container');
const https = require('https');
const Lang = require('./assets/lang.json');
const { exec } = require("child_process");

const DEFAULT_API = "https://organizer-dofus.com/version";
const MAX_BUBBLE_SIZE = 200;
const ICON_PATH = path.join(__dirname, "assets", "icon.png");

const DEFAULT_WIN = {
  width: 760,
  height: 650,
  frame: false,
  show: true,
  movable: true,
  resizable: true,
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    nodeIntegration: true,
    contextIsolation: false
  }
}

function isProcessRunning(exeName = "Dofus.exe") {
  return new Promise((resolve, reject) => {
    exec(`tasklist /FI "IMAGENAME eq ${exeName}"`, (err, stdout) => {
      if (err) return reject(err);
      const isRunning = stdout.toLowerCase().includes(exeName.toLowerCase());
      resolve(isRunning);
    });
  });
}

function getWindowPosition(screen, winWidth, winHeight, pos) {
  const { width, height, x, y } = screen.getPrimaryDisplay().workArea;

  const calc = {
    "center": [
      x + (width - winWidth) / 2,
      y + (height - winHeight) / 2
    ],
    "center-right": [
      x + width - winWidth,
      y + (height - winHeight) / 2
    ],
    "center-left": [
      x,
      y + (height - winHeight) / 2
    ],
    "top-center": [
      x + (width - winWidth) / 2,
      y
    ],
    "top-right": [
      x + width - winWidth,
      y
    ],
    "top-left": [
      x,
      y
    ]
  };
  return calc[pos] || calc["center"];
}

function repositionWindow(win, positionSetting) {
  if (!win) return;

  const [px, py] = getWindowPosition(
    screen,
    win.getBounds().width,
    win.getBounds().height,
    positionSetting
  );

  win.setPosition(Math.round(px), Math.round(py));
}

function fetchVersionData(targetUrl = DEFAULT_API, maxRedirects = 5) {
  return new Promise((resolve) => {
    if (maxRedirects <= 0) {
      console.error('Too many redirects');
      return resolve(null);
    }

    https.get(targetUrl, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const redirectUrl = res.headers.location;
        resolve(fetchVersionData(redirectUrl, maxRedirects - 1));
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          console.error('Failed to parse version data:', err.message);
          resolve(null);
        }
      });

    }).on('error', (err) => {
      console.error('Request Error:', err.message);
      resolve(null);
    });
  });
}

const NOTIFICATION_TYPE = {
  error: {
    type: "error",
    title: Localized("error")
  },
  warn: {
    type: "warning",
    title: Localized("warning"),
  },
  info: {
    type: "info",
    title: Localized("information"),
  },
  success: {
    type: "info",
    title: Localized("success"),
  }
};

function Localized(message, ...args) {
  const local = Settings.instance.get('lang');
  if (!Lang || !Lang[local] || !Lang[local][message]) {
    return message;
  }
  let lc = Lang[local][message];
  for (let i = 0; i < args.length; i++) {
    let arg = !args[i] ? "" : args[i].toString();
    lc = lc.replace(`%${i}`, arg);
  }
  return lc;
}

function notify(type, message) {
  const win = BrowserWindow.getFocusedWindow();
  const localizedMessage = Localized(message);
  const config = NOTIFICATION_TYPE[type] || NOTIFICATION_TYPE.info;
  return dialog.showMessageBox(win, {
    type: config.type,
    title: config.title,
    message: config.title,
    detail: localizedMessage,
    buttons: ["OK"],
    defaultId: 0,
    cancelId: 0
  });
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
  return;
}

if (process.platform === 'win32') {
  let isEnabled = Settings.instance.get('open_startup');
  app.setLoginItemSettings({
    openAtLogin: isEnabled,
    path: process.execPath,
    args: []
  });
  console.log(isEnabled ? 'added to startup.' : 'removed from startup.');
}

app.whenReady().then(async () => {
  const versionData = await fetchVersionData();
  const Windows = (function createMainWindows() {
    const [px, py] = getWindowPosition(screen, 200, 200, Settings.instance.get('core_start_pos'));

    const main = new BrowserWindow({
      ...DEFAULT_WIN,
      width: 200,
      height: 400,
      x: px,
      y: py,
      frame: false,
      transparent: true
    });

    const settings = new BrowserWindow({
      ...DEFAULT_WIN,
      width: 760,
      height: 650,
      frame: false,
      show: false,
      movable: true,
      resizable: true
    });

    const hintCropper = new BrowserWindow({
      ...DEFAULT_WIN,
      width: 850,
      height: 550,
      frame: false,
      movable: true,
      show: false
    });

    main.setSkipTaskbar(true);
    main.setAlwaysOnTop(true);
    settings.setSkipTaskbar(true);
    hintCropper.setSkipTaskbar(true);

    settings.once('close', function (e) {
      settings.hide();
      //context.items[0].enabled = true;
    });

    settings.loadFile(path.join(__dirname, 'assets/pages/settings.html'));
    main.loadFile(path.join(__dirname, 'assets/pages/index.html'));
    hintCropper.loadFile(path.join(__dirname, 'assets/pages/cropper.html'));

    main.once("ready-to-show", () => {
      main.setIgnoreMouseEvents(true, { forward: true });
    });


    return { main, settings, hintCropper };
  })();

  ipcMain.on('clickable-area', (_ev, shouldEnableClicks) => {
    Windows.main && Windows.main.setIgnoreMouseEvents(!shouldEnableClicks, { forward: true });
  });

  ipcMain.handle('version-data', () => versionData);

  ipcMain.handle('close-app', async () => {
    const choice = dialog.showMessageBoxSync(Windows.main, {
      type: 'question',
      buttons: [Localized('button_yes'), Localized('button_no')],
      defaultId: 1,
      cancelId: 1,
      icon: ICON_PATH,
      title: Localized('quit_title'),
      message: Localized('app_close_question'),
      detail: Localized('app_close_details')
    });
    if (choice === 0) {
      await teamContainer.exit();
      app.quit();
    }
  });

  ipcMain.handle('move-window', (event, dx, dy) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const bounds = win.getBounds();
    win.setBounds({
      x: bounds.x + dx,
      y: bounds.y + dy,
      width: bounds.width,
      height: bounds.height
    });
  });

  ipcMain.handle('select-export-folder', async () => {
    const result = await dialog.showOpenDialog(Windows.hintCropper, {
      title: Localized('select_export_folder'),
      properties: ['openDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('export_crop', async (_, folderPath, fileName, selection) => {
    const finalPath = path.join(folderPath, `${fileName}.png`);
    if (fs.existsSync(finalPath)) {
      const result = await dialog.showMessageBox(Windows.hintCropper, {
        type: "warning",
        title: Localized(`crop_export_exists`, fileName),
        message: Localized("replace_export_file_question"),
        buttons: ["Oui", "Non"],
        defaultId: 0,
        cancelId: 0
      });
      if (result.response == 1) {
        return;
      }
    }
    const { base64, rect, from } = selection;
    await Promise.all([
      fs.promises.writeFile(finalPath, Buffer.from(base64, 'base64')),
      fs.promises.writeFile(`${finalPath}.r`, JSON.stringify({ rect, from }))
    ]);
    await dialog.showMessageBox(Windows.hintCropper, {
      type: "info",
      detail: Localized(`export_file_saved`, fileName),
      buttons: ["Ok"],
      defaultId: 0,
      cancelId: 0
    });
  });

  ipcMain.handle('replace_hint', async (_, id, selection) => {
    const lang = Settings.instance.get('lang');
    const { base64, rect, from } = selection;
    const { originalWidth, originalHeight } = from;

    const targetFileName = `${id}_${lang}.png`;
    const targetLangDir = path.join(Settings.base_dir, lang, `${originalWidth}x${originalHeight}`);
    const targetFilePath = path.join(targetLangDir, targetFileName);

    try {
      if (!fs.existsSync(targetLangDir)) {
        await fs.promises.mkdir(targetLangDir, { recursive: true });
      }
      await Promise.all([
        fs.promises.writeFile(targetFilePath, Buffer.from(base64, 'base64')),
        fs.promises.writeFile(`${targetFilePath}.r`, JSON.stringify({ rect, from }))
      ])
      await dialog.showMessageBox(Windows.hintCropper, {
        type: "info",
        detail: Localized(`export_file_saved`, targetFileName),
        buttons: ["Ok"],
        defaultId: 0,
        cancelId: 0
      });
    }
    catch (error) {
      await dialog.showMessageBox(Windows.hintCropper, {
        type: "error",
        detail: Localized(`export_file_save_error`, targetFileName),
        buttons: ["Ok"],
        defaultId: 0,
        cancelId: 0
      });
    }
  });

  ipcMain.handle('notify', (_, type, message) => notify(type, message));

  ipcMain.handle('show-settings', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win != Windows.main) return;
    Windows.settings.show();
  });

  ipcMain.handle('update-settings', (_, key, val) => {
    if (key == 'core_start_pos' && Settings.instance.get(key) != val) {
      repositionWindow(Windows.main, val);
    }
    Settings.instance.set(key, val);
  });

  ipcMain.handle('hide-settings', () => Windows.settings.hide());
  ipcMain.handle('get-settings', () => Settings.instance.json());
  ipcMain.handle('get-local', () => Lang[Settings.instance.get('lang')] ?? {});

  ipcMain.handle('process-execute', (_, tabId, task, ...args) => teamContainer.process(tabId, task, ...args))
  ipcMain.handle('sync-play', (_, syncronized = true) => teamContainer.sync(syncronized));
  ipcMain.handle('process-frame', (_, processId) => teamContainer.processFrame(processId));
  ipcMain.handle('hide-cropper', () => Windows.hintCropper.hide());

  ipcMain.handle('open-external-url', (_, url) => {
    const openUrl = process.platform === 'win32'
      ? `start ${url}`
      : process.platform === 'darwin'
        ? `open ${url}`
        : `xdg-open ${url}`;

    return new Promise((resolve) => exec(openUrl, resolve));
  });

  if (await isProcessRunning("Dofus.exe")) {
    await notify("warning", Localized("dofus_running"));
    return app.exit();
  }

  const teamContainer = new Container(Windows, "Dofus", "Dofus.exe");

  teamContainer.on('new-process', function () {
    const size = teamContainer.processes * MAX_BUBBLE_SIZE + MAX_BUBBLE_SIZE;
    Windows.main.setSize(size, 200);
  });

  teamContainer.on('remove-process', function () {
    const size = teamContainer.processes == 0 ? MAX_BUBBLE_SIZE : (teamContainer.processes * MAX_BUBBLE_SIZE + MAX_BUBBLE_SIZE);
    Windows.main.setSize(size, 200);
  });

  // Windows.main.webContents.openDevTools({
  //   mode: 'undocked',
  //   activate: true
  // })
});