// Auto-generated mask utils for pixel-perfect rock collision (Rock.png -> 464x464)
const fs = require('fs');
const width = 464;
const height = 464;
const raw = fs.readFileSync(__dirname + '/public/rock_mask.txt', 'utf8').trim();
const mask = raw.split('').map(Number);

// Build a 2D prefix-sum (integral image) to allow O(1) rectangle queries
const W = width, H = height;
const stride = W + 1;
const prefix = new Uint32Array((W + 1) * (H + 1));
for (let y = 1; y <= H; y++) {
  let row = 0;
  for (let x = 1; x <= W; x++) {
    row += mask[(x - 1) + (y - 1) * W];
    prefix[x + y * stride] = prefix[x + (y - 1) * stride] + row;
  }
}

function rectSum(x0, y0, x1, y1) {
  // x0,y0,x1,y1 are 0-based inclusive mask coords
  if (x1 < x0 || y1 < y0) return 0;
  x0 = Math.max(0, Math.min(W - 1, x0));
  x1 = Math.max(0, Math.min(W - 1, x1));
  y0 = Math.max(0, Math.min(H - 1, y0));
  y1 = Math.max(0, Math.min(H - 1, y1));
  const X0 = x0 + 1, Y0 = y0 + 1, X1 = x1 + 1, Y1 = y1 + 1;
  return prefix[X1 + Y1 * stride] - prefix[(X0 - 1) + Y1 * stride] - prefix[X1 + (Y0 - 1) * stride] + prefix[(X0 - 1) + (Y0 - 1) * stride];
}

function isAreaSolid(x0, y0, x1, y1) {
  return rectSum(x0, y0, x1, y1) > 0;
}

module.exports = { width: W, height: H, mask, isAreaSolid };
