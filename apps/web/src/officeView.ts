import type { Scene, Viewpoint } from "@icarus/core";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { surface } from "./textures";

export type ViewMode = "orbit" | "plan" | "eye";

const SKY = new THREE.Color("#cfdfe8");
// A warm paper ground and backdrop, so the building reads as a model on a table rather than a field.
const PAPER = new THREE.Color("#efeae1");

/**
 * Renders a core Scene with three.js. Rendering is on demand: it draws when the camera moves,
 * the window resizes or the scene changes, so an idle office costs nothing.
 */
export class OfficeView {
  onWalkLevelChange?: (levelId: string) => void;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly softwareWebgl: boolean;
  private readonly three = new THREE.Scene();
  private readonly perspective = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
  private readonly ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
  private readonly orbit: OrbitControls;
  private readonly plan: OrbitControls;
  private readonly sun = new THREE.DirectionalLight(0xffe4c4, 2.4);
  /** Warm light under the ceiling above the visitor, standing in for the room's lights where they walk. */
  private readonly roomLight = new THREE.PointLight(0xffd9a8, 4.5, 7, 1.6);
  private readonly content = new THREE.Group();
  /** Fades the ground into the paper backdrop in the 3D view, so there is no horizon line. */
  private readonly haze = new THREE.Fog(PAPER, 60, 160);
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
  private walkDistance = 7.5;
  private walkCameraDistance = 7.5;
  private walkCameraShoulder = 0;
  private cameraRecovering = false;
  private drag?: { x: number; y: number };
  private readonly keys = (e: KeyboardEvent) => this.onKey(e);
  private readonly keyUp = (e: KeyboardEvent) => this.walkKeys.delete(e.key.toLowerCase());
  private readonly clearWalkKeys = () => this.walkKeys.clear();
  private readonly walkKeys = new Set<string>();
  private walkFrame = 0;
  private walkTime = 0;
  private walkDrawAt = 0;
  private walkTicks = 0;
  private readonly walkFrameIntervals: number[] = [];
  private readonly walkRenderTimes: number[] = [];
  private walkLevelId?: string;
  private walkBaseY = 0;
  private readonly playerAt = new THREE.Vector3();
  private readonly avatar = this.makeAvatar();
  private walkWalls: {
    mesh: THREE.Mesh;
    x: number;
    z: number;
    halfW: number;
    halfD: number;
    minY: number;
    maxY: number;
    cos: number;
    sin: number;
  }[] = [];
  private walkFurniture: {
    id: string;
    x: number;
    z: number;
    halfW: number;
    halfD: number;
    minY: number;
    maxY: number;
    cos: number;
    sin: number;
  }[] = [];
  private walkFloors: {
    id: string;
    name: string;
    x: number;
    z: number;
    halfW: number;
    halfD: number;
    top: number;
    cos: number;
    sin: number;
  }[] = [];
  private readonly cameraGhosts = new Map<
    THREE.Mesh,
    { normal: THREE.Material; faded: THREE.Material }
  >();
  private readonly cameraAssetBounds: {
    object: THREE.Object3D;
    bounds: THREE.Box3;
    cutawayKey?: string;
  }[] = [];
  private readonly cameraHiddenAssets = new Set<THREE.Object3D>();
  private readonly pbrSets = new Map<
    string,
    { map: THREE.Texture; normal: THREE.Texture; arm: THREE.Texture }
  >();
  private pending = 0;
  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(this.renderer.domElement);
    const gl = this.renderer.getContext();
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    const rendererName = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : "";
    this.softwareWebgl = /SwiftShader/i.test(rendererName);
    if (import.meta.env.DEV) this.renderer.domElement.dataset.webglRenderer = rendererName;
    this.three.background = PAPER;
    this.three.fog = this.haze;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.rasterEnvironment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.three.environment = this.rasterEnvironment;
    this.three.environmentIntensity = 0.4;
    pmrem.dispose();
    this.three.add(this.content);
    this.avatar.visible = false;
    this.three.add(this.avatar);
    this.three.add(new THREE.HemisphereLight(0xfff6ea, 0xcfc2ad, 0.8));
    this.three.add(this.sun, this.sun.target);
    this.roomLight.visible = false;
    this.three.add(this.roomLight);
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
    el.tabIndex = 0;
    el.setAttribute("aria-label", "Walk through the model with WASD or arrow keys");
    el.addEventListener("pointerdown", (e) => {
      if (this.mode !== "eye") return;
      el.focus({ preventScroll: true });
      this.drag = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (this.mode !== "eye" || !this.drag) return;
      this.look.yaw += (e.clientX - this.drag.x) * 0.004;
      this.look.pitch = Math.max(
        -0.7,
        Math.min(0.8, this.look.pitch + (e.clientY - this.drag.y) * 0.004),
      );
      this.drag = { x: e.clientX, y: e.clientY };
      this.updateWalkCamera();
    });
    const release = () => {
      this.drag = undefined;
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener(
      "wheel",
      (e) => {
        if (this.mode !== "eye") return;
        e.preventDefault();
        this.walkDistance = Math.max(4.5, Math.min(12, this.walkDistance + e.deltaY * 0.008));
        this.updateWalkCamera();
      },
      { passive: false },
    );
    window.addEventListener("keydown", this.keys);
    window.addEventListener("keyup", this.keyUp);
    window.addEventListener("blur", this.clearWalkKeys);

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
    }
  }

  setScene(scene: Scene) {
    this.resetCameraGhosts();
    this.disposeContent();
    this.walkWalls = [];
    this.walkFurniture = [];
    this.walkFloors = [];
    this.cameraAssetBounds.length = 0;
    this.shell = scene.shell;
    this.showCeiling = false;
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
      if (def?.pbr && node.geometry.kind === "box" && !this.softwareWebgl) {
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
      if (node.type === "wall" && node.geometry.kind === "box")
        this.walkWalls.push({
          mesh,
          x: node.position[0],
          z: node.position[2],
          halfW: node.geometry.size[0] / 2,
          halfD: node.geometry.size[2] / 2,
          minY: node.position[1] - node.geometry.size[1] / 2,
          maxY: node.position[1] + node.geometry.size[1] / 2,
          cos: Math.cos(node.rotationY),
          sin: Math.sin(node.rotationY),
        });
      if (
        node.type === "furniture" &&
        node.geometry.kind === "box" &&
        node.geometry.size[1] >= 0.25
      )
        this.walkFurniture.push({
          id: node.id,
          x: node.position[0],
          z: node.position[2],
          halfW: node.geometry.size[0] / 2,
          halfD: node.geometry.size[2] / 2,
          minY: node.position[1] - node.geometry.size[1] / 2,
          maxY: node.position[1] + node.geometry.size[1] / 2,
          cos: Math.cos(node.rotationY),
          sin: Math.sin(node.rotationY),
        });
      if (node.type === "floor" && node.geometry.kind === "box")
        this.walkFloors.push({
          id: node.id,
          name: node.name,
          x: node.position[0],
          z: node.position[2],
          halfW: node.geometry.size[0] / 2,
          halfD: node.geometry.size[2] / 2,
          top: node.position[1] + node.geometry.size[1] / 2,
          cos: Math.cos(node.rotationY),
          sin: Math.sin(node.rotationY),
        });
    }
    const groundMaterial = new THREE.MeshStandardMaterial({ color: "#e6dfd2", roughness: 1 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.06;
    ground.receiveShadow = true;
    ground.userData.noExport = true;
    this.content.add(ground);

    const { w, h } = scene.shell;
    // A low afternoon sun from the left of the opening view, so the walls facing the camera differ in light and the
    // shadows fall towards it instead of hiding behind the building.
    const reach = Math.max(w, h);
    this.sun.position.set(w / 2 - reach * 0.8, reach * 0.8 + 6, h / 2 + reach * 0.8);
    this.sun.target.position.set(w / 2, 0, h / 2);
    const span = Math.max(w, h) * 0.9;
    Object.assign(this.sun.shadow.camera, {
      left: -span,
      right: span,
      top: span,
      bottom: -span,
      near: 1,
      far: reach * 3 + 30,
    });
    this.haze.near = reach * 2.5;
    this.haze.far = reach * 7;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.applyCeiling();
    this.frameCameras();
    if (this.mode === "eye") this.updateWalkCamera();
    this.requestRender();
  }

  /** Loads a modelled object once, then places a clone: centred on its footprint, resting on its base. */
  private addAsset(node: Scene["nodes"][number], generation: number) {
    if (node.geometry.kind !== "asset") return;
    const { id, size, scale } = node.geometry;
    if (node.type === "furniture" && size[1] >= 0.25)
      this.walkFurniture.push({
        id: node.id,
        x: node.position[0],
        z: node.position[2],
        halfW: size[0] / 2,
        halfD: size[2] / 2,
        minY: node.position[1],
        maxY: node.position[1] + size[1],
        cos: Math.cos(node.rotationY),
        sin: Math.sin(node.rotationY),
      });
    if (this.softwareWebgl) {
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(...size),
        new THREE.MeshStandardMaterial({ color: "#b49b7c", roughness: 1 }),
      );
      block.position.set(node.position[0], node.position[1] + size[1] / 2, node.position[2]);
      block.rotation.y = node.rotationY;
      block.userData = { nodeId: node.id, type: node.type, assetNode: node };
      block.receiveShadow = true;
      this.content.add(block);
      block.updateMatrixWorld(true);
      this.cameraAssetBounds.push({
        object: block,
        bounds: new THREE.Box3().setFromObject(block),
        cutawayKey: node.roomId ? `${node.roomId}:${id}` : undefined,
      });
      return;
    }
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
        group.updateMatrixWorld(true);
        this.cameraAssetBounds.push({
          object: group,
          bounds: new THREE.Box3().setFromObject(group),
          cutawayKey: node.roomId ? `${node.roomId}:${id}` : undefined,
        });
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
    if (wasEye && mode !== "eye") {
      cancelAnimationFrame(this.walkFrame);
      this.walkFrame = 0;
      this.walkKeys.clear();
      this.avatar.visible = false;
      this.roomLight.visible = false;
      this.clearCameraGhosts();
      this.leaveEye();
    }
    this.mode = mode;
    this.renderer.setPixelRatio(
      this.softwareWebgl && mode === "eye" ? 0.5 : Math.min(window.devicePixelRatio, 2),
    );
    this.sun.castShadow = !(this.softwareWebgl && mode === "eye");
    this.resize();
    this.orbit.enabled = mode === "orbit";
    this.plan.enabled = mode === "plan";
    if (mode === "eye") this.avatar.visible = true;
    this.roomLight.visible = mode === "eye";
    this.three.background = mode === "eye" ? SKY : PAPER;
    this.three.fog = mode === "orbit" ? this.haze : null;
    this.applyCeiling();
    this.applyLabels();
    this.requestRender();
  }

  /** Stand at a viewpoint: camera at eye height looking at its target. */
  setViewpoint(view: Viewpoint) {
    const [x, y, z] = view.position;
    const prefix = view.id.split(".")[0];
    this.walkLevelId =
      prefix &&
      this.content.children.some((child) =>
        String(child.userData.nodeId ?? "").startsWith(`${prefix}.`),
      )
        ? prefix
        : undefined;
    this.walkBaseY = y - 1.6;
    this.walkDrawAt = 0;
    this.walkTicks = 0;
    this.walkFrameIntervals.length = 0;
    this.walkRenderTimes.length = 0;
    this.walkCameraDistance = this.walkDistance;
    this.walkCameraShoulder = 0;
    this.cameraRecovering = false;
    this.playerAt.set(x, this.walkBaseY, z);
    this.perspective.fov = view.fovDeg;
    this.perspective.updateProjectionMatrix();
    const dx = view.target[0] - x;
    const dz = view.target[2] - z;
    this.look = { yaw: Math.atan2(-dx, -dz), pitch: 0.2 };
    this.setMode("eye");
    this.renderer.domElement.focus({ preventScroll: true });
    this.avatar.position.copy(this.playerAt);
    this.avatar.rotation.y = this.look.yaw;
    this.updateWalkCamera();
    if (!this.walkFrame) {
      this.walkTime = 0;
      this.walkFrame = requestAnimationFrame(this.walkTick);
    }
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

  /** Walk with arrow keys or WASD; key state is also driven by the touch controls. */
  private onKey(e: KeyboardEvent) {
    if (this.mode !== "eye") return;
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (
      ["w", "a", "s", "d", "arrowup", "arrowleft", "arrowdown", "arrowright"].includes(
        e.key.toLowerCase(),
      )
    ) {
      e.preventDefault();
      if (!this.walkKeys.size) this.walkDrawAt = 0;
      this.walkKeys.add(e.key.toLowerCase());
    }
  }

  setWalkInput(direction: "w" | "a" | "s" | "d", pressed: boolean) {
    if (pressed) {
      if (!this.walkKeys.size) this.walkDrawAt = 0;
      this.walkKeys.add(direction);
    } else this.walkKeys.delete(direction);
  }

  private makeAvatar(): THREE.Group {
    const avatar = new THREE.Group();
    const jacket = new THREE.MeshStandardMaterial({ color: "#51e4a4", roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: "#b97d55", roughness: 0.9 });
    const trousers = new THREE.MeshStandardMaterial({ color: "#26382f", roughness: 0.9 });
    const face = new THREE.MeshStandardMaterial({ color: "#1a2420", roughness: 0.8 });
    const part = (
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      x: number,
      y: number,
      z: number,
    ) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      avatar.add(mesh);
    };
    part(new THREE.CapsuleGeometry(0.29, 0.58, 4, 8), jacket, 0, 1.08, 0);
    part(new THREE.SphereGeometry(0.22, 12, 10), skin, 0, 1.66, 0);
    part(new THREE.BoxGeometry(0.23, 0.08, 0.04), face, 0, 1.67, -0.205);
    for (const side of [-1, 1]) {
      part(new THREE.CylinderGeometry(0.09, 0.11, 0.62, 8), trousers, side * 0.13, 0.34, 0);
      part(new THREE.CylinderGeometry(0.075, 0.075, 0.55, 8), jacket, side * 0.36, 1.03, 0);
    }
    return avatar;
  }

  private readonly walkTick = (now: number) => {
    if (this.mode !== "eye") return;
    const dt = this.walkTime ? Math.min(0.5, (now - this.walkTime) / 1000) : 0;
    this.walkTime = now;
    const down = (a: string, b: string) => Number(this.walkKeys.has(a) || this.walkKeys.has(b));
    const forward = down("w", "arrowup") - down("s", "arrowdown");
    const strafe = down("d", "arrowright") - down("a", "arrowleft");
    if (forward || strafe) {
      if (import.meta.env.DEV) {
        this.walkTicks++;
        this.renderer.domElement.dataset.walkTicks = String(this.walkTicks);
        this.renderer.domElement.dataset.walkStop = "";
      }
      const length = Math.hypot(forward, strafe);
      const step = (2.4 * dt) / length;
      const dx = (-Math.sin(this.look.yaw) * forward + Math.cos(this.look.yaw) * strafe) * step;
      const dz = (-Math.cos(this.look.yaw) * forward - Math.sin(this.look.yaw) * strafe) * step;
      const segments = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.2));
      for (let i = 0; i < segments; i++) {
        const x = Math.max(-2, Math.min(this.shell.w + 2, this.playerAt.x + dx / segments));
        const z = Math.max(-2, Math.min(this.shell.h + 2, this.playerAt.z + dz / segments));
        this.tryWalkStep(x, this.playerAt.z);
        this.tryWalkStep(this.playerAt.x, z);
      }
      this.avatar.rotation.y = Math.atan2(-dx, -dz);
    }
    if (forward || strafe || this.cameraRecovering) this.updateWalkCamera();
    this.walkFrame = requestAnimationFrame(this.walkTick);
  };

  private tryWalkStep(x: number, z: number) {
    const floor = this.walkFloorAt(x, z);
    if (!floor) {
      if (import.meta.env.DEV) this.renderer.domElement.dataset.walkStop = "no floor";
      return;
    }
    const wall = this.walkBlocked(x, z, floor.top);
    if (wall) {
      if (import.meta.env.DEV) this.renderer.domElement.dataset.walkStop = wall;
      return;
    }
    this.playerAt.set(x, floor.top, z);
    this.walkBaseY = floor.top;
    const level = floor.id.split(".")[0];
    if (
      level &&
      level !== "stair" &&
      level !== this.walkLevelId &&
      this.content.children.some((child) =>
        String(child.userData.nodeId ?? "").startsWith(`${level}.`),
      )
    ) {
      this.walkLevelId = level;
      this.applyCeiling();
      this.onWalkLevelChange?.(level);
    }
  }

  private walkFloorAt(x: number, z: number) {
    return this.walkFloors
      .filter((floor) => {
        if (floor.top > this.playerAt.y + 0.22 || floor.top < this.playerAt.y - 0.3) return false;
        const dx = x - floor.x;
        const dz = z - floor.z;
        const lx = floor.cos * dx - floor.sin * dz;
        const lz = floor.sin * dx + floor.cos * dz;
        return Math.abs(lx) <= floor.halfW + 0.1 && Math.abs(lz) <= floor.halfD + 0.1;
      })
      .sort((a, b) => b.top - a.top)[0];
  }

  private walkBlocked(x: number, z: number, baseY = this.playerAt.y): string | undefined {
    const wall = this.walkWalls.find(
      (part) =>
        part.maxY >= baseY + 0.25 && part.minY <= baseY + 1.65 && this.insideWall(part, x, z, 0.2),
    );
    if (wall)
      return `${String(wall.mesh.userData.nodeId ?? "wall")} x=${wall.x.toFixed(3)} half=${wall.halfW.toFixed(3)} candidate=${x.toFixed(3)}`;
    const furniture = this.walkFurniture.find(
      (part) =>
        part.maxY >= baseY + 0.25 && part.minY <= baseY + 1.65 && this.insideWall(part, x, z, 0.2),
    );
    return furniture ? `furniture ${furniture.id}` : undefined;
  }

  private insideWall(
    wall: Pick<(typeof this.walkFurniture)[number], "x" | "z" | "halfW" | "halfD" | "cos" | "sin">,
    x: number,
    z: number,
    padding = 0,
  ) {
    const dx = x - wall.x;
    const dz = z - wall.z;
    const lx = wall.cos * dx - wall.sin * dz;
    const lz = wall.sin * dx + wall.cos * dz;
    return Math.abs(lx) <= wall.halfW + padding && Math.abs(lz) <= wall.halfD + padding;
  }

  private updateWalkCamera() {
    if (this.mode !== "eye") return;
    this.avatar.position.copy(this.playerAt);
    this.roomLight.position.set(this.playerAt.x, this.playerAt.y + 2.5, this.playerAt.z);
    if (import.meta.env.DEV)
      this.renderer.domElement.dataset.walkPose = [
        this.playerAt.x.toFixed(2),
        this.playerAt.y.toFixed(2),
        this.playerAt.z.toFixed(2),
        this.look.yaw.toFixed(3),
      ].join(",");
    const target = this.playerAt.clone().add(new THREE.Vector3(0, 1.2, 0));
    const rise = this.walkDistance * 0.3 + this.look.pitch * 1.2 - 1.2;
    // In a shallow toilet, glance toward the side with more room so the
    // fixtures remain visible; movement still follows the person's look yaw.
    const smallToilet = this.walkFloors.find(
      (floor) =>
        /^toilet\b/i.test(floor.name) &&
        Math.min(floor.halfW, floor.halfD) < 1.2 &&
        Math.abs(floor.top - this.playerAt.y) < 0.1 &&
        this.insideWall(floor, this.playerAt.x, this.playerAt.z),
    );
    const rightX = Math.cos(this.look.yaw);
    const rightZ = -Math.sin(this.look.yaw);
    const sideRoom = smallToilet
      ? (smallToilet.x - this.playerAt.x) * rightX + (smallToilet.z - this.playerAt.z) * rightZ
      : 0;
    const shoulderTarget = Math.abs(sideRoom) > 0.25 ? Math.sign(sideRoom) * 0.6 : 0;
    this.walkCameraShoulder += (shoulderTarget - this.walkCameraShoulder) * 0.2;
    const cameraYaw = this.look.yaw + this.walkCameraShoulder;
    const boom = new THREE.Vector3(
      Math.sin(cameraYaw),
      rise / this.walkDistance,
      Math.cos(cameraYaw),
    ).normalize();
    const wanted = Math.hypot(this.walkDistance, rise);
    const obstacles = this.content.children.filter(
      (child) =>
        child.visible && (child.userData.type === "wall" || child.userData.type === "ceiling"),
    );
    const hit = new THREE.Raycaster(target, boom, 0.2, wanted).intersectObjects(
      obstacles,
      false,
    )[0];
    let clear = hit ? Math.max(2.8, hit.distance - 0.25) : wanted;
    clear = Math.min(clear, wanted);
    // In a tight room the useful camera position may be beyond a thin blocking wall.
    // That wall is faded below; keep the camera point outside the wall solid.
    while (
      clear < wanted &&
      this.walkWalls.some((wall) => {
        const point = target.clone().addScaledVector(boom, clear);
        return (
          wall.mesh.visible &&
          point.y >= wall.minY &&
          point.y <= wall.maxY &&
          this.insideWall(wall, point.x, point.z)
        );
      })
    ) {
      clear = Math.min(wanted, clear + 0.2);
    }
    if (
      hit &&
      this.walkWalls.some((wall) => {
        const point = target.clone().addScaledVector(boom, clear);
        return (
          wall.mesh.visible &&
          point.y >= wall.minY &&
          point.y <= wall.maxY &&
          this.insideWall(wall, point.x, point.z)
        );
      })
    )
      clear = Math.max(1.2, hit.distance - 0.25);
    this.walkCameraDistance =
      clear < this.walkCameraDistance
        ? clear
        : this.walkCameraDistance + (clear - this.walkCameraDistance) * 0.2;
    const insideCameraWall = (distance: number) => {
      const point = target.clone().addScaledVector(boom, distance);
      return this.walkWalls.some(
        (wall) =>
          wall.mesh.visible &&
          point.y >= wall.minY &&
          point.y <= wall.maxY &&
          this.insideWall(wall, point.x, point.z),
      );
    };
    // Easing can put the camera inside a wall even when the target position is clear.
    if (insideCameraWall(this.walkCameraDistance)) {
      const eased = this.walkCameraDistance;
      for (let offset = 0.05; offset <= wanted; offset += 0.05) {
        const inward = eased - offset;
        const outward = eased + offset;
        if (inward >= 0.3 && !insideCameraWall(inward)) {
          this.walkCameraDistance = inward;
          break;
        }
        if (outward <= wanted && !insideCameraWall(outward)) {
          this.walkCameraDistance = outward;
          break;
        }
      }
    }
    this.cameraRecovering =
      clear - this.walkCameraDistance > 0.01 ||
      Math.abs(shoulderTarget - this.walkCameraShoulder) > 0.01;
    const desired = target.clone().addScaledVector(boom, this.walkCameraDistance);
    if (import.meta.env.DEV)
      this.renderer.domElement.dataset.walkCameraInside = String(
        insideCameraWall(this.walkCameraDistance),
      );
    if (import.meta.env.DEV)
      this.renderer.domElement.dataset.walkCameraShoulder = this.walkCameraShoulder.toFixed(3);
    this.perspective.position.copy(desired);
    this.perspective.lookAt(target);
    this.fadeCameraWalls();
    this.cameraMoved();
  }

  private clearCameraGhosts() {
    for (const [mesh, pair] of this.cameraGhosts) mesh.material = pair.normal;
    for (const object of this.cameraHiddenAssets) object.visible = true;
    this.cameraHiddenAssets.clear();
  }

  private resetCameraGhosts() {
    this.clearCameraGhosts();
    for (const pair of this.cameraGhosts.values()) pair.faded.dispose();
    this.cameraGhosts.clear();
  }

  private fadeCameraWalls() {
    this.clearCameraGhosts();
    const target = this.playerAt.clone().add(new THREE.Vector3(0, 1.2, 0));
    const direction = this.perspective.position.clone().sub(target);
    const length = direction.length();
    const caster = new THREE.Raycaster(target, direction.normalize(), 0.2, length);
    const torso = this.playerAt.clone().add(new THREE.Vector3(0, 0.65, 0));
    const torsoToCamera = this.perspective.position.clone().sub(torso);
    const torsoRay = new THREE.Ray(torso, torsoToCamera.clone().normalize());
    const cutawayAssets = new Set<string>();
    for (const asset of this.cameraAssetBounds) {
      if (!asset.object.visible) continue;
      const headHit = caster.ray.intersectBox(asset.bounds, new THREE.Vector3());
      const torsoHit = torsoRay.intersectBox(asset.bounds, new THREE.Vector3());
      if (
        asset.bounds.distanceToPoint(this.perspective.position) < 0.35 ||
        (headHit && headHit.distanceTo(target) < length - 0.15) ||
        (torsoHit && torsoHit.distanceTo(torso) < torsoToCamera.length() - 0.15)
      ) {
        if (asset.cutawayKey) cutawayAssets.add(asset.cutawayKey);
        else {
          asset.object.visible = false;
          this.cameraHiddenAssets.add(asset.object);
        }
      }
    }
    for (const asset of this.cameraAssetBounds)
      if (asset.cutawayKey && cutawayAssets.has(asset.cutawayKey) && asset.object.visible) {
        asset.object.visible = false;
        this.cameraHiddenAssets.add(asset.object);
      }
    if (import.meta.env.DEV)
      this.renderer.domElement.dataset.walkHiddenAssets = [...this.cameraHiddenAssets]
        .map((asset) => String(asset.userData.nodeId ?? ""))
        .join(",");
    const walls = this.content.children.filter(
      (child) => child.visible && child.userData.type === "wall",
    );
    const lowerBody = this.playerAt.clone().add(new THREE.Vector3(0, 0.1, 0));
    const lowerToCamera = this.perspective.position.clone().sub(lowerBody);
    const lowerLength = lowerToCamera.length();
    const furniture = this.content.children.filter(
      (child) =>
        child.visible && child.userData.type === "furniture" && child instanceof THREE.Mesh,
    );
    const furnitureHits = new THREE.Raycaster(
      lowerBody,
      lowerToCamera.normalize(),
      0.2,
      lowerLength,
    ).intersectObjects(furniture, false);
    // Across the whole frame, any wall, door or frame nearer the camera than the visitor stands
    // between them and the room (the wall pieces beside a doorway, the door leaf), so it fades too.
    const screens = this.content.children.filter(
      (child) =>
        child.visible &&
        (child.userData.type === "wall" ||
          child.userData.type === "door" ||
          child.userData.type === "frame"),
    );
    // The camera was just moved; its world matrix is otherwise only updated at render.
    this.perspective.updateMatrixWorld();
    const grid = new THREE.Raycaster();
    grid.far = this.perspective.position.distanceTo(target) - 0.3;
    const frameHits: THREE.Intersection[] = [];
    for (let i = 0; i < 9; i++)
      for (let j = 0; j < 5; j++) {
        grid.setFromCamera(new THREE.Vector2(i / 4 - 1, j / 2 - 1), this.perspective);
        frameHits.push(...grid.intersectObjects(screens, true));
      }
    const hits = [...caster.intersectObjects(walls, false), ...furnitureHits, ...frameHits];
    const faded = new Set<THREE.Mesh>();
    for (const hit of hits) {
      const mesh = hit.object;
      if (!(mesh instanceof THREE.Mesh) || faded.has(mesh)) continue;
      let pair = this.cameraGhosts.get(mesh);
      if (!pair) {
        const normal = mesh.material as THREE.Material;
        const ghost = normal.clone();
        ghost.transparent = true;
        ghost.opacity = mesh.userData.type === "furniture" ? 0.12 : 0.05;
        ghost.depthWrite = false;
        pair = { normal, faded: ghost };
        this.cameraGhosts.set(mesh, pair);
      }
      mesh.material = pair.faded;
      faded.add(mesh);
    }
    if (import.meta.env.DEV)
      this.renderer.domElement.dataset.walkFadedFurniture = [...faded]
        .filter((mesh) => mesh.userData.type === "furniture")
        .map((mesh) => String(mesh.userData.nodeId ?? ""))
        .join(",");
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
  /**
   * The model as a GLB. For Blender every part is included; with `shownOnly`, for a render of this view, only what is
   * on screen: no hidden roof or upper floor, and no wall the walk camera has faded to see past.
   */
  async exportGlb(plainMaterials = false, shownOnly = false): Promise<ArrayBuffer> {
    const out = new THREE.Group();
    const flat = new Map<string, THREE.MeshStandardMaterial>();
    const material = (source: THREE.Material) => {
      let made = flat.get(source.uuid);
      if (!made) {
        const original = source as THREE.MeshStandardMaterial;
        made = new THREE.MeshStandardMaterial({
          color: original.color ?? new THREE.Color("#cccccc"),
          roughness: original.roughness ?? 1,
          metalness: original.metalness ?? 0,
          opacity: original.opacity,
          transparent: original.transparent,
          side: original.side,
        });
        flat.set(source.uuid, made);
      }
      return made;
    };
    for (const child of this.content.children) {
      if (child.userData.noExport || child instanceof THREE.Sprite) continue;
      if (shownOnly) {
        if (!child.visible) continue;
        const ghost = child instanceof THREE.Mesh ? this.cameraGhosts.get(child) : undefined;
        if (ghost && child instanceof THREE.Mesh && child.material === ghost.faded) continue;
      }
      let copy: THREE.Object3D = child.clone(true);
      const assetNode = child.userData.assetNode as Scene["nodes"][number] | undefined;
      if (assetNode?.geometry.kind === "asset") {
        const { id, scale } = assetNode.geometry;
        let model = this.models.get(id);
        if (!model) {
          model = this.loader
            .loadAsync(`/assets/models/${id}/${id}.gltf`)
            .then((gltf) => gltf.scene);
          this.models.set(id, model);
        }
        const source = (await model).clone(true);
        if (scale) source.scale.set(...scale);
        const box = new THREE.Box3().setFromObject(source);
        const centre = box.getCenter(new THREE.Vector3());
        source.position.set(-centre.x, -box.min.y, -centre.z);
        const full = new THREE.Group();
        full.position.set(...assetNode.position);
        full.rotation.y = assetNode.rotationY;
        full.userData = { nodeId: assetNode.id, type: assetNode.type };
        full.add(source);
        copy = full;
      }
      copy.visible = true;
      const normal = child instanceof THREE.Mesh ? this.cameraGhosts.get(child)?.normal : undefined;
      if (normal && copy instanceof THREE.Mesh) copy.material = normal;
      if (plainMaterials)
        copy.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.material = Array.isArray(object.material)
            ? object.material.map(material)
            : material(object.material);
        });
      out.add(copy);
    }
    const result = await new GLTFExporter().parseAsync(out, {
      binary: true,
      onlyVisible: true,
      maxTextureSize: 512,
    });
    if (!(result instanceof ArrayBuffer)) throw new Error("The 3D file could not be made.");
    return result;
  }

  /** The camera as it stands and the sun's direction, so a GPU render can draw exactly this view. */
  renderView() {
    this.perspective.updateMatrixWorld();
    const ahead = this.perspective.getWorldDirection(new THREE.Vector3()).multiplyScalar(10);
    return {
      position: this.perspective.position.toArray() as [number, number, number],
      target: this.perspective.position.clone().add(ahead).toArray() as [number, number, number],
      fov: this.perspective.fov,
      sun: this.sun.position.clone().sub(this.sun.target.position).toArray() as [
        number,
        number,
        number,
      ],
    };
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
    this.resetCameraGhosts();
    window.removeEventListener("keydown", this.keys);
    window.removeEventListener("keyup", this.keyUp);
    window.removeEventListener("blur", this.clearWalkKeys);
    cancelAnimationFrame(this.walkFrame);
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.orbit.dispose();
    this.plan.dispose();
    this.disposeContent();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private applyCeiling() {
    for (const child of this.content.children) {
      const id = String(child.userData.nodeId ?? "");
      if (
        this.mode === "eye" &&
        this.walkLevelId &&
        id &&
        !id.startsWith("stair.") &&
        !id.startsWith(`${this.walkLevelId}.`) &&
        child.position.y > this.walkBaseY + 0.2
      ) {
        child.visible = false;
      } else if (child.userData.type === "ceiling") {
        // The complete roof is visible from outside. In third person it becomes a cutaway so the
        // player and lower rooms stay visible while the building still owns those roof meshes.
        child.visible = this.mode === "orbit" && this.showCeiling;
      } else if (id) child.visible = true;
    }
  }

  /** Put the 3D camera back on the opening view, fitted to the viewer's current shape. */
  reframe() {
    this.frameCameras();
  }

  private frameCameras() {
    const { w, h } = this.shell;
    const centre = new THREE.Vector3(w / 2, 0, h / 2);
    const reach = Math.max(w, h);
    // A three-quarter view from a corner, low enough to see into the rooms. It was framed for a wide viewer; a
    // narrower one needs the camera further back, or the building runs off its sides.
    const aspect = Math.max(0.3, this.host.clientWidth / Math.max(1, this.host.clientHeight));
    const back = Math.max(1, 1.7 / aspect);
    this.perspective.fov = 38;
    this.perspective.position.set(
      w / 2 + reach * 0.95 * back,
      reach * 0.9 * back,
      h / 2 + reach * 1.2 * back,
    );
    this.orbit.target.set(centre.x, 1, centre.z);
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
    const started = performance.now();
    this.renderer.render(this.three, this.mode === "plan" ? this.ortho : this.perspective);
    if (import.meta.env.DEV && this.mode === "eye" && this.walkKeys.size) {
      const elapsed = performance.now() - started;
      if (this.walkDrawAt) {
        this.walkFrameIntervals.push(started - this.walkDrawAt);
        this.walkRenderTimes.push(elapsed);
      }
      this.walkDrawAt = started;
      if (this.walkFrameIntervals.length > 120) {
        this.walkFrameIntervals.shift();
        this.walkRenderTimes.shift();
      }
      if (
        this.walkFrameIntervals.length > 0 &&
        (this.walkFrameIntervals.length <= 10 || this.walkFrameIntervals.length % 10 === 0)
      ) {
        const percentile = (values: number[]) =>
          [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)] ?? 0;
        this.renderer.domElement.dataset.walkPerf = JSON.stringify({
          frames: this.walkFrameIntervals.length,
          frameP95Ms: Math.round(percentile(this.walkFrameIntervals) * 10) / 10,
          renderCpuP95Ms: Math.round(percentile(this.walkRenderTimes) * 10) / 10,
          calls: this.renderer.info.render.calls,
          triangles: this.renderer.info.render.triangles,
        });
      }
    }
  }

  private cameraMoved() {
    this.requestRender();
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
