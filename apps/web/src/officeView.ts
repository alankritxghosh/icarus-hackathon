import type { Scene } from "@icarus/core";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type ViewMode = "orbit" | "plan";

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
  private readonly observer: ResizeObserver;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(this.renderer.domElement);
    this.three.background = new THREE.Color("#eceff2");
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
    for (const node of scene.nodes) {
      const geometry =
        node.geometry.kind === "box"
          ? new THREE.BoxGeometry(...node.geometry.size)
          : new THREE.CylinderGeometry(
              node.geometry.radius,
              node.geometry.radius,
              node.geometry.height,
              24,
            );
      const mesh = new THREE.Mesh(geometry, material(node.material));
      mesh.position.set(...node.position);
      mesh.rotation.y = node.rotationY;
      mesh.castShadow = node.type !== "floor" && node.type !== "window";
      mesh.receiveShadow = node.type !== "window";
      mesh.userData = { nodeId: node.id, type: node.type };
      this.content.add(mesh);
    }
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: "#dfe3e7", roughness: 1 }),
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

  setMode(mode: ViewMode) {
    this.mode = mode;
    this.orbit.enabled = mode === "orbit";
    this.plan.enabled = mode === "plan";
    this.applyCeiling();
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

  dispose() {
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
        child.visible = this.showCeiling && this.mode === "orbit";
  }

  private frameCameras() {
    const { w, h } = this.shell;
    const centre = new THREE.Vector3(w / 2, 0, h / 2);
    const reach = Math.max(w, h);
    this.perspective.position.set(w * 0.5, reach * 0.95, h + reach * 0.85);
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
    this.renderer.render(this.three, this.mode === "orbit" ? this.perspective : this.ortho);
  }

  private disposeContent() {
    for (const child of [...this.content.children]) {
      if (child instanceof THREE.Mesh) child.geometry.dispose();
      this.content.remove(child);
    }
  }
}
