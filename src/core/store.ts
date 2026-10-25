// The one place the scene document lives. Features read `store.doc`, change it with
// `store.update()`, and react to changes with `store.subscribe()`.
//
// Documents are treated as immutable: update() hands the recipe a deep copy to mutate,
// then swaps it in, so `prev` and `doc` in a listener can be compared freely.

import { cloneScene } from '../scene/document';
import type { SceneDocument } from '../scene/types';

export type StoreListener = (doc: SceneDocument, prev: SceneDocument) => void;

export interface UpdateOptions {
  /**
   * Undo label. Consecutive updates with the same label within COALESCE_MS merge into
   * one undo step, so a slider or gizmo drag undoes as a single action. Pass a label
   * unique to the control, e.g. "light key power".
   */
  label?: string;
  /** Don't record an undo step (for derived or transient changes). */
  skipHistory?: boolean;
}

const COALESCE_MS = 600;
const HISTORY_LIMIT = 200;

export class SceneStore {
  private current: SceneDocument;
  private listeners = new Set<StoreListener>();
  private undoStack: SceneDocument[] = [];
  private redoStack: SceneDocument[] = [];
  private lastLabel: string | undefined;
  private lastTime = 0;

  constructor(initial: SceneDocument) {
    this.current = initial;
  }

  get doc(): Readonly<SceneDocument> {
    return this.current;
  }

  /** Mutate a copy of the document; listeners fire once afterwards. */
  update(recipe: (draft: SceneDocument) => void, options: UpdateOptions = {}): void {
    const prev = this.current;
    const next = cloneScene(prev);
    recipe(next);
    if (!options.skipHistory) this.record(prev, options.label);
    this.current = next;
    this.emit(prev);
  }

  /** Swap in a whole document (load, new scene). Recorded as one undo step. */
  replace(doc: SceneDocument, options: UpdateOptions = {}): void {
    const prev = this.current;
    if (!options.skipHistory) this.record(prev, undefined);
    this.current = doc;
    this.emit(prev);
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const target = this.undoStack.pop();
    if (!target) return;
    const prev = this.current;
    this.redoStack.push(prev);
    this.current = target;
    this.lastLabel = undefined;
    this.emit(prev);
  }

  redo(): void {
    const target = this.redoStack.pop();
    if (!target) return;
    const prev = this.current;
    this.undoStack.push(prev);
    this.current = target;
    this.lastLabel = undefined;
    this.emit(prev);
  }

  private record(prev: SceneDocument, label: string | undefined): void {
    const now = performance.now();
    const coalesce = label !== undefined && label === this.lastLabel && now - this.lastTime < COALESCE_MS;
    if (!coalesce) {
      this.undoStack.push(prev);
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    }
    this.redoStack = [];
    this.lastLabel = label;
    this.lastTime = now;
  }

  private emit(prev: SceneDocument): void {
    for (const l of this.listeners) l(this.current, prev);
  }
}
