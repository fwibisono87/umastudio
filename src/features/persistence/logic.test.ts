import { describe, expect, it } from 'vitest';
import { createDefaultScene, parseScene } from '../../scene/document';
import type { SceneDocument } from '../../scene/types';
import {
  AUTOSAVE_KEY,
  createAutosave,
  isDirty,
  restoreAutosave,
  sanitizeFileName,
  sceneFileName,
  serializeScene,
  type StorageLike,
  type TimerScheduler,
} from './logic';

class MemoryStorage implements StorageLike {
  values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class FakeTimers implements TimerScheduler {
  private now = 0;
  private nextId = 0;
  private tasks = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, delayMs: number): number {
    const id = ++this.nextId;
    this.tasks.set(id, { at: this.now + delayMs, callback });
    return id;
  }

  clearTimeout(id: number): void {
    this.tasks.delete(id);
  }

  advanceBy(durationMs: number): void {
    const end = this.now + durationMs;
    while (true) {
      const due = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, task] = due;
      this.tasks.delete(id);
      this.now = task.at;
      task.callback();
    }
    this.now = end;
  }
}

describe('persistence helpers', () => {
  it('sanitizes portable scene filenames', () => {
    expect(sanitizeFileName('  Studio: Key / Fill?  ')).toBe('Studio- Key - Fill-');
    expect(sanitizeFileName('  .CON. ')).toBe('_CON');
    expect(sceneFileName('Portrait set')).toBe('Portrait set.umastudio.json');
  });

  it('tracks dirty state by saved document identity', () => {
    const saved = createDefaultScene();
    expect(isDirty(saved, saved)).toBe(false);
    expect(isDirty({ ...saved }, saved)).toBe(true);
    expect(isDirty(saved, null)).toBe(true);
  });

  it('debounces, serializes, and restores autosaves', () => {
    const storage = new MemoryStorage();
    const timers = new FakeTimers();
    const autosave = createAutosave(storage, timers);
    const first = createDefaultScene();
    const latest = createDefaultScene();
    latest.meta.name = 'Latest edit';

    autosave.schedule(first);
    timers.advanceBy(700);
    autosave.schedule(latest);
    timers.advanceBy(999);
    expect(storage.getItem(AUTOSAVE_KEY)).toBeNull();
    timers.advanceBy(1);

    expect(storage.getItem(AUTOSAVE_KEY)).toBe(serializeScene(latest));
    const restored = restoreAutosave(storage);
    expect(restored.kind).toBe('restored');
    if (restored.kind === 'restored') expect(restored.doc).toEqual(latest);
  });

  it('round-trips a saved scene through parseScene unchanged', () => {
    const doc: SceneDocument = createDefaultScene();
    doc.meta.name = 'Portrait study';
    doc.meta.notes = 'Window light with a white bounce.';
    doc.environment.backdropColor = '#345678';
    doc.environment.floorReflectance = 0.47;
    doc.environment.ambientLux = 320;

    expect(parseScene(serializeScene(doc))).toEqual(doc);
  });
});
