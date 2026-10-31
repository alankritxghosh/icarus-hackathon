import type { Scene, Viewpoint } from "@icarus/core";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { WebGLPathTracer } from "three-gpu-pathtracer";
import { GenerateMeshBVHWorker } from "three-mesh-bvh/worker";
import { surface } from "./textures";

export type ViewMode = "orbit" | "plan" | "eye";

/** What the realistic renderer is doing, for the person watching it. */
export interface RealState {
  state: "off" | "preparing" | "rendering" | "done" | "unsupported";
  /** Samples per pixel accumulated so far. */
  samples: number;
}

/** Samples per pixel after which the image is clean enough and the GPU is left alone. */
const SAMPLE_CAP = 600;

const SKY = new THREE.Color("#cfdfe8");
const DARK = new THREE.Color("#0a0f0d");

/**
 * Renders a core Scene with three.js. Rendering is on demand: it draws when the camera moves,
 * the window resizes or the scene changes, so an idle office costs nothing.
 */
export class OfficeView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly three = new THREE.Scene();
  private readonly perspective = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
  private readonly ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
  private readonly orbit: OrbitControls;
  private readonly plan: OrbitControls;
  private readonly sun = new THREE.DirectionalLight(0xffffff, 1.5);
  private readonly content = new THREE.Group();
  private rasterEnvironment?: THREE.Texture;
  private mode: ViewMode = "orbit";
  private showCeiling = false;
  private shell = { w: 20, h: 12 };
  private frame = 0;
  private generation = 0;
  private readonly loader = new GLTFLoader();
  private readonly models = new Map<string, Promise<THREE.Object3D>>();
  private readonly observer: ResizeObserver;
  /** Where the orbit camera was before standing inside, so leaving puts it back. */
  private saved?: { position: THREE.Vector3; fov: number };
  private look = { yaw: 0, pitch: 0 };
  private drag?: { x: number; y: number };
  private readonly keys = (e: KeyboardEvent) => this.onKey(e);
  // Realistic mode: progressive path tracing on the GPU of the person looking, in the browser, on the live model.
  private tracer?: WebGLPathTracer;
  private realistic = false;
  private tracerPreparing = false;
  private tracerTimer = 0;
  private tracerFrame = 0;
  private tracerGeneration = 0;
  private assetsPending = 0;
  private sky?: THREE.Texture;
  private onReal?: (state: RealState) => void;
  private areaLights: THREE.RectAreaLight[] = [];
  private readonly pbrSets = new Map<
    string,
    { map: THREE.Texture; normal: THREE.Texture; arm: THREE.Texture }
  >();
  private pending = 0;
  private realSky?: THREE.Texture;
  private denoiseTarget?: THREE.WebGLRenderTarget;
  private readonly denoise = new FullScreenQuad(
    new THREE.ShaderMaterial({
      uniforms: {
        tMap: { value: null },
        texel: { value: new THREE.Vector2(1, 1) },
        spp: { value: 1 },
      },
      vertexShader:
        "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      // An edge-aware blur on the accumulated image: neighbours count when their brightness is within what noise at this
      // many samples could explain, so grain smooths away while real edges stay. It fades out as samples accumulate.
      fragmentShader: `
        uniform sampler2D tMap; uniform vec2 texel; uniform float spp; varying vec2 vUv;
        float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
        void main(){
          vec4 c0 = texture2D(tMap, vUv);
          float l0 = lum(c0.rgb);
          float noise = 1.0 / sqrt(max(spp, 1.0));
          vec3 acc = vec3(0.0); float wsum = 0.0;
          for (int j = -3; j <= 3; j++) for (int i = -3; i <= 3; i++) {
            vec3 c = texture2D(tMap, vUv + vec2(float(i), float(j)) * texel).rgb;
            float dl = lum(c) - l0;
            float sigma = 1.6 * noise * (l0 + lum(c) + 0.05);
            float w = exp(-(dl * dl) / (2.0 * sigma * sigma + 1e-6)) * exp(-float(i * i + j * j) / 8.0);
            acc += c * w; wsum += w;
          }
          gl_FragColor = vec4(acc / wsum, c0.a);
        }`,
      depthTest: false,
      depthWrite: false,
    }),
  );

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(this.renderer.domElement);
    this.three.background = DARK;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.rasterEnvironment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.three.environment = this.rasterEnvironment;
    this.three.environmentIntensity = 0.55;
    pmrem.dispose();
    this.three.add(this.content);
    this.three.add(new THREE.HemisphereLight(0xffffff, 0xb9bec4, 1.0));
    this.three.add(this.sun, this.sun.target);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;

    this.orbit = new OrbitControls(this.perspective, this.renderer.domElement);
    this.orbit.maxPolarAngle = Math.PI / 2 - 0.02;
    this.orbit.addEventListener("change", () => this.cameraMoved());
    this.ortho.up.set(0, 0, -1);
    this.plan = new OrbitControls(this.ortho, this.renderer.domElement);
    this.plan.enableRotate = false;
    this.plan.screenSpacePanning = true;
    this.plan.addEventListener("change", () => this.requestRender());
    this.plan.enabled = false;

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", (e) => {
      if (this.mode !== "eye") return;
      this.drag = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (this.mode !== "eye" || !this.drag) return;
      this.look.yaw += (e.clientX - this.drag.x) * 0.004;
      this.look.pitch = Math.max(
        -1.2,
        Math.min(1.2, this.look.pitch + (e.clientY - this.drag.y) * 0.004),
      );
      this.drag = { x: e.clientX, y: e.clientY };
      this.applyLook();
    });
    const release = () => {
      this.drag = undefined;
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    window.addEventListener("keydown", this.keys);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }

  /** A photographic material set (diffuse, normal, AO-roughness-metal), loaded once and shared. */
  private pbr(id: string) {
    let set = this.pbrSets.get(id);
    if (!set) {
      const load = (kind: string, srgb: boolean) => {
        this.pending++;
        const t = new THREE.TextureLoader().load(
          `/assets/textures/${id}/${id}_${kind}_1k.jpg`,
          () => this.textureLoaded(),
          undefined,
          () => this.textureLoaded(),
        );
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 8;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        return t;
      };
      set = { map: load("diff", true), normal: load("nor_gl", false), arm: load("arm", false) };
      this.pbrSets.set(id, set);
    }
    return set;
  }

  private textureLoaded() {
    this.pending--;
    if (this.pending === 0) {
      this.requestRender();
      this.rebuildTracer();
    }
  }

  setScene(scene: Scene) {
    this.disposeContent();
    this.shell = scene.shell;
    const materials = new Map<string, THREE.MeshStandardMaterial>();
    const material = (id: string) => {
      let m = materials.get(id);
      if (!m) {
        const def = scene.materials[id] ?? {
          color: "#cccccc",
          roughness: 1,
          metalness: 0,
          opacity: 1,
        };
        m = new THREE.MeshStandardMaterial({
          color: def.color,
          roughness: def.roughness,
          metalness: def.metalness,
          transparent: def.opacity < 1,
          opacity: def.opacity,
          side: def.opacity < 1 ? THREE.DoubleSide : THREE.FrontSide,
          depthWrite: def.opacity >= 1,
        });
        if (def.emissive) {
          m.emissive = new THREE.Color(def.emissive);
          m.emissiveIntensity = 1.2;
        }
        materials.set(id, m);
      }
      return m;
    };
    const generation = ++this.generation;
    for (const node of scene.nodes) {
      if (node.geometry.kind === "asset") {
        this.addAsset(node, generation);
        continue;
      }
      const geometry =
        node.geometry.kind === "box"
          ? new THREE.BoxGeometry(...node.geometry.size)
          : new THREE.CylinderGeometry(
              node.geometry.radius,
              node.geometry.radius,
              node.geometry.height,
              24,
            );
      const def = scene.materials[node.material];
      let mat = material(node.material);
      if (def?.pbr && node.geometry.kind === "box") {
        const set = this.pbr(def.pbr);
        const [sx, sy, sz] = node.geometry.size;
        const tile = def.tileM ?? 1.5;
        mat = mat.clone();
        // A floor or ceiling tiles by its plan size; a wall by its length and height.
        const flat = sy < Math.min(sx, sz);
        const across = flat ? sx : Math.max(sx, sz);
        const down = flat ? sz : sy;
        const place = (t: THREE.Texture) => {
          const c = t.clone();
          c.needsUpdate = true;
          c.repeat.set(Math.max(1, across / tile), Math.max(1, down / tile));
          return c;
        };
        mat.map = place(set.map);
        mat.normalMap = place(set.normal);
        mat.roughnessMap = place(set.arm);
        mat.metalnessMap = mat.roughnessMap;
        mat.roughness = 1;
        mat.metalness = 0;
      } else if (def?.texture && node.geometry.kind === "box") {
        mat = mat.clone();
        mat.map = surface(def.texture, node.geometry.size[0], node.geometry.size[2]);
      }
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.position.set(...node.position);
      mesh.rotation.y = node.rotationY;
      mesh.castShadow = node.type !== "floor" && node.type !== "window" && node.type !== "ceiling";
      mesh.receiveShadow = node.type !== "window";
      mesh.userData = { nodeId: node.id, type: node.type };
      this.content.add(mesh);
    }
    const grass = this.pbr("leafy_grass");
    const groundMaterial = new THREE.MeshStandardMaterial({ color: "#9fb08c", roughness: 1 });
    const tiled = (t: THREE.Texture) => {
      const c = t.clone();
      c.needsUpdate = true;
      c.repeat.set(80, 80);
      return c;
    };
    groundMaterial.map = tiled(grass.map);
    groundMaterial.normalMap = tiled(grass.normal);
    groundMaterial.roughnessMap = tiled(grass.arm);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.06;
    ground.receiveShadow = true;
    ground.userData.noExport = true;
    this.content.add(ground);

    this.addLandscape(scene.shell, generation);

    const { w, h } = scene.shell;
    this.sun.position.set(w * 0.2, 28, h * 1.2);
    this.sun.target.position.set(w / 2, 0, h / 2);
    const span = Math.max(w, h) * 0.9;
    Object.assign(this.sun.shadow.camera, {
      left: -span,
      right: span,
      top: span,
      bottom: -span,
      near: 1,
      far: 90,
    });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sky?.dispose();
    this.sky = undefined;
    this.applyCeiling();
    this.frameCameras();
    this.requestRender();
    this.rebuildTracer();
  }

  /** Low garden plants around the outside of the building, so it stands in a place and not on a plain. Not exported. */
  private addLandscape(shell: { w: number; h: number }, generation: number) {
    const kinds = ["anthurium_botany_01", "calathea_orbifolia_01", "fern_02"];
    const spots: [number, number][] = [];
    const gap = 2.2;
    for (let x = 1; x < shell.w; x += 3.6) spots.push([x, shell.h + gap], [x + 1.4, -gap]);
    for (let z = 2; z < shell.h; z += 3.6) spots.push([shell.w + gap, z], [-gap, z + 1.2]);
    spots.forEach(([x, z], i) => {
      const id = kinds[i % kinds.length] as string;
      let model = this.models.get(id);
      if (!model) {
        model = this.loader.loadAsync(`/assets/models/${id}/${id}.gltf`).then((gltf) => {
          gltf.scene.traverse((o) => {
            if (o instanceof THREE.Mesh) o.castShadow = true;
          });
          return gltf.scene;
        });
        this.models.set(id, model);
      }
      const group = new THREE.Group();
      group.position.set(x, 0, z);
      group.rotation.y = i * 1.7;
      group.userData = { noExport: true };
      this.content.add(group);
      model
        .then((source) => {
          if (generation !== this.generation) return;
          const copy = source.clone(true);
          copy.scale.setScalar(0.45);
          const box = new THREE.Box3().setFromObject(copy);
          const c = box.getCenter(new THREE.Vector3());
          copy.position.set(-c.x, -box.min.y, -c.z);
          group.add(copy);
          this.requestRender();
        })
        .catch(() => undefined);
    });
  }

  /** Loads a modelled object once, then places a clone: centred on its footprint, resting on its base. */
  private addAsset(node: Scene["nodes"][number], generation: number) {
    if (node.geometry.kind !== "asset") return;
    const { id, size, scale } = node.geometry;
    let model = this.models.get(id);
    if (!model) {
      model = this.loader.loadAsync(`/assets/models/${id}/${id}.gltf`).then((gltf) => {
        gltf.scene.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        return gltf.scene;
      });
      this.models.set(id, model);
    }
    const group = new THREE.Group();
    group.position.set(...node.position);
    group.rotation.y = node.rotationY;
    group.userData = { nodeId: node.id, type: node.type };
    this.content.add(group);
    this.assetsPending++;
    model
      .finally(() => {
        this.assetsPending--;
        if (this.assetsPending === 0 && generation === this.generation) this.rebuildTracer();
      })
      .catch(() => undefined);
    model
      .then((source) => {
        if (generation !== this.generation) return;
        const copy = source.clone(true);
        // A model stretched to fit a footprint the planner chose (a desk of 1.4 m, a table for six).
        if (scale) copy.scale.set(...scale);
        const box = new THREE.Box3().setFromObject(copy);
        const centre = box.getCenter(new THREE.Vector3());
        copy.position.set(-centre.x, -box.min.y, -centre.z);
        group.add(copy);
        this.requestRender();
      })
      .catch(() => {
        // A missing model must not leave a hole: show its footprint as a plain block.
        const block = new THREE.Mesh(
          new THREE.BoxGeometry(size[0], size[1], size[2]),
          new THREE.MeshStandardMaterial({ color: "#c9a273" }),
        );
        block.position.y = size[1] / 2;
        group.add(block);
        this.requestRender();
      });
  }

  setMode(mode: ViewMode) {
    const wasEye = this.mode === "eye";
    if (mode === "eye" && !wasEye)
      this.saved = { position: this.perspective.position.clone(), fov: this.perspective.fov };
    if (wasEye && mode !== "eye") this.leaveEye();
    this.mode = mode;
    this.orbit.enabled = mode === "orbit";
    this.plan.enabled = mode === "plan";
    this.three.background = this.realistic ? this.skyTexture() : mode === "eye" ? SKY : DARK;
    this.applyCeiling();
    this.applyLabels();
    if (this.realistic && mode !== "plan") {
      this.tracer?.updateEnvironment();
      this.cameraMoved();
    } else this.requestRender();
  }

  /** Stand at a viewpoint: camera at eye height looking at its target. */
  setViewpoint(view: Viewpoint) {
    this.setMode("eye");
    const [x, y, z] = view.position;
    this.perspective.position.set(x, y, z);
    this.perspective.fov = view.fovDeg;
    this.perspective.updateProjectionMatrix();
    const dx = view.target[0] - x;
    const dy = view.target[1] - y;
    const dz = view.target[2] - z;
    this.look = { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
    this.applyLook();
  }

  private applyLook() {
    this.perspective.rotation.order = "YXZ";
    this.perspective.rotation.set(this.look.pitch, this.look.yaw, 0);
    this.cameraMoved();
  }

  private leaveEye() {
    this.perspective.rotation.order = "XYZ";
    if (this.saved) {
      this.perspective.position.copy(this.saved.position);
      this.perspective.fov = this.saved.fov;
      this.perspective.updateProjectionMatrix();
    }
    this.orbit.update();
  }

  /** Walk with the arrow keys or WASD, staying inside the shell. */
  private onKey(e: KeyboardEvent) {
    if (this.mode !== "eye") return;
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    const forward = { ArrowUp: 1, w: 1, W: 1, ArrowDown: -1, s: -1, S: -1 }[e.key];
    const strafe = { ArrowRight: 1, d: 1, D: 1, ArrowLeft: -1, a: -1, A: -1 }[e.key];
    if (forward === undefined && strafe === undefined) return;
    e.preventDefault();
    const step = 0.3;
    const { yaw } = this.look;
    const dx = -Math.sin(yaw) * (forward ?? 0) * step + Math.cos(yaw) * (strafe ?? 0) * step;
    const dz = -Math.cos(yaw) * (forward ?? 0) * step - Math.sin(yaw) * (strafe ?? 0) * step;
    const p = this.perspective.position;
    p.x = Math.min(this.shell.w - 0.4, Math.max(0.4, p.x + dx));
    p.z = Math.min(this.shell.h - 0.4, Math.max(0.4, p.z + dz));
    this.cameraMoved();
  }

  setCeiling(show: boolean) {
    this.showCeiling = show;
    this.applyCeiling();
    this.requestRender();
  }

  /**
   * The office as a binary glTF (.glb): what is on screen, without the ground, the plan-view labels
   * or anything hidden. Opens in Blender, Windows 3D Viewer, macOS Quick Look and most CAD viewers.
   */
  async exportGlb(): Promise<ArrayBuffer> {
    const out = new THREE.Group();
    for (const child of this.content.children)
      if (!child.userData.noExport && !(child instanceof THREE.Sprite)) out.add(child.clone());
    const result = await new GLTFExporter().parseAsync(out, {
      binary: true,
      onlyVisible: true,
      maxTextureSize: 512,
    });
    if (!(result instanceof ArrayBuffer)) throw new Error("The 3D file could not be made.");
    return result;
  }

  /** A PNG of the current view, for the critique loop and for exports. */
  snapshot(): string {
    this.draw();
    return this.renderer.domElement.toDataURL("image/png");
  }

  /** A JPEG of the current view at a fixed size, whatever the window is, for the repaint. */
  snapshotAt(width: number, height: number, quality = 0.9): string {
    const ratio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.perspective.aspect = width / height;
    this.perspective.updateProjectionMatrix();
    this.draw();
    const url = this.renderer.domElement.toDataURL("image/jpeg", quality);
    this.renderer.setPixelRatio(ratio);
    this.resize();
    return url;
  }

  dispose() {
    this.realistic = false;
    cancelAnimationFrame(this.tracerFrame);
    clearTimeout(this.tracerTimer);
    this.tracer?.dispose();
    this.denoiseTarget?.dispose();
    window.removeEventListener("keydown", this.keys);
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.orbit.dispose();
    this.plan.dispose();
    this.disposeContent();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private applyCeiling() {
    for (const child of this.content.children)
      if (child.userData.type === "ceiling")
        child.visible = this.mode === "eye" || (this.showCeiling && this.mode === "orbit");
  }

  private frameCameras() {
    const { w, h } = this.shell;
    const centre = new THREE.Vector3(w / 2, 0, h / 2);
    const reach = Math.max(w, h);
    this.perspective.position.set(w * 0.5, reach * 0.95, h + reach * 0.8);
    this.orbit.target.copy(centre);
    this.orbit.update();
    this.ortho.position.set(centre.x, 60, centre.z);
    this.plan.target.copy(centre);
    this.ortho.zoom = 1;
    this.plan.update();
    this.resize();
  }

  private resize() {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.perspective.aspect = width / height;
    this.perspective.updateProjectionMatrix();
    const { w, h } = this.shell;
    const halfH = Math.max(h, w * (height / width)) * 0.62;
    this.ortho.left = -halfH * (width / height);
    this.ortho.right = halfH * (width / height);
    this.ortho.top = halfH;
    this.ortho.bottom = -halfH;
    this.ortho.updateProjectionMatrix();
    this.cameraMoved();
  }

  private requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw() {
    if (this.realistic && this.tracer && !this.tracerPreparing && this.mode !== "plan") return;
    this.renderer.render(this.three, this.mode === "plan" ? this.ortho : this.perspective);
  }

  private cameraMoved() {
    if (this.realistic && this.tracer && this.mode !== "plan") {
      this.perspective.updateMatrixWorld();
      this.tracer.updateCamera();
      this.tracer.pausePathTracing = false;
      this.startTracing();
    } else this.requestRender();
  }

  // ---- Realistic mode ----

  supportsRealistic(): boolean {
    return (
      this.renderer.capabilities.isWebGL2 &&
      !!this.renderer.getContext().getExtension("EXT_color_buffer_float")
    );
  }

  /**
   * A daylight sky as a high-dynamic-range equirectangular picture: blue zenith, pale horizon, a ground, and a sun
   * disc far brighter than the sky, so the path tracer lights the rooms by the sun through the windows. The sun sits
   * where the raster preview's sun does.
   */
  private skyTexture(): THREE.Texture {
    if (this.realSky) return this.realSky;
    if (this.sky) return this.sky;
    const w = 512;
    const h = 256;
    const data = new Float32Array(w * h * 4);
    const toSun = this.sun.position.clone().sub(this.sun.target.position).normalize();
    const zenith = [0.28, 0.5, 0.95];
    const horizon = [0.95, 0.97, 1.0];
    const ground = [0.3, 0.28, 0.25];
    for (let j = 0; j < h; j++) {
      const el = ((j + 0.5) / h - 0.5) * Math.PI;
      for (let i = 0; i < w; i++) {
        const phi = ((i + 0.5) / w - 0.5) * Math.PI * 2;
        const dx = Math.cos(el) * Math.cos(phi);
        const dy = Math.sin(el);
        const dz = Math.cos(el) * Math.sin(phi);
        let c: number[];
        if (dy >= 0) {
          const t = dy ** 0.5;
          c = [0, 1, 2].map((k) => (horizon[k] as number) * (1 - t) + (zenith[k] as number) * t);
        } else c = ground;
        const cosSun = dx * toSun.x + dy * toSun.y + dz * toSun.z;
        // A small intense disc and a wide soft glow around it.
        const sun = cosSun > 0.9995 ? 400 : 0;
        const glow = Math.max(0, cosSun) ** 64 * 3;
        const o = (j * w + i) * 4;
        data[o] = (c[0] as number) + sun + glow;
        data[o + 1] = (c[1] as number) + sun * 0.96 + glow * 0.95;
        data[o + 2] = (c[2] as number) + sun * 0.88 + glow * 0.85;
        data[o + 3] = 1;
      }
    }
    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.sky = tex;
    return tex;
  }

  /** Turn realistic rendering on or off. `onState` hears what the renderer is doing, for a caption. */
  setRealistic(on: boolean, onState?: (state: RealState) => void) {
    if (onState) this.onReal = onState;
    if (on === this.realistic) return;
    this.realistic = on;
    if (!on) {
      this.tracerPreparing = false;
      cancelAnimationFrame(this.tracerFrame);
      this.tracerFrame = 0;
      clearTimeout(this.tracerTimer);
      this.three.environment = this.rasterEnvironment ?? null;
      this.three.environmentIntensity = 0.55;
      this.three.background = this.mode === "eye" ? SKY : DARK;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.sun.visible = true;
      this.renderer.toneMappingExposure = 1;
      for (const l of this.areaLights) this.three.remove(l);
      this.areaLights = [];
      this.onReal?.({ state: "off", samples: 0 });
      this.resize();
      return;
    }
    if (!this.supportsRealistic()) {
      this.realistic = false;
      this.onReal?.({ state: "unsupported", samples: 0 });
      return;
    }
    this.loadRealSky();
    this.renderer.setPixelRatio(1);
    this.renderer.toneMappingExposure = 1.6;
    this.sun.visible = false;
    this.resize();
    this.rebuildTracer();
  }

  /** A real photographed sky (Poly Haven, CC0) replaces the drawn one as soon as it has loaded. */
  private loadRealSky() {
    if (this.realSky) return;
    const loader = new RGBELoader().setDataType(THREE.FloatType);
    void loader
      .loadAsync("/assets/hdri/alps_field_2k.hdr")
      .then((tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        this.realSky = tex;
        if (this.realistic) this.rebuildTracer();
      })
      .catch(() => undefined);
  }

  private rebuildTracer() {
    if (!this.realistic) return;
    const generation = ++this.tracerGeneration;
    this.tracerPreparing = true;
    this.onReal?.({ state: "preparing", samples: 0 });
    // Windows and ceilings and models are all in `content`; the path tracer reads the three.js scene as it stands.
    this.three.environment = this.skyTexture();
    this.three.environmentIntensity = 1.1;
    this.three.background = this.skyTexture();
    for (const l of this.areaLights) this.three.remove(l);
    this.areaLights = [];
    for (const child of this.content.children) {
      if (child.userData.type !== "light" || !(child instanceof THREE.Mesh)) continue;
      const geo = child.geometry as THREE.BoxGeometry;
      const p = geo.parameters;
      if (!p) continue;
      const area = new THREE.RectAreaLight(
        0xfff1d0,
        14,
        Math.max(p.width, 0.1),
        Math.max(p.depth, 0.1),
      );
      area.position.copy(child.position);
      area.position.y -= (p.height ?? 0) / 2 + 0.01;
      area.lookAt(area.position.x, 0, area.position.z);
      this.three.add(area);
      this.areaLights.push(area);
    }
    const tracer = this.tracer ?? new WebGLPathTracer(this.renderer);
    if (!this.tracer) {
      this.tracer = tracer;
      tracer.bounces = 4;
      tracer.tiles.set(2, 2);
      tracer.filterGlossyFactor = 0.5;
      tracer.dynamicLowRes = true;
      tracer.lowResScale = 0.3;
      tracer.renderDelay = 120;
      tracer.minSamples = 3;
      tracer.fadeDuration = 400;
      tracer.rasterizeScene = false;
      tracer.renderToCanvasCallback = (target, renderer, quad) =>
        this.presentDenoised(target, renderer, quad);
      // The BVH of the whole building is built off the main thread, so the page stays usable while it is prepared.
      tracer.setBVHWorker(new GenerateMeshBVHWorker());
    }
    // Path tracing cost grows with pixels: start at 0.6 of the screen (at most 700 px on the long side) and let the browser scale it up; the loop below shrinks it further on a slow GPU.
    tracer.renderScale = Math.min(
      1,
      800 / Math.max(this.host.clientWidth, this.host.clientHeight, 1),
    );
    tracer.pausePathTracing = true;
    this.perspective.updateMatrixWorld();
    this.requestRender();
    void tracer
      .setSceneAsync(this.three, this.perspective)
      .then(() => {
        if (!this.realistic || generation !== this.tracerGeneration) return;
        this.tracerPreparing = false;
        tracer.pausePathTracing = false;
        this.startTracing();
      })
      .catch((error) => {
        if (generation !== this.tracerGeneration) return;
        console.warn("realistic rendering could not start", error);
        this.tracerPreparing = false;
        this.realistic = false;
        this.onReal?.({ state: "unsupported", samples: 0 });
        this.requestRender();
      });
  }

  private presentDenoised(
    target: THREE.WebGLRenderTarget,
    renderer: THREE.WebGLRenderer,
    quad: FullScreenQuad,
  ) {
    const { width, height } = target;
    if (
      !this.denoiseTarget ||
      this.denoiseTarget.width !== width ||
      this.denoiseTarget.height !== height
    ) {
      this.denoiseTarget?.dispose();
      this.denoiseTarget = new THREE.WebGLRenderTarget(width, height, {
        type: THREE.HalfFloatType,
        depthBuffer: false,
      });
    }
    const u = (this.denoise.material as THREE.ShaderMaterial).uniforms as Record<
      string,
      THREE.IUniform
    >;
    (u.tMap as THREE.IUniform).value = target.texture;
    ((u.texel as THREE.IUniform).value as THREE.Vector2).set(1 / width, 1 / height);
    (u.spp as THREE.IUniform).value = this.tracer?.samples ?? 1;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.denoiseTarget);
    this.denoise.render(renderer);
    renderer.setRenderTarget(previous);
    (quad.material as THREE.MeshBasicMaterial).map = this.denoiseTarget.texture;
    const clear = renderer.autoClear;
    renderer.autoClear = false;
    quad.render(renderer);
    renderer.autoClear = clear;
  }

  private startTracing() {
    if (this.tracerFrame || !this.tracer) return;
    let lastReport = 0;
    let windowStart = performance.now();
    let windowSamples = this.tracer.samples;
    const loop = () => {
      this.tracerFrame = 0;
      const tracer = this.tracer;
      if (!this.realistic || !tracer || this.mode === "plan") return;
      if (tracer.samples >= SAMPLE_CAP) {
        tracer.pausePathTracing = true;
        this.onReal?.({ state: "done", samples: Math.round(tracer.samples) });
        return;
      }
      tracer.renderSample();
      const now = performance.now();
      // A slow GPU gets a smaller image rather than a longer wait: if fewer than 3 samples a second arrive, shrink it.
      if (document.hidden) {
        windowStart = now;
        windowSamples = tracer.samples;
      } else if (now - windowStart > 2500) {
        const rate = ((tracer.samples - windowSamples) / (now - windowStart)) * 1000;
        if (tracer.samples > 1 && rate < 3 && tracer.renderScale > 0.4) {
          tracer.renderScale = Math.max(0.4, tracer.renderScale * 0.75);
          tracer.updateCamera();
        }
        windowStart = now;
        windowSamples = tracer.samples;
      }
      if (now - lastReport > 250) {
        lastReport = now;
        this.onReal?.({ state: "rendering", samples: Math.round(tracer.samples) });
      }
      this.tracerFrame = requestAnimationFrame(loop);
    };
    this.tracerFrame = requestAnimationFrame(loop);
  }

  private disposeContent() {
    for (const child of [...this.content.children]) {
      if (child instanceof THREE.Mesh) child.geometry.dispose();
      if (child instanceof THREE.Sprite) {
        child.material.map?.dispose();
        child.material.dispose();
      }
      this.content.remove(child);
    }
  }

  /**
   * Name each room on the floor plan, so a request like "move the kitchen east" can be checked by
   * eye. Labels show only in the plan view; they are part of the content and go with the scene.
   */
  setLabels(rooms: { name: string; x: number; y: number; w: number; h: number }[]) {
    for (const child of [...this.content.children])
      if (child.userData.type === "label") {
        this.content.remove(child);
        if (child instanceof THREE.Sprite) {
          child.material.map?.dispose();
          child.material.dispose();
        }
      }
    for (const room of rooms) {
      const width = Math.max(0.65, Math.min(3, room.w * 0.82));
      const height = Math.max(0.35, Math.min(0.6, room.h * 0.38));
      const name =
        width < 2
          ? room.name
              .replace(/^restroom\s*/i, "WC ")
              .replace(/^meeting room\s*/i, "Meet ")
              .replace(/^open workspace$/i, "Workspace")
          : room.name;
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 64;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.fillStyle = "rgba(10,15,13,0.78)";
      ctx.beginPath();
      ctx.roundRect(4, 8, 248, 48, 12);
      ctx.fill();
      ctx.fillStyle = "#f3f7f5";
      ctx.font = "600 26px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(name, 128, 33, 232);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: new THREE.CanvasTexture(canvas),
          depthTest: false,
          transparent: true,
        }),
      );
      sprite.scale.set(width, height, 1);
      sprite.position.set(room.x, 3, room.y);
      sprite.renderOrder = 10;
      sprite.userData = { type: "label" };
      this.content.add(sprite);
    }
    this.applyLabels();
    this.requestRender();
  }

  private applyLabels() {
    for (const child of this.content.children)
      if (child.userData.type === "label") child.visible = this.mode === "plan";
  }
}
