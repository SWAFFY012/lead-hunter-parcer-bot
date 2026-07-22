const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { exec, spawn } = require('child_process');
const http = require('http');

let mainWindow;
let logProcess = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 850,
    height: 700,
    title: 'LeadHunter Launcher',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#0F172A',
    autoHideMenuBar: true
  });

  mainWindow.loadFile('launcher.html');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers
ipcMain.handle('start-app', async () => {
  return new Promise((resolve, reject) => {
    const pm2Path = path.join(__dirname, 'node_modules', '.bin', 'pm2');
    exec(`"${pm2Path}" start ecosystem.config.cjs`, { cwd: __dirname }, (error, stdout, stderr) => {
      if (error) {
        return reject(error.message);
      }
      setTimeout(() => {
        resolve(true);
      }, 1000); 
    });
  });
});

ipcMain.handle('restart-app', async () => {
  return new Promise((resolve, reject) => {
    const pm2Path = path.join(__dirname, 'node_modules', '.bin', 'pm2');
    exec(`"${pm2Path}" restart all`, { cwd: __dirname }, (error, stdout, stderr) => {
      if (error) return reject(error.message);
      setTimeout(() => resolve(true), 1500); 
    });
  });
});

ipcMain.handle('open-app', async () => {
  shell.openExternal('http://localhost:5173');
  return true;
});

ipcMain.handle('safe-stop', async () => {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3001,
      path: '/api/system/shutdown',
      method: 'POST'
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (!parsed.ok) {
            reject(parsed.error);
          } else {
            setTimeout(() => {
              const pm2Path = path.join(__dirname, 'node_modules', '.bin', 'pm2');
              exec(`"${pm2Path}" stop all`, { cwd: __dirname }, (err) => {
                resolve(true);
              });
            }, 1000);
          }
        } catch (e) {
          reject('Invalid response from backend');
        }
      });
    });

    req.on('error', (e) => {
      // Backend already dead
      const pm2Path = path.join(__dirname, 'node_modules', '.bin', 'pm2');
      exec(`"${pm2Path}" stop all`, { cwd: __dirname }, (err) => {
        resolve(true);
      });
    });

    req.end();
  });
});

ipcMain.handle('force-stop', async () => {
  return new Promise((resolve) => {
    const pm2Path = path.join(__dirname, 'node_modules', '.bin', 'pm2');
    exec(`"${pm2Path}" stop all && killall node || true`, { cwd: __dirname }, () => {
      resolve(true);
    });
  });
});

ipcMain.on('start-logs', (event) => {
  if (logProcess) {
    logProcess.kill();
  }
  const pm2Path = path.join(__dirname, 'node_modules', '.bin', 'pm2');
  logProcess = spawn(pm2Path, ['logs', '--lines', '50', '--raw'], { cwd: __dirname });

  logProcess.stdout.on('data', (data) => {
    event.reply('log-data', data.toString());
  });

  logProcess.stderr.on('data', (data) => {
    event.reply('log-data', data.toString());
  });
});

ipcMain.on('stop-logs', () => {
  if (logProcess) {
    logProcess.kill();
    logProcess = null;
  }
});

ipcMain.on('close-launcher', () => {
  app.quit();
});
