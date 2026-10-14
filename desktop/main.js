// Neon Rooftops desktop host. Embedded Chromium window, no external browser.
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 560,
    autoHideMenuBar: true,          // no File/Edit menu
    title: 'Neon Rooftops',
    backgroundColor: '#07081a',
    useContentSize: true,
    webPreferences: { contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, 'game', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
