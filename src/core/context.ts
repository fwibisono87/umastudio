// The contract between the app core and feature modules.
//
// Each feature lives in src/features/<name>/ and exports `install(ctx: AppContext)`.
// A feature may read and write the scene document through ctx.store, add three.js
// objects to ctx.scene, and add UI through ctx.ui. Features don't import each other;
// anything two features both need goes through the document or this context.

import type { Bone, Object3D, PerspectiveCamera, Scene, SkinnedMesh, WebGLRenderer } from 'three';
import type { SceneStore } from './store';
import type { Ui } from '../ui/shell';

/**
 * three.js layers. Scene content (subject, set, lights) is on LAYER_SCENE. Editor-only
 * objects (gizmos, light bodies and handles, the camera's frustum) go on LAYER_HELPERS:
 * the set view sees them, the shot camera and the HQ render don't.
 */
export const LAYER_SCENE = 0;
export const LAYER_HELPERS = 1;

/** What the user has selected. Ephemeral: not part of the document. */
export type EntityRef =
  | { kind: 'camera' }
  | { kind: 'subject' }
  | { kind: 'light'; id: string }
  | { kind: 'prop'; id: string }
  | { kind: 'bone'; name: string };

export function sameEntity(a: EntityRef | null, b: EntityRef | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'light' || a.kind === 'prop') return a.id === (b as typeof a).id;
  if (a.kind === 'bone') return a.name === (b as typeof a).name;
  return true;
}

export interface Selection {
  readonly current: EntityRef | null;
  set(ref: EntityRef | null): void;
  onChange(listener: (ref: EntityRef | null) => void): () => void;
}

/** Click-to-select: register objects that select an entity when clicked in the viewport. */
export interface Picking {
  /** Clicking `object` or any of its descendants selects `ref`. Returns an unregister function. */
  register(object: Object3D, ref: EntityRef): () => void;
}

export interface GizmoOptions {
  mode: 'translate' | 'rotate';
  space?: 'world' | 'local';
  /** Called on every drag move with the attached object, already transformed. */
  onChange?: (object: Object3D) => void;
  /** Called once when a drag ends. */
  onCommit?: (object: Object3D) => void;
}

/** The single shared transform gizmo (one at a time, so features never fight over it). */
export interface Gizmo {
  attach(object: Object3D, options: GizmoOptions): void;
  detach(): void;
  readonly attached: Object3D | null;
  readonly dragging: boolean;
}

export type ViewMode = 'set' | 'camera';

export interface Views {
  /** 'set' = free orbit view of the studio; 'camera' = looking through the shot camera. */
  readonly mode: ViewMode;
  setMode(mode: ViewMode): void;
  onChange(listener: (mode: ViewMode) => void): () => void;
  /** Free-orbit editor camera. Sees LAYER_SCENE and LAYER_HELPERS. */
  readonly setCamera: PerspectiveCamera;
  /**
   * The photographer's camera. The camera feature owns its projection (sensor, focal
   * length) and transform; it sees LAYER_SCENE only.
   */
  readonly shotCamera: PerspectiveCamera;
  readonly active: PerspectiveCamera;
}

/** Renders one frame; the default is renderer.render(scene, camera). */
export type RenderPipeline = (renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) => void;

export interface FrameLoop {
  /** Called every frame before rendering, with seconds since the last frame. */
  onFrame(callback: (dt: number) => void): () => void;
  /**
   * Replace how frames are drawn (e.g. a depth-of-field post pass in camera view). Pass
   * null to restore the default. Only one pipeline is active; the last one set wins.
   */
  setPipeline(pipeline: RenderPipeline | null): void;
  /** Called after the viewport resizes, with its size in CSS pixels. */
  onResize(callback: (width: number, height: number) => void): () => void;
  readonly size: { width: number; height: number };
}

/** The loaded character, as seen by features other than the loader. */
export interface SubjectModel {
  /** Root of the model; sits under ctx.subject.anchor, already scaled to metres and facing +Z. */
  root: Object3D;
  meshes: SkinnedMesh[];
  /** Bones by canonical name (UmaViewer English names, see the loader's bone map). */
  bones: Map<string, Bone>;
  /** Rest-pose local quaternion of every bone, by canonical name. */
  restRotations: Map<string, import('three').Quaternion>;
  /** Morph target names available on the face mesh(es). */
  morphNames: string[];
}

export interface SubjectRuntime {
  /**
   * Group positioned and turned from document.subject.position / yawDeg (the core keeps
   * it in sync). The loader puts the model under it; while no model is loaded the core
   * shows a stand-in mannequin here.
   */
  readonly anchor: Object3D;
  readonly model: SubjectModel | null;
  /** Called by the loader when a model has loaded (or null to unload). */
  setModel(model: SubjectModel | null): void;
  onChange(listener: (model: SubjectModel | null) => void): () => void;
}

export interface AppContext {
  store: SceneStore;
  renderer: WebGLRenderer;
  /** The live-view scene. HQ render builds its own copy from this. */
  scene: Scene;
  views: Views;
  frame: FrameLoop;
  subject: SubjectRuntime;
  selection: Selection;
  picking: Picking;
  gizmo: Gizmo;
  ui: Ui;
}

export interface Feature {
  install(ctx: AppContext): void;
}
