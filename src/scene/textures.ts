import * as THREE from 'three';

/** Procedurally generated canvas textures (no external assets needed). */

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Deterministic PRNG so the cathedral looks identical on every load. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable 2D value noise with fractal octaves. */
function makeNoise(size: number, seed: number) {
  const rand = mulberry32(seed);
  const grid = new Float32Array(size * size).map(() => rand());
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const sample = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smooth(x - xi);
    const yf = smooth(y - yi);
    const g = (i: number, j: number) => grid[(((j % size) + size) % size) * size + (((i % size) + size) % size)];
    const a = g(xi, yi) + (g(xi + 1, yi) - g(xi, yi)) * xf;
    const b = g(xi, yi + 1) + (g(xi + 1, yi + 1) - g(xi, yi + 1)) * xf;
    return a + (b - a) * yf;
  };
  return (x: number, y: number, octaves = 5) => {
    let v = 0;
    let amp = 0.5;
    let freq = 1;
    for (let o = 0; o < octaves; o++) {
      v += sample(x * freq, y * freq) * amp;
      amp *= 0.5;
      freq *= 2;
    }
    return v;
  };
}

function toTexture(canvas: HTMLCanvasElement, srgb = true, repeat = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}

/** Veined marble (light) or glassy obsidian with faint flow lines (dark). */
export function stoneTexture(kind: 'marble' | 'obsidian', seed = 7): THREE.CanvasTexture {
  const W = 512;
  const H = 512;
  const [canvas, ctx] = makeCanvas(W, H);
  const img = ctx.createImageData(W, H);
  const noise = makeNoise(16, seed);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x / W) * 16;
      const v = (y / H) * 16;
      const turb = noise(u * 0.5, v * 0.5, 5);
      const vein = Math.abs(Math.sin((u * 0.6 + v * 0.9 + turb * 9) * 0.9));
      const i = (y * W + x) * 4;
      if (kind === 'marble') {
        const veinDark = Math.pow(1 - vein, 12) * 0.32;
        const cloud = noise(u + 3, v + 7, 4) * 0.12;
        const base = 0.94 - cloud - veinDark;
        img.data[i] = 255 * Math.min(1, base * 1.0);
        img.data[i + 1] = 255 * Math.min(1, base * 0.98);
        img.data[i + 2] = 255 * Math.min(1, base * 0.95);
      } else {
        const sheen = Math.pow(1 - vein, 14) * 0.22;
        const cloud = noise(u + 9, v + 1, 4) * 0.05;
        const base = 0.05 + cloud + sheen;
        img.data[i] = 255 * base * 0.95;
        img.data[i + 1] = 255 * base * 0.9;
        img.data[i + 2] = 255 * base * 1.15;
      }
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(canvas);
}

/** Large worn flagstones for the cathedral floor. */
export function flagstoneTexture(): THREE.CanvasTexture {
  const S = 1024;
  const [canvas, ctx] = makeCanvas(S, S);
  const rand = mulberry32(42);
  const noise = makeNoise(32, 3);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = noise((x / S) * 32, (y / S) * 32, 5);
      const v = 38 + n * 34;
      const i = (y * S + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v * 0.97;
      img.data[i + 2] = v * 1.02;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tiles = 4;
  const ts = S / tiles;
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      ctx.fillStyle = `rgba(${rand() > 0.5 ? 255 : 0},${rand() > 0.5 ? 255 : 0},255,${0.02 + rand() * 0.03})`;
      ctx.fillRect(tx * ts, ty * ts, ts, ts);
    }
  }
  ctx.strokeStyle = 'rgba(5,5,8,0.9)';
  ctx.lineWidth = 6;
  for (let i = 0; i <= tiles; i++) {
    ctx.beginPath();
    ctx.moveTo(i * ts, 0);
    ctx.lineTo(i * ts, S);
    ctx.moveTo(0, i * ts);
    ctx.lineTo(S, i * ts);
    ctx.stroke();
  }
  return toTexture(canvas, true, 6);
}

/** Rough ashlar masonry for walls and pillars. */
export function masonryTexture(): THREE.CanvasTexture {
  const S = 512;
  const [canvas, ctx] = makeCanvas(S, S);
  const noise = makeNoise(16, 11);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = noise((x / S) * 16, (y / S) * 16, 5);
      const v = 46 + n * 40;
      const i = (y * S + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v * 0.96;
      img.data[i + 2] = v * 0.93;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(8,7,8,0.85)';
  ctx.lineWidth = 3;
  const rows = 8;
  const rh = S / rows;
  for (let r = 0; r < rows; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * rh);
    ctx.lineTo(S, r * rh);
    ctx.stroke();
    const off = r % 2 ? S / 8 : 0;
    for (let c = 0; c < 4; c++) {
      const x = off + c * (S / 4);
      ctx.beginPath();
      ctx.moveTo(x, r * rh);
      ctx.lineTo(x, (r + 1) * rh);
      ctx.stroke();
    }
  }
  return toTexture(canvas);
}

/** Board top: polished alternating squares with engraved coordinates. */
export function boardTexture(): THREE.CanvasTexture {
  const S = 2048;
  const [canvas, ctx] = makeCanvas(S, S);
  // Layout: frame width in board units, the whole canvas spans 8 + 2*FRAME.
  const FRAME = 0.6;
  const total = 8 + FRAME * 2;
  const px = S / total;
  const noise = makeNoise(16, 5);

  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const bx = x / px - FRAME;
      const by = y / px - FRAME;
      const i = (y * S + x) * 4;
      const n = noise((x / S) * 24, (y / S) * 24, 4);
      let r: number;
      let g: number;
      let b: number;
      if (bx < 0 || by < 0 || bx >= 8 || by >= 8) {
        // Frame: dark weathered bronze-stone.
        const v = 22 + n * 18;
        r = v * 1.05;
        g = v;
        b = v * 0.95;
      } else {
        const light = (Math.floor(bx) + Math.floor(by)) % 2 === 0;
        const vein = Math.pow(1 - Math.abs(Math.sin((bx * 1.3 + by * 0.7 + n * 6) * 2.2)), 12);
        if (light) {
          const v = 150 + n * 28 - vein * 30;
          r = v * 1.0;
          g = v * 0.96;
          b = v * 0.9;
        } else {
          const v = 40 + n * 22 + vein * 14;
          r = v * 0.95;
          g = v * 0.95;
          b = v * 1.08;
        }
      }
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Inlaid gold border line around the playing field.
  ctx.strokeStyle = 'rgba(196,160,92,0.85)';
  ctx.lineWidth = 6;
  ctx.strokeRect(FRAME * px - 10, FRAME * px - 10, 8 * px + 20, 8 * px + 20);
  ctx.lineWidth = 2;
  ctx.strokeRect(FRAME * px - 22, FRAME * px - 22, 8 * px + 44, 8 * px + 44);

  // Coordinates. Canvas top (y = 0) maps to rank 8 side (-z).
  ctx.fillStyle = 'rgba(206,176,118,0.9)';
  ctx.font = `500 ${Math.round(px * 0.3)}px Roboto, "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 8; i++) {
    const cx = (FRAME + i + 0.5) * px;
    const file = 'ABCDEFGH'[i];
    ctx.fillText(file, cx, S - (FRAME * px) / 2);
    ctx.save();
    ctx.translate(cx, (FRAME * px) / 2);
    ctx.rotate(Math.PI);
    ctx.fillText(file, 0, 0);
    ctx.restore();
    const cy = (FRAME + i + 0.5) * px;
    const rank = String(8 - i);
    ctx.fillText(rank, (FRAME * px) / 2, cy);
    ctx.save();
    ctx.translate(S - (FRAME * px) / 2, cy);
    ctx.rotate(Math.PI);
    ctx.fillText(rank, 0, 0);
    ctx.restore();
  }
  const t = toTexture(canvas);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Stained glass: jewel-toned cells separated by lead lines. */
export function stainedGlassTexture(seed: number, palette: string[], w = 256, h = 512): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(w, h);
  const rand = mulberry32(seed);
  ctx.fillStyle = '#05040a';
  ctx.fillRect(0, 0, w, h);
  const cols = 4;
  const rows = 10;
  const cw = w / cols;
  const ch = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const color = palette[Math.floor(rand() * palette.length)];
      const jx = () => (rand() - 0.5) * cw * 0.25;
      const jy = () => (rand() - 0.5) * ch * 0.25;
      ctx.beginPath();
      ctx.moveTo(c * cw + jx(), r * ch + jy());
      ctx.lineTo((c + 1) * cw + jx(), r * ch + jy());
      ctx.lineTo((c + 1) * cw + jx(), (r + 1) * ch + jy());
      ctx.lineTo(c * cw + jx(), (r + 1) * ch + jy());
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.6 + rand() * 0.4;
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  // Central medallion
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.42, w * 0.28, 0, Math.PI * 2);
  ctx.fillStyle = palette[0];
  ctx.fill();
  ctx.strokeStyle = '#05040a';
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.42, w * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = '#f2d48a';
  ctx.fill();
  ctx.stroke();
  // Lead lines
  ctx.strokeStyle = '#05040a';
  ctx.lineWidth = 5;
  for (let r = 0; r <= rows; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * ch);
    ctx.lineTo(w, r * ch + (rand() - 0.5) * 10);
    ctx.stroke();
  }
  for (let c = 0; c <= cols; c++) {
    ctx.beginPath();
    ctx.moveTo(c * cw, 0);
    ctx.lineTo(c * cw, h);
    ctx.stroke();
  }
  return toTexture(canvas);
}

/** Rose window: concentric rings of petals radiating from a central boss. */
export function roseWindowTexture(): THREE.CanvasTexture {
  const S = 1024;
  const [canvas, ctx] = makeCanvas(S, S);
  const c = S / 2;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  const rings: { r0: number; r1: number; n: number; colors: string[] }[] = [
    { r0: 0.0, r1: 0.12, n: 1, colors: ['#f6d27a'] },
    { r0: 0.12, r1: 0.3, n: 8, colors: ['#2457c5', '#8a1c2b'] },
    { r0: 0.3, r1: 0.55, n: 16, colors: ['#1b3f9a', '#6c2a9e', '#1f7a6a', '#a1262d'] },
    { r0: 0.55, r1: 0.8, n: 24, colors: ['#284fb8', '#7d1e2c', '#d1a43c', '#3a2a8e'] },
    { r0: 0.8, r1: 0.98, n: 32, colors: ['#1c3a8a', '#8b2234'] },
  ];
  for (const ring of rings) {
    for (let i = 0; i < ring.n; i++) {
      const a0 = (i / ring.n) * Math.PI * 2;
      const a1 = ((i + 1) / ring.n) * Math.PI * 2;
      ctx.beginPath();
      if (ring.n === 1) ctx.arc(c, c, ring.r1 * c, 0, Math.PI * 2);
      else {
        ctx.arc(c, c, ring.r1 * c, a0, a1);
        ctx.arc(c, c, ring.r0 * c, a1, a0, true);
      }
      ctx.closePath();
      ctx.fillStyle = ring.colors[i % ring.colors.length];
      ctx.fill();
      ctx.strokeStyle = '#030206';
      ctx.lineWidth = 7;
      ctx.stroke();
    }
  }
  // Petal tracery
  ctx.strokeStyle = '#030206';
  ctx.lineWidth = 10;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * c * 0.42, c + Math.sin(a) * c * 0.42, c * 0.24, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.985, 0, Math.PI * 2);
  ctx.stroke();
  const t = toTexture(canvas);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Soft radial glow sprite (flames, sparks, dust, flashes). */
export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.CanvasTexture {
  const S = 128;
  const [canvas, ctx] = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.6)'));
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Candle flame: teardrop gradient. */
export function flameTexture(): THREE.CanvasTexture {
  const W = 64;
  const H = 128;
  const [canvas, ctx] = makeCanvas(W, H);
  const g = ctx.createRadialGradient(W / 2, H * 0.68, 2, W / 2, H * 0.6, H * 0.45);
  g.addColorStop(0, 'rgba(255,255,235,1)');
  g.addColorStop(0.2, 'rgba(255,214,120,0.95)');
  g.addColorStop(0.5, 'rgba(255,130,40,0.5)');
  g.addColorStop(1, 'rgba(255,80,10,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(W / 2, 4);
  ctx.bezierCurveTo(W * 0.95, H * 0.5, W * 0.85, H * 0.95, W / 2, H * 0.95);
  ctx.bezierCurveTo(W * 0.15, H * 0.95, W * 0.05, H * 0.5, W / 2, 4);
  ctx.fill();
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Vertical fade used for volumetric light shafts. */
export function shaftTexture(): THREE.CanvasTexture {
  const W = 64;
  const H = 256;
  const [canvas, ctx] = makeCanvas(W, H);
  const gv = ctx.createLinearGradient(0, 0, 0, H);
  gv.addColorStop(0, 'rgba(255,255,255,0.9)');
  gv.addColorStop(0.6, 'rgba(255,255,255,0.35)');
  gv.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gv;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'destination-in';
  const gh = ctx.createLinearGradient(0, 0, W, 0);
  gh.addColorStop(0, 'rgba(0,0,0,0)');
  gh.addColorStop(0.5, 'rgba(0,0,0,1)');
  gh.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gh;
  ctx.fillRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
