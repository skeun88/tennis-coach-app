// One-off asset generator: KERRI terracotta wordmark PNG (transparent bg).
// Shared by native splash (expo-splash-screen) and React BrandLoadingScreen
// so glyphs/kerning are identical across platforms. Run: node scripts/gen-wordmark.js
const sharp = require('sharp');
const path = require('path');

const TERRA = '#C0755A';
const FONT_SIZE = 900;
const LETTER_SPACING = -22; // proportional to the validated -8 @ 320
const W = 4000, H = 1400;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <text x="${W / 2}" y="${H * 0.72}" font-family="Helvetica, Arial, sans-serif" font-weight="900"
        font-size="${FONT_SIZE}" letter-spacing="${LETTER_SPACING}" fill="${TERRA}" text-anchor="middle">KERRI</text>
</svg>`;

const out = path.join(__dirname, '..', 'assets', 'kerri-wordmark.png');

(async () => {
  // Render, trim transparent margins, then add small uniform transparent padding.
  const trimmed = await sharp(Buffer.from(svg)).png().trim().toBuffer();
  const meta = await sharp(trimmed).metadata();
  const pad = Math.round(meta.height * 0.06);
  await sharp(trimmed)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(out);
  const final = await sharp(out).metadata();
  console.log('wrote', out);
  console.log('dims', final.width + 'x' + final.height, 'aspect(w/h)=', (final.width / final.height).toFixed(4));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
