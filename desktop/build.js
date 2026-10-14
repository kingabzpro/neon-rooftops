// Build: copy the game files from ../game (single source of truth), then pack
// a standalone Windows exe with electron-packager.
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const src = path.join(__dirname, '..', 'game');
const dst = path.join(__dirname, 'game');
fs.mkdirSync(dst, { recursive: true });
for (const f of ['index.html', 'game.js']) {
  fs.copyFileSync(path.join(src, f), path.join(dst, f));
  console.log('copied', f);
}

console.log('packaging (first run downloads Electron ~110 MB into npm cache)...');
execSync(
  'npx electron-packager . "Neon Rooftops" --platform=win32 --arch=x64 --out=dist --overwrite --ignore="^/build\\.js$|^/dist"',
  { stdio: 'inherit', cwd: __dirname, env: process.env }
);
console.log('\nDone. exe: dist\\Neon Rooftops-win32-x64\\Neon Rooftops.exe');
