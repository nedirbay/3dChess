import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  flagstoneTexture,
  flameTexture,
  glowTexture,
  masonryTexture,
  mulberry32,
  roseWindowTexture,
  shaftTexture,
  stainedGlassTexture,
} from './textures';

/**
 * A dark Gothic cathedral nave built from simple primitives: clustered
 * pillars, pointed arcades, rib vaults, lancet and rose windows, volumetric
 * light shafts, candelabra and drifting dust.
 */

export const FLOOR_Y = -1.1;
const DAIS_TOP = -0.35;
const STEP_TOP = -0.75;
const NAVE_X = 9;
const AISLE_X = 15;
const BAY = 6;
const NAVE_HALF_LENGTH = 30;

/** Height of whatever surface lies beneath (x, z): board, dais, step or floor. */
export function groundHeight(x: number, z: number): number {
  const m = Math.max(Math.abs(x), Math.abs(z));
  if (m <= 4.6) return 0;
  if (m <= 6.5) return DAIS_TOP;
  if (m <= 7.5) return STEP_TOP;
  return FLOOR_Y;
}

/** Pointed (Gothic) arch from a to b, rising `up`. Radius ratio controls sharpness. */
function gothicArchCurve(a: THREE.Vector3, b: THREE.Vector3, ratio = 0.8, segments = 24): THREE.CatmullRomCurve3 {
  const span = a.distanceTo(b);
  const R = span * ratio;
  const along = b.clone().sub(a).normalize();
  const pts: THREE.Vector3[] = [];
  const half = span / 2;
  const apexAngle = Math.acos((half - R) / R);
  // Left arc: centred at u = R, from angle PI to apexAngle.
  for (let i = 0; i <= segments; i++) {
    const ang = Math.PI + (apexAngle - Math.PI) * (i / segments);
    const u = R + Math.cos(ang) * R;
    const h = Math.sin(ang) * R;
    pts.push(a.clone().addScaledVector(along, u).add(new THREE.Vector3(0, h, 0)));
  }
  for (let i = segments - 1; i >= 0; i--) {
    const p = pts[i];
    const u = p.clone().sub(a).dot(along);
    pts.push(a.clone().addScaledVector(along, span - u).setY(p.y));
  }
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
}

function lancetShape(w: number, h: number): THREE.Shape {
  const s = new THREE.Shape();
  const springH = h - w * 0.9;
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, springH);
  s.quadraticCurveTo(w / 2, h - w * 0.25, 0, h);
  s.quadraticCurveTo(-w / 2, h - w * 0.25, -w / 2, springH);
  s.closePath();
  return s;
}

function normaliseUVs(g: THREE.BufferGeometry): void {
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - bb.min.x) / (bb.max.x - bb.min.x || 1);
    uv[i * 2 + 1] = (pos.getY(i) - bb.min.y) / (bb.max.y - bb.min.y || 1);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

interface Candle {
  flame: THREE.Sprite;
  halo: THREE.Sprite;
  baseScale: number;
  phase: number;
}

export class Cathedral {
  readonly group = new THREE.Group();
  private candles: Candle[] = [];
  private candleLights: { light: THREE.PointLight; base: number; phase: number }[] = [];
  private motes!: THREE.Points;
  private moteVel!: Float32Array;
  private shafts: THREE.Mesh[] = [];

  constructor() {
    const rand = mulberry32(1234);
    const stoneMap = masonryTexture();
    const stone = new THREE.MeshStandardMaterial({
      color: 0x8e8a86,
      map: stoneMap,
      roughness: 0.92,
      metalness: 0,
      envMapIntensity: 0.15,
    });
    const darkStone = stone.clone();
    darkStone.color.set(0x55524f);

    this.buildFloor();
    this.buildDais(stone);
    this.buildPillarsAndVaults(stone, darkStone);
    this.buildWalls(darkStone);
    this.buildWindows(rand);
    this.buildCandelabra(stone);
    this.buildFloorCandles(rand);
    this.buildMotes(rand);
  }

  private buildFloor(): void {
    const tex = flagstoneTexture();
    tex.repeat.set(10, 10);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(AISLE_X * 2, NAVE_HALF_LENGTH * 2),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.05, color: 0x9a9690, envMapIntensity: 0.4 }),
    );
    tex.repeat.set(5, 10);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    this.group.add(floor);

    // A long dark runner carpet down the nave toward the board.
    const runner = new THREE.Mesh(
      new THREE.PlaneGeometry(3, NAVE_HALF_LENGTH * 2),
      new THREE.MeshStandardMaterial({ color: 0x3a0d14, roughness: 0.95 }),
    );
    runner.rotation.x = -Math.PI / 2;
    runner.position.y = FLOOR_Y + 0.01;
    runner.receiveShadow = true;
    this.group.add(runner);
  }

  private buildDais(stone: THREE.MeshStandardMaterial): void {
    const dais = new THREE.Mesh(new THREE.BoxGeometry(13, DAIS_TOP - STEP_TOP, 13), stone);
    dais.position.y = (DAIS_TOP + STEP_TOP) / 2;
    const step = new THREE.Mesh(new THREE.BoxGeometry(15, STEP_TOP - FLOOR_Y, 15), stone);
    step.position.y = (STEP_TOP + FLOOR_Y) / 2;
    for (const m of [dais, step]) {
      m.receiveShadow = true;
      m.castShadow = true;
      this.group.add(m);
    }
  }

  private buildPillarsAndVaults(stone: THREE.MeshStandardMaterial, darkStone: THREE.MeshStandardMaterial): void {
    const pillarParts: THREE.BufferGeometry[] = [];
    const ribParts: THREE.BufferGeometry[] = [];
    const arcadeSpring = FLOOR_Y + 8;
    const vaultSpring = FLOOR_Y + 12;
    const zs: number[] = [];
    for (let z = -NAVE_HALF_LENGTH + BAY; z <= NAVE_HALF_LENGTH - BAY + 0.01; z += BAY) zs.push(z);

    const pillar = (x: number, z: number, height: number) => {
      const base = new THREE.CylinderGeometry(1.0, 1.1, 0.7, 8);
      base.translate(x, FLOOR_Y + 0.35, z);
      const core = new THREE.CylinderGeometry(0.55, 0.6, height, 16);
      core.translate(x, FLOOR_Y + height / 2, z);
      pillarParts.push(base, core);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const shaft = new THREE.CylinderGeometry(0.2, 0.2, height, 10);
        shaft.translate(x + Math.cos(a) * 0.6, FLOOR_Y + height / 2, z + Math.sin(a) * 0.6);
        pillarParts.push(shaft);
      }
      const capital = new THREE.CylinderGeometry(0.95, 0.65, 0.5, 12);
      capital.translate(x, arcadeSpring - 0.25, z);
      pillarParts.push(capital);
      const cap2 = new THREE.CylinderGeometry(0.85, 0.6, 0.4, 12);
      cap2.translate(x, vaultSpring - 0.2, z);
      pillarParts.push(cap2);
    };

    for (const side of [-1, 1]) {
      for (const z of zs) pillar(side * NAVE_X, z, vaultSpring - FLOOR_Y);
      // Arcade arches between pillars.
      for (let i = 0; i < zs.length - 1; i++) {
        const a = new THREE.Vector3(side * NAVE_X, arcadeSpring, zs[i]);
        const b = new THREE.Vector3(side * NAVE_X, arcadeSpring, zs[i + 1]);
        const curve = gothicArchCurve(a, b, 0.8);
        ribParts.push(new THREE.TubeGeometry(curve, 40, 0.32, 8, false));
        // Spandrel wall above the arcade up to the vault spring.
        const wallH = vaultSpring + 9 - arcadeSpring;
        const wall = new THREE.BoxGeometry(0.6, wallH, BAY);
        wall.translate(side * (NAVE_X + 0.1), arcadeSpring + 4.2 + wallH / 2, (zs[i] + zs[i + 1]) / 2);
        pillarParts.push(wall);
      }
    }

    // Rib vault: transverse + diagonal ribs.
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i];
      ribParts.push(
        new THREE.TubeGeometry(
          gothicArchCurve(new THREE.Vector3(-NAVE_X, vaultSpring, z), new THREE.Vector3(NAVE_X, vaultSpring, z), 0.62),
          48,
          0.24,
          8,
          false,
        ),
      );
      if (i < zs.length - 1) {
        const z2 = zs[i + 1];
        for (const [ax, bx] of [
          [-NAVE_X, NAVE_X],
          [NAVE_X, -NAVE_X],
        ]) {
          ribParts.push(
            new THREE.TubeGeometry(
              gothicArchCurve(new THREE.Vector3(ax, vaultSpring, z), new THREE.Vector3(bx, vaultSpring, z2), 0.6),
              48,
              0.16,
              6,
              false,
            ),
          );
        }
      }
    }
    const strip = (gs: THREE.BufferGeometry[]) =>
      gs.map((g) => {
        const n = g.index ? g.toNonIndexed() : g;
        for (const name of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(name)) n.deleteAttribute(name);
        return n;
      });
    const pillars = new THREE.Mesh(mergeGeometries(strip(pillarParts))!, stone);
    pillars.castShadow = true;
    pillars.receiveShadow = true;
    const ribs = new THREE.Mesh(mergeGeometries(strip(ribParts))!, darkStone);
    this.group.add(pillars, ribs);

    // Vault webbing (dark ceiling) just above the ribs.
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(AISLE_X * 2, NAVE_HALF_LENGTH * 2),
      new THREE.MeshStandardMaterial({ color: 0x0c0b0d, roughness: 1 }),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = vaultSpring + 11.5;
    this.group.add(ceiling);
  }

  private buildWalls(stone: THREE.MeshStandardMaterial): void {
    const wallMat = stone.clone();
    (wallMat.map as THREE.Texture) = (stone.map as THREE.Texture).clone();
    wallMat.map!.repeat.set(8, 4);
    wallMat.map!.needsUpdate = true;
    const H = 26;
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(NAVE_HALF_LENGTH * 2, H), wallMat);
      w.position.set(side * AISLE_X, FLOOR_Y + H / 2, 0);
      w.rotation.y = -side * (Math.PI / 2);
      w.receiveShadow = true;
      this.group.add(w);
    }
    for (const end of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(AISLE_X * 2, H), wallMat);
      w.position.set(0, FLOOR_Y + H / 2, end * NAVE_HALF_LENGTH);
      w.rotation.y = end === -1 ? 0 : Math.PI;
      this.group.add(w);
    }
  }

  private buildWindows(rand: () => number): void {
    const palettes = [
      ['#1f3f9e', '#8b1d2c', '#c99a35', '#2b6a8a', '#5a2a88'],
      ['#7d1e2c', '#2a4fae', '#d8a640', '#1c6b52', '#3a2a8e'],
      ['#244aa6', '#5d2391', '#9e2a2f', '#cc9d3b'],
    ];
    const glassMat = (seed: number, intensity = 1.4) => {
      const map = stainedGlassTexture(seed, palettes[seed % palettes.length]);
      return new THREE.MeshBasicMaterial({ map, color: new THREE.Color(intensity, intensity, intensity), fog: false });
    };
    const shaftTex = shaftTexture();
    const shaftMat = (color: number, opacity: number) =>
      new THREE.MeshBasicMaterial({
        map: shaftTex,
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });

    // Aisle lancets (visible through the arcade) and high clerestory windows.
    const lancet = lancetShape(2.2, 7);
    const lancetGeo = new THREE.ShapeGeometry(lancet, 12);
    normaliseUVs(lancetGeo);
    const clere = lancetShape(2.6, 6.5);
    const clereGeo = new THREE.ShapeGeometry(clere, 12);
    normaliseUVs(clereGeo);
    let seed = 1;
    for (const side of [-1, 1]) {
      for (let z = -NAVE_HALF_LENGTH + BAY * 1.5; z < NAVE_HALF_LENGTH - BAY; z += BAY) {
        const w = new THREE.Mesh(lancetGeo, glassMat(seed++, 1.1));
        w.position.set(side * (AISLE_X - 0.05), FLOOR_Y + 2.5, z);
        w.rotation.y = -side * (Math.PI / 2);
        this.group.add(w);

        const c = new THREE.Mesh(clereGeo, glassMat(seed++, 1.3));
        c.position.set(side * (NAVE_X - 0.22), FLOOR_Y + 13.6, z);
        c.rotation.y = -side * (Math.PI / 2);
        this.group.add(c);

        // Slanting moonbeam from every other clerestory window.
        if (Math.abs(z) < 16 && rand() > 0.3) {
          const len = 16;
          const shaft = new THREE.Mesh(new THREE.PlaneGeometry(2.4, len), shaftMat(0x8aa4ff, 0.05));
          const top = new THREE.Vector3(side * NAVE_X, FLOOR_Y + 16, z);
          const bottom = new THREE.Vector3(side * 1.5, FLOOR_Y, z + 1.5);
          shaft.position.copy(top).lerp(bottom, 0.5);
          shaft.lookAt(bottom);
          shaft.rotateX(-Math.PI / 2);
          shaft.scale.y = top.distanceTo(bottom) / len;
          this.shafts.push(shaft);
          this.group.add(shaft);
        }
      }
    }

    // Rose windows at both ends, with tall lancets beneath.
    const roseTex = roseWindowTexture();
    for (const end of [-1, 1]) {
      const rose = new THREE.Mesh(
        new THREE.CircleGeometry(5.2, 64),
        new THREE.MeshBasicMaterial({ map: roseTex, color: new THREE.Color(1.8, 1.8, 1.8), fog: false }),
      );
      rose.position.set(0, FLOOR_Y + 16, end * (NAVE_HALF_LENGTH - 0.05));
      rose.rotation.y = end === -1 ? 0 : Math.PI;
      this.group.add(rose);
      for (const x of [-3.2, 0, 3.2]) {
        const w = new THREE.Mesh(lancetGeo, glassMat(seed++, 1.2));
        w.position.set(x, FLOOR_Y + 2.8, end * (NAVE_HALF_LENGTH - 0.05));
        w.rotation.y = end === -1 ? 0 : Math.PI;
        w.scale.set(x === 0 ? 1.1 : 0.9, x === 0 ? 1.15 : 1, 1);
        this.group.add(w);
      }
      // Great beam of coloured light from the rose window onto the board.
      const from = new THREE.Vector3(0, FLOOR_Y + 16, end * NAVE_HALF_LENGTH);
      const to = new THREE.Vector3(0, 0, end * 2);
      const length = from.distanceTo(to);
      const cone = new THREE.CylinderGeometry(3.2, 4.5, length, 32, 1, true);
      cone.rotateX(-Math.PI / 2);
      const beam = new THREE.Mesh(cone, shaftMat(end === -1 ? 0x7d8cff : 0xc59bff, end === -1 ? 0.045 : 0.03));
      beam.position.copy(from).lerp(to, 0.5);
      beam.lookAt(to);
      this.shafts.push(beam);
      this.group.add(beam);
    }
  }

  private buildCandelabra(stone: THREE.MeshStandardMaterial): void {
    const iron = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.5, metalness: 0.8 });
    const wax = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.6, emissive: 0x3a2008, emissiveIntensity: 0.4 });
    for (const [x, z] of [
      [-6, -6],
      [6, -6],
      [-6, 6],
      [6, 6],
    ]) {
      const g = new THREE.Group();
      g.position.set(x, DAIS_TOP, z);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.4, 0.2, 12), stone);
      foot.position.y = 0.1;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.2, 8), iron);
      pole.position.y = 1.2;
      const bar = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 6, 24), iron);
      bar.rotation.x = Math.PI / 2;
      bar.position.y = 2.3;
      g.add(foot, pole, bar);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const cx = i === 0 ? 0 : Math.cos(a) * 0.42;
        const cz = i === 0 ? 0 : Math.sin(a) * 0.42;
        const h = i === 0 ? 0.45 : 0.25 + (i % 2) * 0.1;
        const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, h, 8), wax);
        candle.position.set(cx, 2.33 + h / 2, cz);
        g.add(candle);
        this.addFlame(g, new THREE.Vector3(cx, 2.33 + h + 0.08, cz), 0.18);
      }
      foot.castShadow = pole.castShadow = true;
      const light = new THREE.PointLight(0xff9a48, 6, 16, 1.6);
      light.position.set(0, 2.9, 0);
      g.add(light);
      this.candleLights.push({ light, base: 6, phase: Math.random() * 10 });
      this.group.add(g);
    }
  }

  private buildFloorCandles(rand: () => number): void {
    const wax = new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.7, emissive: 0x2a1404, emissiveIntensity: 0.5 });
    const geos: THREE.BufferGeometry[] = [];
    const flames: THREE.Vector3[] = [];
    // Clusters at the foot of each pillar and on the dais step.
    const spots: [number, number][] = [];
    for (let z = -NAVE_HALF_LENGTH + BAY; z <= NAVE_HALF_LENGTH - BAY; z += BAY) {
      spots.push([-NAVE_X + 1.3, z + 0.8], [NAVE_X - 1.3, z - 0.8]);
    }
    spots.push([-7.2, 0], [7.2, 0], [0, -7.2], [-7.2, 3], [7.2, -3]);
    for (const [sx, sz] of spots) {
      const n = 3 + Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) {
        const x = sx + (rand() - 0.5) * 0.9;
        const z = sz + (rand() - 0.5) * 0.9;
        const y = groundHeight(x, z);
        const h = 0.2 + rand() * 0.5;
        const r = 0.05 + rand() * 0.04;
        const g = new THREE.CylinderGeometry(r, r * 1.05, h, 8);
        g.translate(x, y + h / 2, z);
        geos.push(g);
        flames.push(new THREE.Vector3(x, y + h + 0.07, z));
      }
    }
    const mesh = new THREE.Mesh(mergeGeometries(geos)!, wax);
    this.group.add(mesh);
    for (const p of flames) this.addFlame(this.group, p, 0.14);
  }

  private flameTex = flameTexture();
  private haloTex = glowTexture('rgba(255,170,80,1)', 'rgba(255,120,40,0)');

  private addFlame(parent: THREE.Object3D, at: THREE.Vector3, size: number): void {
    const flame = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.flameTex,
        color: new THREE.Color(2.2, 1.7, 1.2),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    flame.scale.set(size * 0.6, size, 1);
    flame.position.copy(at);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.haloTex,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    halo.scale.setScalar(size * 4);
    halo.position.copy(at);
    parent.add(flame, halo);
    this.candles.push({ flame, halo, baseScale: size, phase: Math.random() * 100 });
  }

  private buildMotes(rand: () => number): void {
    const N = 900;
    const pos = new Float32Array(N * 3);
    this.moteVel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (rand() - 0.5) * 22;
      pos[i * 3 + 1] = FLOOR_Y + rand() * 16;
      pos[i * 3 + 2] = (rand() - 0.5) * 34;
      this.moteVel[i * 3] = (rand() - 0.5) * 0.06;
      this.moteVel[i * 3 + 1] = (rand() - 0.5) * 0.03;
      this.moteVel[i * 3 + 2] = (rand() - 0.5) * 0.06;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        size: 0.06,
        map: glowTexture(),
        color: 0xc8c0ff,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    this.group.add(this.motes);
  }

  update(time: number, dt: number): void {
    for (const c of this.candles) {
      const f = 0.85 + Math.sin(time * 13 + c.phase) * 0.06 + Math.sin(time * 7.3 + c.phase * 2) * 0.08;
      c.flame.scale.set(c.baseScale * 0.6 * (0.95 + (1 - f) * 0.3), c.baseScale * f, 1);
      (c.halo.material as THREE.SpriteMaterial).opacity = 0.25 + f * 0.12;
    }
    for (const l of this.candleLights) {
      const f =
        0.88 + Math.sin(time * 9 + l.phase) * 0.05 + Math.sin(time * 23.7 + l.phase * 3) * 0.04 + Math.sin(time * 2.1 + l.phase) * 0.04;
      l.light.intensity = l.base * f;
    }
    const pos = this.motes.geometry.attributes.position as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    for (let i = 0; i < a.length; i += 3) {
      a[i] += (this.moteVel[i] + Math.sin(time * 0.3 + i) * 0.02) * dt;
      a[i + 1] += this.moteVel[i + 1] * dt;
      a[i + 2] += this.moteVel[i + 2] * dt;
      if (a[i + 1] > FLOOR_Y + 16) a[i + 1] = FLOOR_Y;
      if (a[i + 1] < FLOOR_Y) a[i + 1] = FLOOR_Y + 16;
    }
    pos.needsUpdate = true;
    for (let i = 0; i < this.shafts.length; i++) {
      const m = this.shafts[i].material as THREE.MeshBasicMaterial;
      m.userData.base ??= m.opacity;
      m.opacity = m.userData.base * (0.8 + 0.2 * Math.sin(time * 0.4 + i * 1.7));
    }
  }
}
