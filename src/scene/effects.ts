import * as THREE from 'three';
import { glowTexture } from './textures';

/**
 * Transient visual effects: piece shattering (real geometry split into
 * Voronoi-clustered shards with simple rigid-body physics), dust puffs,
 * arcane sparks, impact shockwaves and light flashes.
 */

export type GroundFn = (x: number, z: number) => number;

interface Shard {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  materials: THREE.Material[];
  age: number;
  life: number;
  resting: boolean;
}

interface Particle {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  age: number;
  life: number;
  size0: number;
  size1: number;
  gravity: number;
  opacity: number;
}

interface Ring {
  mesh: THREE.Mesh;
  age: number;
  life: number;
  maxScale: number;
}

interface Flash {
  light: THREE.PointLight;
  age: number;
  life: number;
  peak: number;
}

const tmpV = new THREE.Vector3();

export class Effects {
  private shards: Shard[] = [];
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private flashes: Flash[] = [];
  private glow = glowTexture();
  private lightPool: THREE.PointLight[] = [];
  private ringGeo = new THREE.RingGeometry(0.8, 1, 64);

  constructor(
    private scene: THREE.Scene,
    private ground: GroundFn,
  ) {
    // A small pool of lights kept in the scene permanently (intensity 0) so the
    // renderer never has to recompile shaders when flashes appear.
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 6, 2);
      scene.add(l);
      this.lightPool.push(l);
    }
  }

  /**
   * Breaks every mesh under `root` into shards. The original object is left
   * untouched (the caller hides / removes it).
   */
  shatter(root: THREE.Object3D, impulse: THREE.Vector3, glowColor: THREE.ColorRepresentation): void {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Voronoi seeds distributed through the piece's volume (more toward the top).
    const seedCount = 14 + Math.floor(Math.random() * 6);
    const seeds: THREE.Vector3[] = [];
    for (let i = 0; i < seedCount; i++) {
      seeds.push(
        new THREE.Vector3(
          box.min.x + size.x * (0.15 + Math.random() * 0.7),
          box.min.y + size.y * Math.pow(Math.random(), 0.8),
          box.min.z + size.z * (0.15 + Math.random() * 0.7),
        ),
      );
    }

    // bucket[seed] -> material -> positions/normals
    type Bucket = Map<THREE.Material, { pos: number[]; nor: number[] }>;
    const buckets: Bucket[] = seeds.map(() => new Map());

    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      const material = mesh.material as THREE.Material;
      const geo = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(
        mesh.matrixWorld,
      );
      const p = geo.attributes.position.array as ArrayLike<number>;
      const n = geo.attributes.normal?.array as ArrayLike<number> | undefined;
      for (let t = 0; t < p.length; t += 9) {
        const cx = (p[t] + p[t + 3] + p[t + 6]) / 3;
        const cy = (p[t + 1] + p[t + 4] + p[t + 7]) / 3;
        const cz = (p[t + 2] + p[t + 5] + p[t + 8]) / 3;
        let best = 0;
        let bestD = Infinity;
        for (let s = 0; s < seeds.length; s++) {
          const d = (seeds[s].x - cx) ** 2 + (seeds[s].y - cy) ** 2 * 0.6 + (seeds[s].z - cz) ** 2;
          if (d < bestD) {
            bestD = d;
            best = s;
          }
        }
        let entry = buckets[best].get(material);
        if (!entry) {
          entry = { pos: [], nor: [] };
          buckets[best].set(material, entry);
        }
        for (let k = 0; k < 9; k++) {
          entry.pos.push(p[t + k]);
          entry.nor.push(n ? n[t + k] : 0);
        }
      }
      geo.dispose();
    });

    const fadeMats = new Map<THREE.Material, THREE.Material>();
    const fadeMat = (m: THREE.Material) => {
      let f = fadeMats.get(m);
      if (!f) {
        f = m.clone();
        f.transparent = true;
        f.side = THREE.DoubleSide;
        fadeMats.set(m, f);
      }
      return f;
    };

    buckets.forEach((bucket) => {
      if (bucket.size === 0) return;
      const shardGroup = new THREE.Group();
      // Fragment centroid
      const c = new THREE.Vector3();
      let count = 0;
      for (const { pos } of bucket.values()) {
        for (let i = 0; i < pos.length; i += 3) {
          c.x += pos[i];
          c.y += pos[i + 1];
          c.z += pos[i + 2];
          count++;
        }
      }
      c.divideScalar(count);
      const mats: THREE.Material[] = [];
      for (const [mat, { pos, nor }] of bucket) {
        for (let i = 0; i < pos.length; i += 3) {
          pos[i] -= c.x;
          pos[i + 1] -= c.y;
          pos[i + 2] -= c.z;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        const fm = fadeMat(mat);
        mats.push(fm);
        const mesh = new THREE.Mesh(g, fm);
        mesh.castShadow = true;
        shardGroup.add(mesh);
      }
      shardGroup.position.copy(c);
      this.scene.add(shardGroup);

      const outward = tmpV.copy(c).sub(center).setY(0);
      if (outward.lengthSq() < 1e-4) outward.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      outward.normalize();
      const height = (c.y - box.min.y) / Math.max(size.y, 1e-3);
      const vel = new THREE.Vector3()
        .addScaledVector(outward, 1.2 + Math.random() * 1.8)
        .addScaledVector(impulse, (1.5 + Math.random() * 2.5) * (0.5 + height))
        .add(new THREE.Vector3(0, 1.5 + Math.random() * 3 * height, 0));
      this.shards.push({
        obj: shardGroup,
        vel,
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14,
        ),
        materials: mats,
        age: 0,
        life: 2.6 + Math.random() * 1.2,
        resting: false,
      });
    });

    // Arcane sparks + stone dust
    const glow = new THREE.Color(glowColor);
    this.burst(center, glow, 26, 3.2, 0.09, 0.0, 1.0, -2.5);
    this.burst(center.clone().setY(box.min.y + 0.1), new THREE.Color(0x8a8378), 14, 1.2, 0.35, 0.9, 1.4, 0.4, 0.35);
    this.shockwave(new THREE.Vector3(center.x, box.min.y + 0.02, center.z), glow, 1.4);
    this.flash(center, glow, 18, 0.5);
  }

  /** Radial particle burst. */
  burst(
    at: THREE.Vector3,
    color: THREE.Color,
    count: number,
    speed: number,
    size0: number,
    size1: number,
    life: number,
    gravity: number,
    opacity = 1,
  ): void {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.glow,
        color,
        transparent: true,
        depthWrite: false,
        blending: opacity < 1 ? THREE.NormalBlending : THREE.AdditiveBlending,
        opacity,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(at);
      sprite.scale.setScalar(size0);
      this.scene.add(sprite);
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize();
      this.particles.push({
        sprite,
        vel: dir.multiplyScalar(speed * (0.4 + Math.random() * 0.6)),
        age: 0,
        life: life * (0.6 + Math.random() * 0.5),
        size0,
        size1,
        gravity,
        opacity,
      });
    }
  }

  /** Small puff of dust where a piece lands. */
  dust(at: THREE.Vector3, strength = 1): void {
    const c = new THREE.Color(0x8a8378);
    for (let i = 0; i < Math.round(8 * strength); i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.glow,
        color: c,
        transparent: true,
        depthWrite: false,
        opacity: 0.25,
      });
      const sprite = new THREE.Sprite(mat);
      const a = Math.random() * Math.PI * 2;
      sprite.position.set(at.x + Math.cos(a) * 0.2, at.y + 0.05, at.z + Math.sin(a) * 0.2);
      sprite.scale.setScalar(0.15);
      this.scene.add(sprite);
      this.particles.push({
        sprite,
        vel: new THREE.Vector3(Math.cos(a), 0.25, Math.sin(a)).multiplyScalar(0.6 * strength),
        age: 0,
        life: 0.7 + Math.random() * 0.3,
        size0: 0.15,
        size1: 0.45 * strength,
        gravity: 0,
        opacity: 0.25,
      });
    }
  }

  shockwave(at: THREE.Vector3, color: THREE.Color, maxScale: number): void {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(at);
    mesh.scale.setScalar(0.05);
    this.scene.add(mesh);
    this.rings.push({ mesh, age: 0, life: 0.55, maxScale });
  }

  flash(at: THREE.Vector3, color: THREE.Color, peak: number, life: number): void {
    const light = this.lightPool.find((l) => l.intensity === 0) ?? this.lightPool[0];
    light.color.copy(color);
    light.position.copy(at).add(new THREE.Vector3(0, 0.4, 0));
    light.intensity = peak;
    this.flashes = this.flashes.filter((f) => f.light !== light);
    this.flashes.push({ light, age: 0, life, peak });
  }

  update(dt: number): void {
    // Shards
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.age += dt;
      const o = s.obj;
      if (!s.resting) {
        s.vel.y -= 9.8 * dt;
        o.position.addScaledVector(s.vel, dt);
        o.rotation.x += s.spin.x * dt;
        o.rotation.y += s.spin.y * dt;
        o.rotation.z += s.spin.z * dt;
        const gy = this.ground(o.position.x, o.position.z) + 0.03;
        if (o.position.y < gy) {
          o.position.y = gy;
          if (Math.abs(s.vel.y) < 0.6) {
            s.vel.set(0, 0, 0);
            s.resting = true;
          } else {
            s.vel.y *= -0.32;
            s.vel.x *= 0.6;
            s.vel.z *= 0.6;
            s.spin.multiplyScalar(0.5);
          }
        }
      }
      const fadeStart = s.life - 0.9;
      if (s.age > fadeStart) {
        const k = 1 - (s.age - fadeStart) / 0.9;
        for (const m of s.materials) m.opacity = Math.max(0, k);
        o.scale.setScalar(Math.max(0.01, 0.4 + 0.6 * k));
      }
      if (s.age >= s.life) {
        this.scene.remove(o);
        o.traverse((c) => (c as THREE.Mesh).geometry?.dispose());
        this.shards.splice(i, 1);
      }
    }
    // Materials shared between shards of one shatter: dispose when no shard uses them.
    // (Cheap enough to let GC handle; fade materials are small.)

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      const t = p.age / p.life;
      p.vel.y += p.gravity * dt;
      p.vel.multiplyScalar(1 - 1.5 * dt);
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.scale.setScalar(p.size0 + (p.size1 - p.size0) * t);
      (p.sprite.material as THREE.SpriteMaterial).opacity = p.opacity * (1 - t);
      if (t >= 1) {
        this.scene.remove(p.sprite);
        p.sprite.material.dispose();
        this.particles.splice(i, 1);
      }
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      const t = r.age / r.life;
      r.mesh.scale.setScalar(0.05 + (r.maxScale - 0.05) * (1 - Math.pow(1 - t, 3)));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t);
      if (t >= 1) {
        this.scene.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
      }
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.age += dt;
      const t = Math.min(1, f.age / f.life);
      f.light.intensity = f.peak * Math.pow(1 - t, 2);
      if (t >= 1) {
        f.light.intensity = 0;
        this.flashes.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const s of this.shards) this.scene.remove(s.obj);
    for (const p of this.particles) this.scene.remove(p.sprite);
    for (const r of this.rings) this.scene.remove(r.mesh);
    for (const f of this.flashes) f.light.intensity = 0;
    this.shards = [];
    this.particles = [];
    this.rings = [];
    this.flashes = [];
  }
}
