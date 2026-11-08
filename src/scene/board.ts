import * as THREE from 'three';
import { boardTexture } from './textures';
import { squareToWorld } from './pieceView';

export type SquareMark = 'none' | 'move' | 'capture';

const COLORS = {
  selected: new THREE.Color(0xffc46b),
  lastMove: new THREE.Color(0x7fa8ff),
  check: new THREE.Color(0xff3b4a),
  hover: new THREE.Color(0xffffff),
};

function discTexture(kind: 'dot' | 'ring' | 'soft'): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  if (kind === 'dot') {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.18);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  } else if (kind === 'ring') {
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S * 0.42, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // Rounded square with a soft inner glow.
    const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.2, S / 2, S / 2, S * 0.72);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(4, 4, S - 8, S - 8, 14);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The physical board plus per-square highlight overlays and a pick plane. */
export class Board {
  readonly group = new THREE.Group();
  readonly pickPlane: THREE.Mesh;
  private tints: THREE.Mesh[] = [];
  private marks: THREE.Mesh[] = [];
  private dotTex = discTexture('dot');
  private ringTex = discTexture('ring');
  private markColor = new THREE.Color(0xffd28a);
  private markState: SquareMark[] = new Array(64).fill('none');

  private selected = -1;
  private lastMove: [number, number] | null = null;
  private check = -1;
  private hover = -1;

  constructor() {
    const top = new THREE.MeshPhysicalMaterial({
      map: boardTexture(),
      roughness: 0.32,
      metalness: 0.05,
      clearcoat: 0.5,
      clearcoatRoughness: 0.2,
      envMapIntensity: 0.5,
    });
    const side = new THREE.MeshStandardMaterial({ color: 0x1b1918, roughness: 0.6, metalness: 0.2 });
    const size = 9.2;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(size, 0.35, size), [side, side, top, side, side, side]);
    slab.position.y = -0.175;
    slab.receiveShadow = true;
    slab.castShadow = true;
    this.group.add(slab);

    // Gold trim around the slab edge.
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(size + 0.06, 0.05, size + 0.06),
      new THREE.MeshStandardMaterial({ color: 0xb08a4a, metalness: 0.9, roughness: 0.35, emissive: 0x2a1a05 }),
    );
    trim.position.y = -0.05;
    this.group.add(trim);

    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    const softTex = discTexture('soft');
    for (let sq = 0; sq < 64; sq++) {
      const p = squareToWorld(sq);
      const tint = new THREE.Mesh(
        plane,
        new THREE.MeshBasicMaterial({
          map: softTex,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      tint.position.set(p.x, 0.004, p.z);
      tint.visible = false;
      tint.renderOrder = 1;
      this.tints.push(tint);
      const mark = new THREE.Mesh(
        plane,
        new THREE.MeshBasicMaterial({
          map: this.dotTex,
          color: this.markColor,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      mark.position.set(p.x, 0.008, p.z);
      mark.visible = false;
      mark.renderOrder = 2;
      this.marks.push(mark);
      this.group.add(tint, mark);
    }

    this.pickPlane = new THREE.Mesh(new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
    this.pickPlane.visible = false;
    this.group.add(this.pickPlane);
  }

  /** Square under a world-space point on the board, or -1. */
  static worldToSquare(p: THREE.Vector3): number {
    const file = Math.floor(p.x + 4);
    const rank = Math.floor(4 - p.z);
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return -1;
    return rank * 8 + file;
  }

  setSelected(sq: number): void {
    this.selected = sq;
  }
  setLastMove(m: [number, number] | null): void {
    this.lastMove = m;
  }
  setCheck(sq: number): void {
    this.check = sq;
  }
  setHover(sq: number): void {
    this.hover = sq;
  }

  setMarks(moves: { to: number; capture: boolean }[]): void {
    this.markState.fill('none');
    for (const m of moves) this.markState[m.to] = m.capture ? 'capture' : 'move';
  }

  clearAll(): void {
    this.selected = -1;
    this.lastMove = null;
    this.check = -1;
    this.hover = -1;
    this.markState.fill('none');
  }

  update(time: number): void {
    for (let sq = 0; sq < 64; sq++) {
      const tint = this.tints[sq];
      const mat = tint.material as THREE.MeshBasicMaterial;
      let opacity = 0;
      if (sq === this.check) {
        mat.color.copy(COLORS.check);
        opacity = 0.55 + Math.sin(time * 6) * 0.2;
      } else if (sq === this.selected) {
        mat.color.copy(COLORS.selected);
        opacity = 0.5;
      } else if (this.lastMove && (sq === this.lastMove[0] || sq === this.lastMove[1])) {
        mat.color.copy(COLORS.lastMove);
        opacity = 0.22;
      }
      if (sq === this.hover && this.markState[sq] !== 'none') {
        mat.color.copy(COLORS.selected);
        opacity = Math.max(opacity, 0.35);
      }
      tint.visible = opacity > 0;
      mat.opacity = opacity;

      const mark = this.marks[sq];
      const state = this.markState[sq];
      mark.visible = state !== 'none';
      if (mark.visible) {
        const mm = mark.material as THREE.MeshBasicMaterial;
        mm.map = state === 'capture' ? this.ringTex : this.dotTex;
        mm.color.set(state === 'capture' ? 0xff6a5c : 0xffd28a);
        const s = state === 'capture' ? 0.95 : 0.9 + Math.sin(time * 4 + sq) * 0.06;
        mark.scale.setScalar(s);
      }
    }
  }
}
