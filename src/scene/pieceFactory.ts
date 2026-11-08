import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Color, PieceType } from '../chess/engine';
import { stoneTexture } from './textures';

/**
 * Builds minimalist, sculpted chess pieces. Bodies are lathed profiles; the
 * knight head is an extruded, bevelled silhouette. Each piece has two
 * materials: the stone body (marble or obsidian) and a softly glowing
 * "arcane" accent (gold for marble, violet for obsidian).
 */

const SEG = 40;
const v = (x: number, y: number) => new THREE.Vector2(x, y);

function arc(cx: number, cy: number, r: number, a0: number, a1: number, n = 10): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push(v(Math.max(0, cx + Math.cos(a) * r), cy + Math.sin(a) * r));
  }
  return pts;
}

const BASE: THREE.Vector2[] = [
  v(0, 0),
  v(0.36, 0),
  v(0.375, 0.02),
  v(0.375, 0.05),
  v(0.355, 0.075),
  v(0.32, 0.085),
  v(0.32, 0.105),
  v(0.29, 0.125),
];

function lathe(points: THREE.Vector2[]): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(points, SEG);
  g.computeVertexNormals();
  return g;
}

function profile(type: PieceType): THREE.Vector2[] {
  switch (type) {
    case 'p':
      return [
        ...BASE,
        v(0.24, 0.15),
        v(0.17, 0.2),
        v(0.12, 0.34),
        v(0.11, 0.4),
        v(0.18, 0.43),
        v(0.18, 0.455),
        v(0.1, 0.475),
        ...arc(0, 0.58, 0.125, -Math.PI / 2 + 0.55, Math.PI / 2, 12),
      ];
    case 'r':
      return [
        ...BASE,
        v(0.27, 0.15),
        v(0.23, 0.2),
        v(0.2, 0.56),
        v(0.25, 0.6),
        v(0.27, 0.64),
        v(0.27, 0.8),
        v(0.2, 0.8),
        v(0.2, 0.74),
        v(0, 0.74),
      ];
    case 'b':
      return [
        ...BASE,
        v(0.25, 0.15),
        v(0.17, 0.21),
        v(0.11, 0.5),
        v(0.1, 0.56),
        v(0.18, 0.6),
        v(0.18, 0.625),
        v(0.1, 0.645),
        v(0.13, 0.69),
        v(0.155, 0.76),
        v(0.15, 0.84),
        v(0.12, 0.92),
        v(0.07, 0.98),
        v(0.03, 1.0),
        ...arc(0, 1.04, 0.045, -Math.PI / 2, Math.PI / 2, 8),
      ];
    case 'q':
      return [
        ...BASE,
        v(0.27, 0.15),
        v(0.18, 0.24),
        v(0.12, 0.62),
        v(0.11, 0.72),
        v(0.2, 0.76),
        v(0.2, 0.785),
        v(0.12, 0.81),
        v(0.13, 0.86),
        v(0.2, 1.0),
        v(0.2, 1.02),
        v(0.15, 1.02),
        ...arc(0, 1.0, 0.13, 0.15, Math.PI / 2, 8),
      ];
    case 'k':
      return [
        ...BASE,
        v(0.28, 0.15),
        v(0.19, 0.25),
        v(0.13, 0.66),
        v(0.12, 0.78),
        v(0.21, 0.82),
        v(0.21, 0.845),
        v(0.13, 0.87),
        v(0.14, 0.92),
        v(0.2, 1.06),
        v(0.2, 1.09),
        v(0.13, 1.1),
        v(0.1, 1.13),
        v(0, 1.14),
      ];
    case 'n':
      return [...BASE, v(0.27, 0.15), v(0.25, 0.2), v(0.25, 0.22), v(0, 0.22)];
  }
}

function knightHead(): THREE.BufferGeometry {
  // Silhouette facing +x, from the collar up to the ears.
  const s = new THREE.Shape();
  const pts: [number, number][] = [
    [-0.2, 0.0],
    [0.2, 0.0],
    [0.17, 0.12],
    [0.1, 0.25],
    [0.14, 0.31],
    [0.3, 0.38],
    [0.35, 0.44],
    [0.33, 0.51],
    [0.22, 0.56],
    [0.12, 0.64],
    [0.07, 0.74],
    [0.02, 0.69],
    [-0.04, 0.76],
    [-0.08, 0.66],
    [-0.16, 0.6],
    [-0.22, 0.46],
    [-0.25, 0.28],
    [-0.24, 0.12],
  ];
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const depth = 0.16;
  const g = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.035,
    bevelSegments: 4,
    curveSegments: 4,
  });
  g.translate(0, 0, -depth / 2);
  // Face -z (forward) instead of +x.
  g.rotateY(Math.PI / 2);
  g.translate(0, 0.2, 0);
  g.computeVertexNormals();
  return g;
}

interface PieceGeometry {
  body: THREE.BufferGeometry;
  accent: THREE.BufferGeometry;
}

function buildGeometry(type: PieceType): PieceGeometry {
  const parts: THREE.BufferGeometry[] = [lathe(profile(type))];
  const accents: THREE.BufferGeometry[] = [];
  // Every piece gets a thin glowing ring at its collar.
  const collarY: Record<PieceType, number> = { p: 0.442, r: 0.6, b: 0.612, q: 0.772, k: 0.832, n: 0.21 };
  const collarR: Record<PieceType, number> = { p: 0.18, r: 0.25, b: 0.18, q: 0.2, k: 0.21, n: 0.25 };
  const ring = new THREE.TorusGeometry(collarR[type] + 0.004, 0.012, 8, SEG);
  ring.rotateX(Math.PI / 2);
  ring.translate(0, collarY[type], 0);
  accents.push(ring);

  switch (type) {
    case 'r': {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const m = new THREE.BoxGeometry(0.1, 0.09, 0.08);
        m.translate(0, 0.845, 0.235);
        m.rotateY(a);
        parts.push(m);
      }
      const rune = new THREE.TorusGeometry(0.205, 0.01, 6, SEG);
      rune.rotateX(Math.PI / 2);
      rune.translate(0, 0.38, 0);
      accents.push(rune);
      break;
    }
    case 'b': {
      const slit = new THREE.BoxGeometry(0.02, 0.17, 0.32);
      slit.rotateX(-0.55);
      slit.translate(0, 0.86, 0);
      accents.push(slit);
      break;
    }
    case 'q': {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const orb = new THREE.SphereGeometry(0.034, 10, 8);
        orb.translate(Math.cos(a) * 0.19, 1.045, Math.sin(a) * 0.19);
        accents.push(orb);
      }
      const top = new THREE.SphereGeometry(0.05, 14, 10);
      top.translate(0, 1.18, 0);
      accents.push(top);
      break;
    }
    case 'k': {
      const v1 = new THREE.BoxGeometry(0.06, 0.24, 0.06);
      v1.translate(0, 1.25, 0);
      const h1 = new THREE.BoxGeometry(0.18, 0.06, 0.06);
      h1.translate(0, 1.27, 0);
      accents.push(v1, h1);
      break;
    }
    case 'n': {
      parts.push(knightHead());
      for (const side of [-1, 1]) {
        const eye = new THREE.SphereGeometry(0.026, 10, 8);
        eye.translate(side * 0.125, 0.67, -0.12);
        accents.push(eye);
      }
      // Mane ridge
      const mane = new THREE.BoxGeometry(0.035, 0.36, 0.05);
      mane.rotateX(-0.45);
      mane.translate(0, 0.58, 0.16);
      accents.push(mane);
      break;
    }
    default:
      break;
  }
  // Normalise attributes so geometries can merge (lathe/extrude share position/normal/uv).
  const clean = (gs: THREE.BufferGeometry[]) =>
    gs.map((g) => {
      const n = g.index ? g.toNonIndexed() : g;
      for (const name of Object.keys(n.attributes)) {
        if (!['position', 'normal', 'uv'].includes(name)) n.deleteAttribute(name);
      }
      if (!n.attributes.uv) {
        n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((n.attributes.position.count) * 2), 2));
      }
      return n;
    });
  const body = mergeGeometries(clean(parts))!;
  const accent = mergeGeometries(clean(accents))!;
  body.computeBoundingBox();
  return { body, accent };
}

export interface PieceMaterials {
  body: THREE.MeshPhysicalMaterial;
  accent: THREE.MeshStandardMaterial;
}

export class PieceFactory {
  private geometry = new Map<PieceType, PieceGeometry>();
  private materials: Record<Color, PieceMaterials>;

  constructor() {
    const marbleMap = stoneTexture('marble', 7);
    const obsidianMap = stoneTexture('obsidian', 19);
    this.materials = {
      w: {
        body: new THREE.MeshPhysicalMaterial({
          color: 0xf4efe6,
          map: marbleMap,
          roughness: 0.28,
          metalness: 0,
          clearcoat: 0.6,
          clearcoatRoughness: 0.25,
          sheen: 0.3,
          sheenColor: new THREE.Color(0xfff2dd),
          envMapIntensity: 0.9,
        }),
        accent: new THREE.MeshStandardMaterial({
          color: 0xd8b56a,
          emissive: 0xffc46b,
          emissiveIntensity: 0.6,
          roughness: 0.3,
          metalness: 0.8,
        }),
      },
      b: {
        body: new THREE.MeshPhysicalMaterial({
          color: 0x2a2833,
          map: obsidianMap,
          roughness: 0.07,
          metalness: 0.1,
          clearcoat: 1,
          clearcoatRoughness: 0.04,
          iridescence: 0.35,
          iridescenceIOR: 1.6,
          envMapIntensity: 1.5,
        }),
        accent: new THREE.MeshStandardMaterial({
          color: 0x6a3cc8,
          emissive: 0x9b5cff,
          emissiveIntensity: 0.9,
          roughness: 0.25,
          metalness: 0.4,
        }),
      },
    };
  }

  private geom(type: PieceType): PieceGeometry {
    let g = this.geometry.get(type);
    if (!g) {
      g = buildGeometry(type);
      this.geometry.set(type, g);
    }
    return g;
  }

  /** Returns a mesh group with per-instance cloned materials. */
  create(type: PieceType, color: Color): { group: THREE.Group; body: THREE.Mesh; accent: THREE.Mesh } {
    const g = this.geom(type);
    const mats = this.materials[color];
    const body = new THREE.Mesh(g.body, mats.body.clone());
    const accent = new THREE.Mesh(g.accent, mats.accent.clone());
    body.castShadow = true;
    body.receiveShadow = true;
    accent.castShadow = true;
    const group = new THREE.Group();
    group.add(body, accent);
    return { group, body, accent };
  }

  setEnvironment(env: THREE.Texture): void {
    for (const c of ['w', 'b'] as Color[]) {
      this.materials[c].body.envMap = env;
      this.materials[c].accent.envMap = env;
    }
  }
}

export const PIECE_HEIGHT: Record<PieceType, number> = {
  p: 0.71,
  n: 0.98,
  b: 1.09,
  r: 0.89,
  q: 1.23,
  k: 1.37,
};
