import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Animator, ease } from './animator';
import { FLOOR_Y } from './cathedral';

/** Renderer, camera, controls, lighting and post-processing. */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  /** Camera tweens (independent of the game animation speed). */
  readonly cameraAnim = new Animator();
  bloomEnabled = true;
  private shakeAmount = 0;
  private inset = 0;
  private insetTarget = 0;
  private keyLight: THREE.SpotLight;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.classList.add('scene-canvas');
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x040306);
    this.scene.fog = new THREE.FogExp2(0x07060b, 0.03);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
    this.camera.position.set(0, 9, 12);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 24;
    this.controls.minPolarAngle = 0.2;
    this.controls.maxPolarAngle = 1.36;
    this.controls.target.set(0, 0, 0);
    this.controls.rotateSpeed = 0.6;

    // Lighting: dim ambient, a warm key spot over the board, cold moonlight
    // from the rose window and a faint rim.
    this.scene.add(new THREE.HemisphereLight(0x3a3f66, 0x0a0806, 0.55));

    this.keyLight = new THREE.SpotLight(0xffe2b8, 260, 40, 0.48, 0.7, 1.6);
    this.keyLight.position.set(2, 15, 4);
    this.keyLight.target.position.set(0, 0, 0);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.bias = -0.0002;
    this.keyLight.shadow.normalBias = 0.02;
    this.keyLight.shadow.radius = 4;
    this.keyLight.shadow.camera.near = 5;
    this.keyLight.shadow.camera.far = 30;
    this.scene.add(this.keyLight, this.keyLight.target);

    const moon = new THREE.DirectionalLight(0x8ea2ff, 0.9);
    moon.position.set(-4, 14, -18);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.left = -7;
    moon.shadow.camera.right = 7;
    moon.shadow.camera.top = 7;
    moon.shadow.camera.bottom = -7;
    moon.shadow.camera.near = 1;
    moon.shadow.camera.far = 50;
    moon.shadow.bias = -0.0005;
    moon.shadow.normalBias = 0.03;
    this.scene.add(moon);

    const rim = new THREE.DirectionalLight(0xb38cff, 0.35);
    rim.position.set(6, 6, 18);
    this.scene.add(rim);

    this.buildEnvironment();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.6, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Builds a dim "cathedral-like" environment map for glossy reflections. */
  private buildEnvironment(): void {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x030205);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const add = (color: THREE.Color, pos: [number, number, number], scale: [number, number, number]) => {
      const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color, side: THREE.BackSide }));
      m.position.set(...pos);
      m.scale.set(...scale);
      env.add(m);
    };
    const room = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x0a0910, side: THREE.BackSide }));
    room.scale.set(30, 20, 60);
    env.add(room);
    const warm = new THREE.Color(9, 5, 2);
    for (const [x, z] of [
      [-6, -6],
      [6, -6],
      [-6, 6],
      [6, 6],
    ]) {
      add(warm, [x, 3, z], [0.6, 0.6, 0.6]);
    }
    add(new THREE.Color(1.2, 1.6, 4.0), [0, 12, -28], [10, 10, 0.5]);
    add(new THREE.Color(2.4, 1.4, 3.2), [0, 12, 28], [10, 10, 0.5]);
    add(new THREE.Color(2.5, 2.2, 1.8), [2, 15, 4], [3, 0.5, 3]);
    for (const side of [-1, 1]) add(new THREE.Color(0.8, 0.9, 2.0), [side * 14, 6, 0], [0.5, 6, 30]);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(env, 0.03).texture;
    this.scene.environmentIntensity = 1;
    pmrem.dispose();
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    // Pull the camera back on tall/narrow screens so the board stays framed.
    this.camera.fov = w / h < 0.8 ? 58 : w / h < 1.2 ? 48 : 40;
    if (this.inset) this.camera.setViewOffset(w, h, -this.inset / 2, 0, w, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
  }

  /** Shifts the rendered image so the board centres in the uncovered area. */
  setLeftInset(px: number): void {
    this.insetTarget = px;
  }

  private applyInset(dt: number): void {
    if (Math.abs(this.inset - this.insetTarget) < 0.5 && this.inset === this.insetTarget) return;
    this.inset += (this.insetTarget - this.inset) * (1 - Math.exp(-dt * 12));
    if (Math.abs(this.inset - this.insetTarget) < 0.5) this.inset = this.insetTarget;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    if (this.inset === 0) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, -this.inset / 2, 0, w, h);
  }

  setShadows(on: boolean): void {
    this.renderer.shadowMap.enabled = on;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
    });
  }

  /** Smoothly moves the camera to look at the board from the given side. */
  viewFrom(side: 'w' | 'b', duration = 1.4, distance?: number): Promise<void> {
    const dir = side === 'w' ? 1 : -1;
    const aspect = this.camera.aspect;
    const d = distance ?? (aspect < 0.8 ? 15 : 12.5);
    const to = new THREE.Vector3(0, d * 0.72, d * 0.7 * dir);
    return this.flyTo(to, new THREE.Vector3(0, 0, 0.4 * dir), duration);
  }

  flyTo(position: THREE.Vector3, target: THREE.Vector3, duration: number): Promise<void> {
    const fromPos = this.camera.position.clone();
    const fromTarget = this.controls.target.clone();
    // Orbit around the board rather than cutting through it.
    const r0 = Math.hypot(fromPos.x, fromPos.z);
    const r1 = Math.hypot(position.x, position.z);
    const a0 = Math.atan2(fromPos.x, fromPos.z);
    let a1 = Math.atan2(position.x, position.z);
    let da = a1 - a0;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    // Exactly opposite: sweep around a consistent side.
    if (Math.abs(Math.abs(da) - Math.PI) < 0.05) da = Math.PI;
    a1 = a0 + da;
    this.controls.enabled = false;
    return this.cameraAnim
      .tween(
        duration,
        (t) => {
          const a = a0 + (a1 - a0) * t;
          const r = r0 + (r1 - r0) * t;
          this.camera.position.set(Math.sin(a) * r, fromPos.y + (position.y - fromPos.y) * t, Math.cos(a) * r);
          this.controls.target.lerpVectors(fromTarget, target, t);
          this.camera.lookAt(this.controls.target);
        },
        ease.inOutCubic,
      )
      .then(() => {
        this.controls.enabled = true;
      });
  }

  /** Opening shot: glide down the nave toward the board. */
  intro(side: 'w' | 'b'): Promise<void> {
    const dir = side === 'w' ? 1 : -1;
    this.camera.position.set(0, FLOOR_Y + 5, 27 * dir);
    this.controls.target.set(0, 2, 0);
    this.camera.lookAt(this.controls.target);
    const d = this.camera.aspect < 0.8 ? 15 : 12.5;
    const fromPos = this.camera.position.clone();
    const toPos = new THREE.Vector3(0, d * 0.72, d * 0.7 * dir);
    const fromT = this.controls.target.clone();
    const toT = new THREE.Vector3(0, 0, 0.4 * dir);
    this.controls.enabled = false;
    return this.cameraAnim
      .tween(
        3.2,
        (t) => {
          this.camera.position.lerpVectors(fromPos, toPos, t);
          this.camera.position.y += Math.sin(Math.PI * t) * 2.5;
          this.controls.target.lerpVectors(fromT, toT, t);
          this.camera.lookAt(this.controls.target);
        },
        ease.inOutCubic,
      )
      .then(() => {
        this.controls.enabled = true;
      });
  }

  shake(amount: number): void {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  render(dt: number): void {
    this.cameraAnim.update(dt);
    this.applyInset(dt);
    if (this.controls.enabled) this.controls.update();
    let offset: THREE.Vector3 | null = null;
    if (this.shakeAmount > 0.001) {
      offset = new THREE.Vector3(
        (Math.random() - 0.5) * this.shakeAmount,
        (Math.random() - 0.5) * this.shakeAmount,
        (Math.random() - 0.5) * this.shakeAmount,
      );
      this.camera.position.add(offset);
      this.shakeAmount *= Math.exp(-dt * 9);
    }
    if (this.bloomEnabled) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    if (offset) this.camera.position.sub(offset);
  }
}
