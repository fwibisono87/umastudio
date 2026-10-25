// Builds the AppContext: renderer, live-view scene, views, frame loop, selection,
// picking and the shared gizmo. Features are installed on top of it (main.ts).

import {
  Box3,
  HemisphereLight,
  NeutralToneMapping,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Sphere,
  Timer,
  Vector2,
  Vector3,
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
import { el } from '../ui/dom';

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
  const workLight = new HemisphereLight(0xf2f4f5, 0x747474, 0.7);
  workLight.name = 'set-work-light';
  workLight.layers.set(LAYER_HELPERS);
  workLight.userData.editorOnly = true;
  scene.add(workLight);

  const frame = createFrameLoop(renderer, scene, views, ui.viewport);
  const selection = createSelection();
  const gizmo = createGizmo(renderer, scene, views);
  const picking = createPicking(renderer, views, selection, gizmo);
  const subject = createSubjectRuntime(store, scene, picking);

  const ctx: AppContext = { store, renderer, scene, views, frame, subject, selection, picking, gizmo, ui };

  installUndoKeys(store, ui);
  installViewToggle(views, ui);
  installWorkLight(ctx, workLight);
  installToolMode(ctx);
  installSelectionShortcuts(ctx, views);

  return ctx;
}

// ---------------------------------------------------------------- views

function createViews(renderer: WebGLRenderer): Views & { orbit: OrbitControls } {
  const setCamera = new PerspectiveCamera(45, 1, 0.05, 200);
  setCamera.position.set(-5.5, 5.1, 6.5);
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
    side: 'center',
    group: 'view',
    onClick: () => views.setMode('set'),
  });
  const cameraButton = ui.addToolbarButton({
    id: 'view-camera',
    label: 'Camera view',
    title: 'Look through the camera (V)',
    side: 'center',
    group: 'view',
    onClick: () => views.setMode('camera'),
  });
  const sync = () => {
    setButton.classList.toggle('active', views.mode === 'set');
    cameraButton.classList.toggle('active', views.mode === 'camera');
  };
  views.onChange(sync);
  sync();
}

// Three r186 only gathers a light when its layers match the active camera:
// WebGLRenderer.js:1408-1412 and 1426-1430. The set camera enables LAYER_HELPERS;
// the shot camera is restricted to LAYER_SCENE in createViews(), so toggling this
// light cannot change camera-view pixels. The meter reads the document, and HQ render
// builds lights from document state while this object is marked editorOnly.
function installWorkLight(ctx: AppContext, light: HemisphereLight): void {
  const storageKey = 'umastudio.workLight.enabled';
  let enabled = readWorkLightPreference(storageKey);
  const button = ctx.ui.addToolbarButton({
    id: 'work-light',
    label: 'Work light',
    title: 'Illuminate the set view only',
    side: 'right',
    group: 'display',
    onClick: () => {
      enabled = !enabled;
      try { localStorage.setItem(storageKey, enabled ? '1' : '0'); } catch { /* preference only */ }
      sync();
    },
  });

  const sync = () => {
    // The layer mask is the render-path boundary; visibility also avoids doing any
    // editor-light work while the photographer is looking through the shot camera.
    light.visible = enabled && ctx.views.mode === 'set';
    button.classList.toggle('active', enabled);
    button.setAttribute('aria-pressed', String(enabled));
  };
  ctx.views.onChange(sync);
  sync();
}

function installToolMode(ctx: AppContext): void {
  const moveButton = ctx.ui.addToolbarButton({
    id: 'tool-move',
    label: 'Move',
    title: 'Move tool (W)',
    side: 'center',
    group: 'tool',
    onClick: () => ctx.gizmo.setToolMode('translate'),
  });
  const rotateButton = ctx.ui.addToolbarButton({
    id: 'tool-rotate',
    label: 'Rotate',
    title: 'Rotate tool (E)',
    side: 'center',
    group: 'tool',
    onClick: () => ctx.gizmo.setToolMode('rotate'),
  });
  const segment = moveButton.parentElement;
  if (segment) {
    segment.setAttribute('aria-label', 'Transform tools');
    Object.assign(segment.style, {
      gap: '0',
      padding: '0',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      overflow: 'hidden',
    });
  }
  moveButton.style.border = '0';
  moveButton.style.borderRadius = '0';
  rotateButton.style.border = '0';
  rotateButton.style.borderRadius = '0';
  rotateButton.style.borderLeft = '1px solid var(--border)';

  const sync = (mode: 'translate' | 'rotate' = ctx.gizmo.toolMode) => {
    moveButton.classList.toggle('active', mode === 'translate');
    rotateButton.classList.toggle('active', mode === 'rotate');
    moveButton.setAttribute('aria-pressed', String(mode === 'translate'));
    rotateButton.setAttribute('aria-pressed', String(mode === 'rotate'));
  };
  ctx.gizmo.onToolModeChange(sync);
  sync();
}

function readWorkLightPreference(key: string): boolean {
  try {
    return localStorage.getItem(key) !== '0';
  } catch {
    return true;
  }
}

function installSelectionShortcuts(ctx: AppContext, views: Views & { orbit: OrbitControls }): void {
  const openHelp = () => {
    const shortcuts = [
      ['V', 'Switch between set and camera view'],
      ['W', 'Use the move tool'],
      ['E', 'Use the rotate tool'],
      ['F', 'Frame the selection, or the whole set'],
      ['Esc', 'Clear the selection'],
      ['Delete / Backspace', 'Delete the selected light or prop'],
      ['Ctrl+Z', 'Undo'],
      ['Ctrl+Shift+Z', 'Redo'],
      ['Ctrl+S', 'Save the scene'],
      ['Ctrl+O', 'Open a scene'],
    ];
    const list = el('div', { class: 'shortcut-list' }, shortcuts.flatMap(([key, description]) => [
      el('kbd', {}, [key!]),
      el('span', {}, [description!]),
    ]));
    ctx.ui.openDialog('Keyboard shortcuts', list);
  };

  ctx.ui.addToolbarButton({
    id: 'shortcuts',
    label: '?',
    title: 'Keyboard shortcuts (?)',
    side: 'right',
    group: 'help',
    onClick: openHelp,
  });

  ctx.selection.onChange((ref) => {
    const owner = ref?.kind === 'aim' ? ref.owner : ref;
    const panel = owner === null || owner === undefined
      ? null
      : owner.kind === 'light' || owner.kind === 'prop'
        ? 'lights'
        : owner.kind === 'camera'
          ? 'camera'
          : 'pose';
    if (panel) ctx.ui.revealPanel(panel);
  });

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (key === 'escape' && !isTyping(event)) {
      ctx.selection.set(null);
      return;
    }
    if (isTyping(event) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (document.querySelector('.dialog-backdrop')) return;

    if (event.key === '?' || (event.key === '/' && event.shiftKey)) {
      event.preventDefault();
      openHelp();
      return;
    }
    if (event.shiftKey) return;

    if (key === 'v') {
      ctx.views.setMode(ctx.views.mode === 'set' ? 'camera' : 'set');
    } else if (key === 'f' && ctx.views.mode === 'set') {
      event.preventDefault();
      frameSelection(ctx, views);
    } else if (key === 'w') {
      ctx.gizmo.setToolMode('translate');
    } else if (key === 'e') {
      ctx.gizmo.setToolMode('rotate');
    } else if (key === 'delete' || key === 'backspace') {
      if (ctx.selection.current?.kind === 'aim' || deleteSelection(ctx)) event.preventDefault();
    }
  });
}

function deleteSelection(ctx: AppContext): boolean {
  const selected = ctx.selection.current;
  if (selected?.kind === 'light' && ctx.store.doc.lights.some((light) => light.id === selected.id)) {
    ctx.store.update((doc) => { doc.lights = doc.lights.filter((light) => light.id !== selected.id); }, { label: `delete light ${selected.id}` });
    ctx.selection.set(null);
    return true;
  } else if (selected?.kind === 'prop' && ctx.store.doc.props.some((prop) => prop.id === selected.id)) {
    ctx.store.update((doc) => { doc.props = doc.props.filter((prop) => prop.id !== selected.id); }, { label: `delete prop ${selected.id}` });
    ctx.selection.set(null);
    return true;
  }
  return false;
}

function frameSelection(ctx: AppContext, views: Views & { orbit: OrbitControls }): void {
  const box = new Box3().makeEmpty();
  const addPoint = (point: readonly number[]) => box.expandByPoint(new Vector3(point[0], point[1], point[2]));
  const addObject = (object: Object3D) => {
    object.updateMatrixWorld(true);
    box.expandByObject(object);
  };
  const document = ctx.store.doc;
  const selection = ctx.selection.current;
  const selected = selection?.kind === 'aim' ? selection.owner : selection;

  if (selected === null) {
    addObject(ctx.subject.anchor);
    addPoint(document.camera.position);
    addPoint(document.camera.target);
    for (const light of document.lights) {
      addPoint(light.position);
      addPoint(light.target);
    }
    for (const prop of document.props) {
      addPoint(prop.position);
      addPoint(prop.target);
    }
  } else if (selected.kind === 'subject') {
    addObject(ctx.subject.anchor);
  } else if (selected.kind === 'camera') {
    addPoint(document.camera.position);
    addPoint(document.camera.target);
  } else if (selected.kind === 'light') {
    const light = document.lights.find((item) => item.id === selected.id);
    if (light) {
      addPoint(light.position);
      addPoint(light.target);
    }
  } else if (selected.kind === 'prop') {
    const prop = document.props.find((item) => item.id === selected.id);
    if (prop) {
      addPoint(prop.position);
      addPoint(prop.target);
      box.expandByPoint(new Vector3(prop.position[0] - prop.widthM / 2, prop.position[1] - prop.heightM / 2, prop.position[2]));
      box.expandByPoint(new Vector3(prop.position[0] + prop.widthM / 2, prop.position[1] + prop.heightM / 2, prop.position[2]));
    }
  } else {
    const name = selected.name.startsWith('IK:') ? selected.name.slice(3) : selected.name;
    const bone = ctx.subject.model?.bones.get(name);
    if (bone) {
      const point = bone.getWorldPosition(new Vector3());
      box.expandByPoint(point.clone().addScalar(-0.2));
      box.expandByPoint(point.clone().addScalar(0.2));
    }
  }

  if (box.isEmpty()) addPoint(document.subject.position);
  const sphere = box.getBoundingSphere(new Sphere());
  sphere.radius = Math.max(0.3, sphere.radius);

  let direction = views.setCamera.position.clone().sub(views.orbit.target);
  if (direction.lengthSq() < 1e-6) direction.set(-5, 4, 6);
  direction.normalize();
  const halfFov = (views.setCamera.fov * Math.PI) / 360;
  const distance = Math.max(1.2, (sphere.radius / Math.sin(halfFov)) * 1.15);
  views.orbit.target.copy(sphere.center);
  views.setCamera.position.copy(sphere.center).addScaledVector(direction, distance);
  views.orbit.update();
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
    // Aim spheres render above the scene so their small target remains a usable
    // affordance even when it sits on the subject surface.
    for (const hit of hits) {
      for (let object: Object3D | null = hit.object; object; object = object.parent) {
        const ref = targets.get(object);
        if (ref?.kind === 'aim' && object.visible) {
          selection.set(ref);
          return;
        }
      }
    }
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
  let toolMode: 'translate' | 'rotate' = 'translate';
  const toolModeListeners = new Set<(mode: 'translate' | 'rotate') => void>();

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
    get toolMode() {
      return toolMode;
    },
    setToolMode(mode) {
      if (mode === toolMode) return;
      toolMode = mode;
      toolModeListeners.forEach((listener) => listener(mode));
    },
    onToolModeChange(listener) {
      toolModeListeners.add(listener);
      return () => toolModeListeners.delete(listener);
    },
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
  const undo = ui.addToolbarButton({ id: 'undo', label: 'Undo', title: 'Undo (Ctrl+Z)', group: 'history', onClick: () => store.undo() });
  const redo = ui.addToolbarButton({ id: 'redo', label: 'Redo', title: 'Redo (Ctrl+Shift+Z)', group: 'history', onClick: () => store.redo() });
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
