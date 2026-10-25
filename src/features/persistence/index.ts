// Scene files, local recovery, and scene-level controls.

import type { AppContext } from '../../core/context';
import { createDefaultScene, parseScene } from '../../scene/document';
import type { SceneDocument } from '../../scene/types';
import { bindControls, button, group, numberField, slider, textField, type Control } from '../../ui/controls';
import { el } from '../../ui/dom';
import {
  AUTOSAVE_DELAY_MS,
  createAutosave,
  isDirty,
  restoreAutosave,
  sceneFileName,
  serializeScene,
  type StorageLike,
  type TimerScheduler,
} from './logic';

interface WritableSceneFile {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

interface SceneFileHandle {
  createWritable(): Promise<WritableSceneFile>;
  getFile(): Promise<File>;
}

interface FilePickerAcceptType {
  description: string;
  accept: Record<string, string[]>;
}

interface FilePickerWindow extends Window {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: FilePickerAcceptType[];
  }) => Promise<SceneFileHandle>;
  showOpenFilePicker?: (options: {
    multiple?: boolean;
    types: FilePickerAcceptType[];
  }) => Promise<SceneFileHandle[]>;
}

const SCENE_FILE_TYPE: FilePickerAcceptType = {
  description: 'umastudio scene',
  accept: { 'application/json': ['.json'] },
};

export function install(ctx: AppContext): void {
  let savedDocument: Readonly<SceneDocument> | null = ctx.store.doc;
  let currentFileHandle: SceneFileHandle | null = null;
  const storage = getLocalStorage();
  const autosave = createAutosave(storage, windowTimers(), AUTOSAVE_DELAY_MS);

  const updateTitle = () => {
    const dirty = isDirty(ctx.store.doc, savedDocument);
    document.title = `${ctx.store.doc.meta.name}${dirty ? '•' : ''} — umastudio`;
  };

  const updateDocument = (recipe: (draft: SceneDocument) => void, label: string) => {
    ctx.store.update(recipe, { label });
  };

  const name = textField({
    label: 'Name',
    get: () => ctx.store.doc.meta.name,
    set: (value) => updateDocument((draft) => { draft.meta.name = value; }, 'scene name'),
  });
  const notes = notesField(
    () => ctx.store.doc.meta.notes,
    (value) => updateDocument((draft) => { draft.meta.notes = value; }, 'scene notes'),
  );
  const backdrop = colorField(
    'Backdrop',
    () => ctx.store.doc.environment.backdropColor,
    (value) => updateDocument((draft) => { draft.environment.backdropColor = value; }, 'scene backdrop colour'),
  );
  const floor = slider({
    label: 'Floor reflectance',
    min: 0.05,
    max: 0.9,
    step: 0.01,
    format: (value) => value.toFixed(2),
    get: () => ctx.store.doc.environment.floorReflectance,
    set: (value) => updateDocument((draft) => { draft.environment.floorReflectance = value; }, 'scene floor reflectance'),
  });
  const ambient = numberField({
    label: 'Room ambient',
    min: 0,
    max: 2000,
    step: 10,
    unit: 'lux',
    title: '0 = blacked-out studio, ~300 = bright office',
    get: () => ctx.store.doc.environment.ambientLux,
    set: (value) => updateDocument((draft) => { draft.environment.ambientLux = value; }, 'scene room ambient'),
  });
  const controls: Control[] = [name, notes, backdrop, floor, ambient];
  const panel = ctx.ui.addPanel({ id: 'scene', title: 'Scene', order: 90 });
  panel.append(
    group('Set', [name, notes]),
    group('Environment', [
      backdrop,
      floor,
      ambient,
      el('div', {
        style: 'color:var(--text-dim);font-size:11px;margin:2px 0 0 106px;',
      }, ['0 = blacked-out studio, ~300 = bright office']),
    ]),
  );
  bindControls(ctx.store, controls);

  ctx.ui.addToolbarButton({ id: 'persistence-new', label: 'New', onClick: newScene });
  ctx.ui.addToolbarButton({ id: 'persistence-open', label: 'Open…', onClick: () => { void openScene(); } });
  ctx.ui.addToolbarButton({ id: 'persistence-save', label: 'Save', onClick: () => { void saveScene(false); } });

  const openInput = el('input', { id: 'persistence-open', type: 'file', accept: '.json,application/json' });
  openInput.hidden = true;
  openInput.addEventListener('change', () => {
    const file = openInput.files?.[0];
    openInput.value = '';
    if (file) void loadFile(file, null);
  });
  document.body.append(openInput);

  ctx.store.subscribe((doc) => {
    autosave.schedule(doc);
    updateTitle();
  });
  window.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 's') {
      event.preventDefault();
      void saveScene(event.shiftKey);
    } else if (key === 'o') {
      event.preventDefault();
      void openScene();
    }
  });
  window.addEventListener('beforeunload', (event) => {
    if (!isDirty(ctx.store.doc, savedDocument)) return;
    event.preventDefault();
    event.returnValue = '';
  });
  installJsonDrop(ctx, (file) => { void loadFile(file, null); });

  updateTitle();
  const restore = restoreAutosave(storage);
  if (restore.kind === 'invalid') {
    console.warn('Could not restore the umastudio autosave:', restore.error);
  } else if (restore.kind === 'restored') {
    // Restored work has not been written to a scene file in this session, so it stays dirty.
    ctx.store.replace(restore.doc, { skipHistory: true });
    ctx.ui.toast('Restored your last session');
    promptForModel(restore.doc, ctx);
  }

  function newScene(): void {
    if (isDirty(ctx.store.doc, savedDocument)) {
      const content = el('div', {}, [
        el('p', {}, ['Discard the unsaved changes and start a new set?']),
      ]);
      const actions = el('div', { style: 'display:flex;justify-content:flex-end;gap:8px;margin-top:16px;' });
      let closeDialog = () => {};
      actions.append(
        button('Cancel', () => closeDialog()),
        button('Discard', () => {
          closeDialog();
          createNewDocument();
        }),
      );
      content.append(actions);
      closeDialog = ctx.ui.openDialog('New set', content);
      return;
    }
    createNewDocument();
  }

  function createNewDocument(): void {
    currentFileHandle = null;
    ctx.store.replace(createDefaultScene());
  }

  async function openScene(): Promise<void> {
    const pickers = window as FilePickerWindow;
    if (typeof pickers.showOpenFilePicker !== 'function') {
      openInput.click();
      return;
    }

    try {
      const handles = await pickers.showOpenFilePicker({
        multiple: false,
        types: [SCENE_FILE_TYPE],
      });
      const handle = handles[0];
      if (!handle) return;
      await loadFile(await handle.getFile(), handle);
    } catch (error) {
      if (!isAbortError(error)) showError('Could not open scene', error);
    }
  }

  async function loadFile(file: File, handle: SceneFileHandle | null): Promise<void> {
    try {
      const doc = parseScene(await file.text());
      savedDocument = doc;
      currentFileHandle = handle;
      ctx.store.replace(doc);
      promptForModel(doc, ctx);
    } catch (error) {
      showError('Could not open scene', error);
    }
  }

  async function saveScene(saveAs: boolean): Promise<void> {
    const doc = ctx.store.doc;
    const contents = serializeScene(doc);
    const filename = sceneFileName(doc.meta.name);
    const pickers = window as FilePickerWindow;

    try {
      if (!saveAs && currentFileHandle) {
        await writeFile(currentFileHandle, contents);
      } else if (typeof pickers.showSaveFilePicker === 'function') {
        const handle = await pickers.showSaveFilePicker({
          suggestedName: filename,
          types: [SCENE_FILE_TYPE],
        });
        await writeFile(handle, contents);
        currentFileHandle = handle;
      } else {
        downloadScene(contents, filename);
      }
      savedDocument = doc;
      updateTitle();
      ctx.ui.toast('Saved');
    } catch (error) {
      if (!isAbortError(error)) showError('Could not save scene', error);
    }
  }

  function showError(action: string, error: unknown): void {
    const details = error instanceof Error ? error.message : String(error);
    ctx.ui.toast(`${action}: ${details}`, 'error');
  }
}

function notesField(get: () => string, set: (value: string) => void): Control {
  const input = el('textarea', {
    class: 'control-input',
    rows: '3',
    'aria-label': 'Notes',
    style: 'grid-column:2 / 4;resize:vertical;min-height:68px;',
  });
  input.addEventListener('change', () => set(input.value));
  const refresh = () => {
    if (document.activeElement !== input) input.value = get();
  };
  refresh();
  const element = el('label', { class: 'control-row' }, [
    el('span', { class: 'control-label' }, ['Notes']),
    input,
  ]);
  return { element, refresh };
}

function colorField(label: string, get: () => string, set: (value: string) => void): Control {
  const input = el('input', { type: 'color', class: 'control-input', 'aria-label': label });
  input.addEventListener('input', () => set(input.value));
  const refresh = () => {
    if (document.activeElement !== input) input.value = get();
  };
  refresh();
  const element = el('label', { class: 'control-row' }, [
    el('span', { class: 'control-label' }, [label]),
    input,
  ]);
  return { element, refresh };
}

function getLocalStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function windowTimers(): TimerScheduler {
  return {
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (id) => window.clearTimeout(id),
  };
}

async function writeFile(handle: SceneFileHandle, contents: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(contents);
  await writable.close();
}

function downloadScene(contents: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = el('a', { href: url, download: filename });
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function promptForModel(doc: Readonly<SceneDocument>, ctx: AppContext): void {
  const modelName = doc.subject.modelName;
  if (modelName) ctx.ui.toast(`Drop the model folder for ${modelName} to see her`);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function installJsonDrop(ctx: AppContext, onFile: (file: File) => void): void {
  const getJsonFile = (transfer: DataTransfer | null): File | null => {
    if (!transfer) return null;
    for (const file of Array.from(transfer.files)) {
      if (file.name.toLowerCase().endsWith('.json')) return file;
    }
    for (const item of Array.from(transfer.items)) {
      const file = item.kind === 'file' ? item.getAsFile() : null;
      if (file?.name.toLowerCase().endsWith('.json')) return file;
    }
    return null;
  };

  ctx.ui.viewport.addEventListener('dragover', (event) => {
    if (getJsonFile(event.dataTransfer)) event.preventDefault();
  });
  ctx.ui.viewport.addEventListener('drop', (event) => {
    const file = getJsonFile(event.dataTransfer);
    if (!file) return;
    event.preventDefault();
    // The model loader also listens on the viewport; keep this event bubbling.
    onFile(file);
  });
}
