// Builds the AppContext: renderer, live-view scene, views, frame loop, selection,
// picking and the shared gizmo. Features are installed on top of it (main.ts).

import {
  NeutralToneMapping,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Timer,
  Vector2,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import {
  LAYER_HELPERS,
  LAYER_SCENE,
  sameEntity,
  type AppContext,
  type EntityRef,
  type FrameLoop,
  type Gizmo,
  type GizmoOptions,
  type Picking,
  type RenderPipeline,
  type Selection,
  type ViewMode,
  type Views,
} from './context';
import type { SceneStore } from './store';
import { createSubjectRuntime } from './studio';
import type { Ui } from '../ui/shell';

export function createApp(store: SceneStore, ui: Ui): AppContext {
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = SRGBColorSpace;
  // Light intensities are pre-exposed (scene/photometry.ts), so exposure stays at 1.
  // Neutral tone mapping is linear below ~0.8, so a metered 18% grey stays at 0.18.
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  ui.viewport.prepend(renderer.domElement);

  const scene = new Scene();

  const views = createViews(renderer);
  const frame = createFrameLoop(renderer, scene, views, ui.viewport);
  const selection = createSelection();
  const gizmo = createGizmo(renderer, scene, views);
  const picking = createPicking(renderer, views, selection, gizmo);
  const subject = createSubjectRuntime(store, scene, picking);

  installUndoKeys(store, ui);
  installViewToggle(views, ui);

  return { store, renderer, scene, views, frame, subject, selection, picking, gizmo, ui };
}

// ---------------------------------------------------------------- views

function createViews(renderer: WebGLRenderer): Views & { orbit: OrbitControls } {
  const setCamera = new PerspectiveCamera(45, 1, 0.05, 200);
  setCamera.position.set(5, 3.2, 6);
  setCamera.layers.enable(LAYER_SCENE);
  setCamera.layers.enable(LAYER_HELPERS);

  const shotCamera = new PerspectiveCamera(24, 1.5, 0.05, 200);
  shotCamera.layers.set(LAYER_SCENE);

  const orbit = new OrbitControls(setCamera, renderer.domElement);
  orbit.target.set(0, 1, 0);
  orbit.enableDamping = true;
  orbit.update();

  let mode: ViewMode = 'set';
  const listeners = new Set<(mode: ViewMode) => void>();

  return {
    setCamera,
    shotCamera,
    orbit,
    get mode() {
      return mode;
    },
    get active() {
      return mode === 'set' ? setCamera : shotCamera;
    },
    setMode(next) {
      if (next === mode) return;
      mode = next;
      orbit.enabled = mode === 'set';
      listeners.forEach((l) => l(mode));
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function installViewToggle(views: Views, ui: Ui): void {
  const setButton = ui.addToolbarButton({
    id: 'view-set',
    label: 'Set view',
    title: 'Orbit around the studio (V)',
    onClick: () => views.setMode('set'),
  });
  const cameraButton = ui.addToolbarButton({
    id: 'view-camera',
    label: 'Camera view',
    title: 'Look through the camera (V)',
    onClick: () => views.setMode('camera'),
  });
  const sync = () => {
    setButton.classList.toggle('active', views.mode === 'set');
    cameraButton.classList.toggle('active', views.mode === 'camera');
  };
  views.onChange(sync);
  sync();
  window.addEventListener('keydown', (e) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'v' || e.key === 'V') views.setMode(views.mode === 'set' ? 'camera' : 'set');
  });
}

// ---------------------------------------------------------------- frame loop

function createFrameLoop(
  renderer: WebGLRenderer,
  scene: Scene,
  views: Views & { orbit: OrbitControls },
  viewport: HTMLElement,
): FrameLoop {
  const frameCallbacks = new Set<(dt: number) => void>();
  const resizeCallbacks = new Set<(w: number, h: number) => void>();
  let pipeline: RenderPipeline | null = null;
  const size = { width: 1, height: 1 };

  const resize = () => {
    size.width = Math.max(1, viewport.clientWidth);
    size.height = Math.max(1, viewport.clientHeight);
    renderer.setSize(size.width, size.height, false);
    views.setCamera.aspect = size.width / size.height;
    views.setCamera.updateProjectionMatrix();
    resizeCallbacks.forEach((c) => c(size.width, size.height));
  };
  new ResizeObserver(resize).observe(viewport);
  resize();

  const timer = new Timer();
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const dt = timer.getDelta();
    if (views.mode === 'set') views.orbit.update();
    frameCallbacks.forEach((c) => c(dt));
    const camera = views.active;
    if (pipeline) pipeline(renderer, scene, camera);
    else renderer.render(scene, camera);
  });

  return {
    size,
    onFrame(callback) {
      frameCallbacks.add(callback);
      return () => frameCallbacks.delete(callback);
    },
    setPipeline(p) {
      pipeline = p;
    },
    onResize(callback) {
      resizeCallbacks.add(callback);
      return () => resizeCallbacks.delete(callback);
    },
  };
}

// ---------------------------------------------------------------- selection

function createSelection(): Selection {
  let current: EntityRef | null = null;
  const listeners = new Set<(ref: EntityRef | null) => void>();
  return {
    get current() {
      return current;
    },
    set(ref) {
      if (sameEntity(ref, current)) return;
      current = ref;
      listeners.forEach((l) => l(ref));
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// ---------------------------------------------------------------- picking

function createPicking(renderer: WebGLRenderer, views: Views, selection: Selection, gizmo: Gizmo): Picking {
  const targets = new Map<Object3D, EntityRef>();
  const raycaster = new Raycaster();
  raycaster.layers.enableAll();
  const canvas = renderer.domElement;
  const down = new Vector2();
  let pointerDown = false;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    down.set(e.clientX, e.clientY);
    pointerDown = true;
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!pointerDown || e.button !== 0) return;
    pointerDown = false;
    // A drag (orbiting, gizmo) is not a click.
    if (down.distanceTo(new Vector2(e.clientX, e.clientY)) > 4 || gizmo.dragging) return;
    const rect = canvas.getBoundingClientRect();
    const ndc = new Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, views.active);
    const hits = raycaster.intersectObjects([...targets.keys()], true);
    for (const hit of hits) {
      // Walk up to the registered ancestor; the nearest registered one wins, so a bone
      // handle registered inside the subject selects the bone, not the subject.
      for (let o: Object3D | null = hit.object; o; o = o.parent) {
        const ref = targets.get(o);
        if (ref) {
          if (!o.visible) break;
          selection.set(ref);
          return;
        }
      }
    }
    selection.set(null);
  });

  return {
    register(object, ref) {
      targets.set(object, ref);
      return () => targets.delete(object);
    },
  };
}

// ---------------------------------------------------------------- gizmo

function createGizmo(renderer: WebGLRenderer, scene: Scene, views: Views & { orbit: OrbitControls }): Gizmo {
  const controls = new TransformControls(views.setCamera, renderer.domElement);
  const helper = controls.getHelper();
  // The gizmo must stay on LAYER_SCENE so its own raycaster can hit it; editorOnly
  // tells the HQ render to leave it out.
  helper.userData.editorOnly = true;
  scene.add(helper);

  let options: GizmoOptions | null = null;
  let dragging = false;

  controls.addEventListener('dragging-changed', (e) => {
    dragging = Boolean(e.value);
    views.orbit.enabled = !dragging && views.mode === 'set';
    if (!dragging && controls.object && options?.onCommit) options.onCommit(controls.object);
  });
  controls.addEventListener('objectChange', () => {
    if (controls.object && options?.onChange) options.onChange(controls.object);
  });

  // The gizmo is a set-view tool; hide it while looking through the camera.
  views.onChange((mode) => {
    controls.enabled = mode === 'set';
    helper.visible = mode === 'set' && controls.object !== undefined;
  });

  return {
    get attached() {
      return controls.object ?? null;
    },
    get dragging() {
      return dragging;
    },
    attach(object, opts) {
      options = opts;
      controls.setMode(opts.mode);
      controls.setSpace(opts.space ?? 'world');
      controls.attach(object);
      helper.visible = views.mode === 'set';
    },
    detach() {
      options = null;
      controls.detach();
    },
  };
}

// ---------------------------------------------------------------- undo

function installUndoKeys(store: SceneStore, ui: Ui): void {
  const undo = ui.addToolbarButton({ id: 'undo', label: 'Undo', title: 'Undo (Ctrl+Z)', onClick: () => store.undo() });
  const redo = ui.addToolbarButton({ id: 'redo', label: 'Redo', title: 'Redo (Ctrl+Shift+Z)', onClick: () => store.redo() });
  const sync = () => {
    undo.disabled = !store.canUndo;
    redo.disabled = !store.canRedo;
  };
  store.subscribe(sync);
  sync();
  window.addEventListener('keydown', (e) => {
    if (isTyping(e) || !(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      store.undo();
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      store.redo();
    }
  });
}

/** True when a key event belongs to a text input rather than a shortcut. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
