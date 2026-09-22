// Deterministic atlas packing only; the blade artwork and alpha are ImageGen sources.
// Requires ImageMagick 7 on PATH. Run from the repository root.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const destination = path.join(root, 'src/app/public/textures/grass');
const sourcePaths = ['meadow-v2-a.png', 'meadow-v2-b.png'].map(name => path.join(root, 'assets/grass-card-sources', name));
const names = ['tall', 'medium', 'leftFan', 'rightFan', 'basal', 'dry', 'wisps', 'seeds'];
const width = 2048, height = 1024, slot = 512, gutter = 16, inner = slot - gutter * 2;
const atlas = Buffer.alloc(width * height * 4), regions = {}, coverage = {};
const magick = args => execFileSync('magick', args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true });

for (let sheet = 0; sheet < sourcePaths.length; sheet++) {
  const source = sourcePaths[sheet];
  const [sw, sh] = magick(['identify', '-format', '%w %h', source]).toString().trim().split(' ').map(Number);
  const pixels = magick([source, '-depth', '8', 'rgba:-']);
  for (let cell = 0; cell < 4; cell++) {
    const index = sheet * 4 + cell, name = names[index];
    const x0 = Math.floor((cell % 2) * sw / 2), x1 = Math.floor((cell % 2 + 1) * sw / 2);
    const y0 = Math.floor(Math.floor(cell / 2) * sh / 2), y1 = Math.floor((Math.floor(cell / 2) + 1) * sh / 2);
    let minX = x1, minY = y1, maxX = x0, maxY = y0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (pixels[(y * sw + x) * 4 + 3] < 8) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    if (minX > maxX || minY > maxY) throw new Error(`Empty grass sprite: ${name}`);
    const cw = maxX - minX + 1, ch = maxY - minY + 1;
    const scale = Math.min(inner / cw, inner / ch), rw = Math.max(1, Math.round(cw * scale)), rh = Math.max(1, Math.round(ch * scale));
    const resized = magick([source, '-crop', `${cw}x${ch}+${minX}+${minY}`, '+repage', '-resize', `${rw}x${rh}!`, '-depth', '8', 'rgba:-']);
    const left = index % 4 * slot + gutter + Math.floor((inner - rw) / 2);
    const top = Math.floor(index / 4) * slot + slot - gutter - rh;
    let opaque = 0;
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      const from = (y * rw + x) * 4, to = ((top + y) * width + left + x) * 4;
      resized.copy(atlas, to, from, from + 4);
      if (resized[from + 3] >= 115) opaque++;
    }
    // Image bounds, not a fixed fraction of the atlas: no clipped tips or roots.
    regions[name] = { pixels:[left, top, rw, rh], uv:[(left + .5) / width, 1 - (top + rh - .5) / height, (left + rw - .5) / width, 1 - (top + .5) / height] };
    coverage[name] = Number((opaque / (rw * rh)).toFixed(4));
    if (coverage[name] > .4) throw new Error(`${name} is too solid for a grass card: ${coverage[name]}`);
  }
}

// Extend trustworthy blade RGB through transparent texels, separately per slot.
// Alpha is unchanged. This prevents dark/colored fringes during linear filtering.
for (let cell = 0; cell < 8; cell++) {
  const left = cell % 4 * slot, top = Math.floor(cell / 4) * slot;
  const owner = new Int32Array(slot * slot).fill(-1), queue = new Int32Array(slot * slot);
  let head = 0, tail = 0;
  for (let y = 0; y < slot; y++) for (let x = 0; x < slot; x++) {
    const local = y * slot + x, global = ((top + y) * width + left + x) * 4;
    if (atlas[global + 3] >= 128) { owner[local] = local; queue[tail++] = local; }
  }
  while (head < tail) {
    const current = queue[head++], x = current % slot, y = Math.floor(current / slot);
    for (const next of [x > 0 ? current - 1 : -1, x < slot - 1 ? current + 1 : -1, y > 0 ? current - slot : -1, y < slot - 1 ? current + slot : -1]) {
      if (next < 0 || owner[next] >= 0) continue;
      owner[next] = owner[current]; queue[tail++] = next;
    }
  }
  for (let local = 0; local < owner.length; local++) {
    const to = ((top + Math.floor(local / slot)) * width + left + local % slot) * 4;
    if (atlas[to + 3] >= 128 || owner[local] < 0) continue;
    const source = owner[local], from = ((top + Math.floor(source / slot)) * width + left + source % slot) * 4;
    atlas.copy(atlas, to, from, from + 3);
  }
}

mkdirSync(destination, { recursive: true });
execFileSync('magick', ['-size', `${width}x${height}`, '-depth', '8', 'rgba:-', '-define', 'png:color-type=6', path.join(destination, 'grass-clumps-v2.png')], { input: atlas, windowsHide: true });
const data = { revision:2, path:'/textures/grass/grass-clumps-v2.png', width, height, gutter, regions, coverage };
writeFileSync(path.join(root, 'src/app/generators/grass-atlas-v2.json'), JSON.stringify(data, null, 2) + '\n');
console.log(JSON.stringify({ path:data.path, width, height, coverage }, null, 2));
