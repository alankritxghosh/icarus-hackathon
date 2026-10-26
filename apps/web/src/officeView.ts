import type { Scene, Viewpoint } from "@icarus/core";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { surface } from "./textures";

export type ViewMode = "orbit" | "plan" | "eye";

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

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(this.renderer.domElement);
    this.three.background = DARK;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.three.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
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
    this.orbit.addEventListener("change", () => this.requestRender());
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
      if (def?.texture && node.geometry.kind === "box") {
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
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: "#121a16", roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.06;
    ground.receiveShadow = true;
    this.content.add(ground);

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
    this.applyCeiling();
    this.frameCameras();
    this.requestRender();
  }

  /** Loads a modelled object once, then places a clone: centred on its footprint, resting on its base. */
  private addAsset(node: Scene["nodes"][number], generation: number) {
    if (node.geometry.kind !== "asset") return;
    const { id, size } = node.geometry;
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
    this.three.background = mode === "eye" ? SKY : DARK;
    this.applyCeiling();
    this.applyLabels();
    this.requestRender();
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
    this.requestRender();
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
    this.requestRender();
  }

  setCeiling(show: boolean) {
    this.showCeiling = show;
    this.applyCeiling();
    this.requestRender();
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
    this.perspective.position.set(w * 0.5, reach * 0.78, h + reach * 0.62);
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
    this.requestRender();
  }

  private requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw() {
    this.renderer.render(this.three, this.mode === "plan" ? this.ortho : this.perspective);
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
  setLabels(rooms: { name: string; x: number; y: number }[]) {
    for (const child of [...this.content.children])
      if (child.userData.type === "label") {
        this.content.remove(child);
        if (child instanceof THREE.Sprite) {
          child.material.map?.dispose();
          child.material.dispose();
        }
      }
    for (const room of rooms) {
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
      ctx.fillText(room.name, 128, 33, 232);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: new THREE.CanvasTexture(canvas),
          depthTest: false,
          transparent: true,
        }),
      );
      sprite.scale.set(4, 1, 1);
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
