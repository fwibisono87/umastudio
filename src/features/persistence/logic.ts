import { parseScene } from '../../scene/document';
import type { SceneDocument } from '../../scene/types';

export const AUTOSAVE_KEY = 'umastudio.autosave.v1';
export const AUTOSAVE_DELAY_MS = 1000;

/** Keep filenames portable across Windows, macOS and Linux. */
export function sanitizeFileName(name: string): string {
  let safe = name
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 120);

  if (!safe) safe = 'Untitled set';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)) safe = `_${safe}`;
  return safe;
}

export function sceneFileName(name: string): string {
  return `${sanitizeFileName(name)}.umastudio.json`;
}

/** Documents are immutable in the store, so identity also recognizes undo to a saved state. */
export function isDirty(
  current: Readonly<SceneDocument>,
  saved: Readonly<SceneDocument> | null,
): boolean {
  return saved === null || current !== saved;
}

export function serializeScene(doc: Readonly<SceneDocument>): string {
  return JSON.stringify(doc, null, 2);
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface TimerScheduler {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
}

export type AutosaveRestore =
  | { kind: 'empty' }
  | { kind: 'unavailable' }
  | { kind: 'invalid'; error: unknown }
  | { kind: 'restored'; doc: SceneDocument };

/** Reads and validates the last session without allowing storage or parse errors to escape. */
export function restoreAutosave(storage: StorageLike | null): AutosaveRestore {
  if (!storage) return { kind: 'unavailable' };

  let saved: string | null;
  try {
    saved = storage.getItem(AUTOSAVE_KEY);
  } catch {
    return { kind: 'unavailable' };
  }
  if (saved === null) return { kind: 'empty' };

  try {
    return { kind: 'restored', doc: parseScene(saved) };
  } catch (error) {
    return { kind: 'invalid', error };
  }
}

/** Debounced local autosave; storage failures (private mode or quota) are non-fatal. */
export function createAutosave(
  storage: StorageLike | null,
  timers: TimerScheduler,
  delayMs = AUTOSAVE_DELAY_MS,
): { schedule(doc: Readonly<SceneDocument>): void; cancel(): void } {
  let pending: number | null = null;

  return {
    schedule(doc) {
      if (!storage) return;
      if (pending !== null) timers.clearTimeout(pending);
      pending = timers.setTimeout(() => {
        pending = null;
        try {
          storage.setItem(AUTOSAVE_KEY, serializeScene(doc));
        } catch {
          // Autosave is best effort; the document remains available in memory.
        }
      }, delayMs);
    },
    cancel() {
      if (pending !== null) timers.clearTimeout(pending);
      pending = null;
    },
  };
}
