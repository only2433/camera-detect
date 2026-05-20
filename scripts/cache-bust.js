'use strict';
const fs     = require('fs');
const crypto = require('crypto');

function fileHash(path) {
  return crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex').slice(0, 8);
}

const jsHash  = fileHash('public/app.js');
const cssHash = fileHash('public/style.css');

let html = fs.readFileSync('public/index.html', 'utf8');
html = html.replace(/style\.css\?v=[^"]+/, `style.css?v=${cssHash}`);
html = html.replace(/app\.js\?v=[^"]+/,    `app.js?v=${jsHash}`);
fs.writeFileSync('public/index.html', html);

console.log(`cache-bust: css=${cssHash} js=${jsHash}`);
