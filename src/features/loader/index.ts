import type { AppContext, SubjectModel } from '../../core/context';
import { loadPhysicalMaterials } from './materials';
import type { LoadedMaterials, ModelFile } from './materials';
import { buildSubjectModel } from './build';
import { applyNormalsMode, type NormalsMode } from './normals';
import { parsePmx } from './pmx';
import { bindControls, readout, select } from '../../ui/controls';

const NORMALS_KEY = 'umastudio.loader.normals';

export function install(ctx: AppContext): void {
  const folderInput = document.createElement('input');
  folderInput.type = 'file';
  folderInput.id = 'loader-folder';
  folderInput.multiple = true;
  folderInput.setAttribute('webkitdirectory', '');
  folderInput.hidden = true;

  const filesInput = document.createElement('input');
  filesInput.type = 'file';
  filesInput.id = 'loader-files';
  filesInput.multiple = true;
  filesInput.accept = '.pmx,.png,.jpg,.jpeg,.bmp,.tga';
  filesInput.hidden = true;
  document.body.append(folderInput, filesInput);

  // Shading normals are a viewing preference, not part of the scene, so they live in
  // localStorage rather than the document.
  let normalsMode: NormalsMode = readNormalsMode();
  const applyNormals = () => ctx.subject.model?.meshes.forEach((mesh) => applyNormalsMode(mesh.geometry, normalsMode));
  const panel = ctx.ui.addPanel({ id: 'model', title: 'Model', order: 105 });
  const modelName = readout('Model', () => ctx.store.doc.subject.modelName ?? 'Stand-in (load a model)');
  const normals = select<NormalsMode>({
    label: 'Normals',
    title: 'Uma models ship with normals flattened for toon shading; geometric normals let studio light model the face.',
    options: [
      { value: 'geometric', label: 'Geometric (realistic)' },
      { value: 'authored', label: 'Authored (toon)' },
    ],
    get: () => normalsMode,
    set: (value) => {
      normalsMode = value;
      writeNormalsMode(value);
      applyNormals();
    },
  });
  panel.append(modelName.element, normals.element);
  bindControls(ctx.store, [modelName, normals]);

  ctx.ui.addToolbarButton({
    id: 'load-model',
    label: 'Load model',
    title: 'Choose a model export folder',
    onClick: () => folderInput.click(),
  });
  ctx.ui.addToolbarButton({
    id: 'load-model-files',
    label: 'Files…',
    title: 'Choose a PMX file and any texture files',
    onClick: () => filesInput.click(),
  });

  const dropHighlight = document.createElement('div');
  dropHighlight.className = 'loader-drop-highlight';
  dropHighlight.textContent = 'Drop a PMX model and Texture2D folder';
  ctx.ui.viewportOverlay.append(dropHighlight);
  addDropStyles();

  let dragDepth = 0;
  let loadGeneration = 0;
  let activeMaterials: LoadedMaterials | null = null;

  const onInput = (input: HTMLInputElement) => {
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []).map((file) => ({
        file,
        path: file.webkitRelativePath || file.name,
      }));
      input.value = '';
      void loadFiles(files);
    });
  };
  onInput(folderInput);
  onInput(filesInput);

  ctx.ui.viewport.addEventListener('dragenter', (event: DragEvent) => {
    if (!hasFileTransfer(event)) return;
    event.preventDefault();
    dragDepth++;
    ctx.ui.viewport.classList.add('loader-drag-active');
  });
  ctx.ui.viewport.addEventListener('dragover', (event: DragEvent) => {
    if (!hasFileTransfer(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  ctx.ui.viewport.addEventListener('dragleave', (event: DragEvent) => {
    if (!hasFileTransfer(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) ctx.ui.viewport.classList.remove('loader-drag-active');
  });
  ctx.ui.viewport.addEventListener('drop', (event: DragEvent) => {
    if (!hasFileTransfer(event)) return;
    event.preventDefault();
    dragDepth = 0;
    ctx.ui.viewport.classList.remove('loader-drag-active');
    void collectDropFiles(event.dataTransfer)
      .then((files) => loadFiles(files))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.toast(`Could not read dropped model files: ${message}`, 'error');
      });
  });

  async function loadFiles(files: ModelFile[]): Promise<void> {
    const pmxFiles = files.filter((entry) => /\.pmx$/i.test(entry.file.name));
    if (pmxFiles.length === 0) {
      ctx.ui.toast('No .pmx model found in the selected files', 'error');
      return;
    }
    if (pmxFiles.length > 1) {
      ctx.ui.toast(`Several PMX files found; loading ${pmxFiles[0]!.file.name}`);
    }

    const generation = ++loadGeneration;
    let loaded: LoadedMaterials | null = null;
    try {
      const selected = pmxFiles[0]!;
      const pmx = parsePmx(new Uint8Array(await selected.file.arrayBuffer()));
      if (generation !== loadGeneration) return;
      loaded = await loadPhysicalMaterials(pmx, selected.path, files);
      if (generation !== loadGeneration) {
        loaded.dispose();
        return;
      }

      const model = buildSubjectModel(pmx, loaded.materials);
      model.meshes.forEach((mesh) => applyNormalsMode(mesh.geometry, normalsMode));
      const previousModel = ctx.subject.model;
      const previousMaterials = activeMaterials;
      ctx.subject.setModel(model);
      ctx.store.update((document) => {
        document.subject.modelName = selected.file.name;
      }, { label: 'load model' });
      ctx.ui.setStatus('model', `${selected.file.name} · ${pmx.faces.length.toLocaleString()} triangles`);
      activeMaterials = loaded;
      loaded = null;
      if (previousModel) disposeModel(previousModel);
      previousMaterials?.dispose();

      const missing = [...new Set(activeMaterials.missingTextures)];
      if (missing.length > 0) {
        const count = Math.min(missing.length, pmx.textures.length);
        ctx.ui.toast(`${count} of ${pmx.textures.length} textures missing — showing flat colours`);
        console.warn(`[loader] Missing textures for ${selected.file.name}: ${missing.join(', ')}`);
      } else {
        ctx.ui.toast(`Loaded ${selected.file.name} (${pmx.faces.length.toLocaleString()} triangles)`);
      }
    } catch (error) {
      loaded?.dispose();
      if (generation === loadGeneration) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.toast(`Could not load PMX model: ${message}`, 'error');
      }
    }
  }
}

function disposeModel(model: SubjectModel): void {
  for (const mesh of model.meshes) {
    mesh.geometry.dispose();
    mesh.skeleton.dispose();
  }
  model.root.clear();
}

function hasFileTransfer(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

async function collectDropFiles(transfer: DataTransfer | null): Promise<ModelFile[]> {
  if (!transfer) return [];
  const items = Array.from(transfer.items);
  const fromEntries: ModelFile[] = [];
  const fallback: ModelFile[] = [];
  for (const item of items) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) fromEntries.push(...(await walkEntry(entry, '')));
    else {
      const file = item.getAsFile();
      if (file) fallback.push({ file, path: file.webkitRelativePath || file.name });
    }
  }
  if (fromEntries.length === 0) {
    return fallback.length > 0
      ? deduplicateFiles(fallback)
      : deduplicateFiles(Array.from(transfer.files).map((file) => ({ file, path: file.webkitRelativePath || file.name })));
  }
  return deduplicateFiles([...fromEntries, ...fallback]);
}

function walkEntry(entry: FileSystemEntry, parentPath: string): Promise<ModelFile[]> {
  const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file(
        (file) => resolve([{ file, path }]),
        () => resolve([]),
      );
    });
  }
  if (!entry.isDirectory) return Promise.resolve([]);
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  return readDirectory(reader).then((children) =>
    Promise.all(children.map((child) => walkEntry(child, path))).then((groups) => groups.flat()),
  );
}

function readDirectory(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve) => {
    const entries: FileSystemEntry[] = [];
    const next = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(entries);
        else {
          entries.push(...batch);
          next();
        }
      }, () => resolve(entries));
    };
    next();
  });
}

function deduplicateFiles(files: ModelFile[]): ModelFile[] {
  const seen = new Set<string>();
  return files.filter(({ file, path }) => {
    const key = `${path.toLowerCase()}|${file.size}|${file.lastModified}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function addDropStyles(): void {
  if (document.getElementById('loader-drop-styles')) return;
  const style = document.createElement('style');
  style.id = 'loader-drop-styles';
  style.textContent = `
    .loader-drop-highlight {
      position: absolute;
      inset: 12px;
      display: none;
      place-items: center;
      border: 2px dashed rgba(255, 255, 255, 0.8);
      border-radius: 10px;
      background: rgba(22, 29, 41, 0.72);
      color: white;
      font: 600 15px/1.4 system-ui, sans-serif;
      letter-spacing: 0.02em;
      pointer-events: none;
      z-index: 10;
    }
    .viewport.loader-drag-active .loader-drop-highlight { display: grid; }
  `;
  document.head.append(style);
}

function readNormalsMode(): NormalsMode {
  try {
    return localStorage.getItem(NORMALS_KEY) === 'authored' ? 'authored' : 'geometric';
  } catch {
    return 'geometric';
  }
}

function writeNormalsMode(mode: NormalsMode): void {
  try {
    localStorage.setItem(NORMALS_KEY, mode);
  } catch {
    // A viewing preference; losing it is harmless.
  }
}
