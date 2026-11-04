// Generates the PWA icons into public/. Run once: node scripts/icons.mjs
import sharp from "sharp";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#c9704a"/>
  <g transform="translate(256 262)">
    <path d="M-150 -110 Q-75 -135 0 -95 L0 135 Q-75 100 -150 125 Z" fill="#fff6e8"/>
    <path d="M150 -110 Q75 -135 0 -95 L0 135 Q75 100 150 125 Z" fill="#f4dfc2"/>
    <path d="M0 -150 l14 30 33 4 -25 22 7 33 -29 -17 -29 17 7 -33 -25 -22 33 -4z" fill="#f2b84b" transform="translate(0 -10) scale(1.1)"/>
  </g>
</svg>`;
const buf = Buffer.from(svg);
await sharp(buf).resize(512, 512).png().toFile("public/icon-512.png");
await sharp(buf).resize(192, 192).png().toFile("public/icon-192.png");
await sharp(buf).resize(180, 180).png().toFile("public/apple-touch-icon.png");
console.log("icons done");
