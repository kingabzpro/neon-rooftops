// minimal PNG decoder (8-bit RGBA, non-interlaced) + contrast metrics
// usage: node pngcheck.js file.png
'use strict';
const fs = require('fs'), zlib = require('zlib');

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let pos = 8, w = 0, h = 0, bitDepth, colorType;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) throw new Error(`unsupported png: depth=${bitDepth} color=${colorType}`);
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const row = raw.subarray(p, p + stride); p += stride;
    const prevBase = (y - 1) * stride, curBase = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[curBase + x - bpp] : 0;
      const b = y > 0 ? out[prevBase + x] : 0;
      const c = (x >= bpp && y > 0) ? out[prevBase + x - bpp] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
        v = (v + pr) & 0xff;
      }
      out[curBase + x] = v;
    }
  }
  return { w, h, bpp, px: out };
}

const file = process.argv[2];
const img = decodePNG(fs.readFileSync(file));
const { w, h, bpp, px } = img;
const get = (x, y) => {
  const i = (y * w + x) * bpp;
  return [px[i], px[i + 1], px[i + 2]];
};
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// find cat: orange #f39b3f (243,155,63) with tolerance
let catMinX = 1e9, catMaxX = -1, catMinY = 1e9, catMaxY = -1, catPx = 0;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const [r, g, b] = get(x, y);
  if (Math.abs(r - 243) < 25 && Math.abs(g - 155) < 25 && Math.abs(b - 63) < 30) {
    catPx++;
    catMinX = Math.min(catMinX, x); catMaxX = Math.max(catMaxX, x);
    catMinY = Math.min(catMinY, y); catMaxY = Math.max(catMaxY, y);
  }
}
// chimneys: shaft #434a78 (67,74,120)
let chimPx = 0, chimMinY = 1e9, chimMaxY = -1;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const [r, g, b] = get(x, y);
  if (Math.abs(r - 67) < 14 && Math.abs(g - 74) < 14 && Math.abs(b - 120) < 18) {
    chimPx++; chimMinY = Math.min(chimMinY, y); chimMaxY = Math.max(chimMaxY, y);
  }
}
// background noise in the cat's horizontal band, excluding cat bbox and roof:
// bright pixels (lum > 160) that are not cat
const bandY0 = catMaxY - 40, bandY1 = catMaxY;      // 40px above feet
let brightBg = 0, totalBand = 0, bandMaxLum = 0;
for (let y = Math.max(0, bandY0); y <= Math.min(h - 1, bandY1); y++) {
  for (let x = 0; x < w; x++) {
    if (x >= catMinX - 4 && x <= catMaxX + 4) continue;  // skip cat
    const l = lum(get(x, y));
    totalBand++;
    if (l > 160) brightBg++;
    bandMaxLum = Math.max(bandMaxLum, l);
  }
}
const catLum = lum([243, 155, 63]);
console.log(JSON.stringify({
  file, w, h,
  cat: { px: catPx, bbox: [catMinX, catMinY, catMaxX, catMaxY], lum: Math.round(catLum) },
  chimneys: { px: chimPx, yRange: chimMinY === 1e9 ? null : [chimMinY, chimMaxY] },
  playBand: { brightBgPx: brightBg, totalPx: totalBand, pct: +(100 * brightBg / totalBand).toFixed(2), maxLum: Math.round(bandMaxLum) },
  verdict: catPx > 150 && (100 * brightBg / totalBand) < 1 ? 'CAT READABLE' : 'CHECK CONTRAST',
}, null, 1));
