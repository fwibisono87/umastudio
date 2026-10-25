import { NeutralToneMapping, SRGBColorSpace, WebGLRenderer } from 'three';
import { WebGLPathTracer } from 'three-gpu-pathtracer';
import type { AppContext } from '../../core/context';
import { cloneScene } from '../../scene/document';
import type { SceneDocument } from '../../scene/types';
import { button, group, select } from '../../ui/controls';
import { el } from '../../ui/dom';
import { buildRenderScene, type RenderSceneSnapshot } from './buildRenderScene';
import { renderResolution } from './renderMath';

type SampleTarget = 0 | 64 | 256 | 1024;

export function install(ctx: AppContext): void {
  addRenderStyles();
  let openDialog: (() => void) | null = null;

  ctx.ui.addToolbarButton({
    id: 'render',
    label: 'Render',
    title: 'Take a high-quality path-traced photo',
    side: 'right',
    onClick: () => {
      const initialDoc = cloneScene(ctx.store.doc as SceneDocument);
      if (openDialog) {
        openDialog();
        openDialog = null;
      }
      openDialog = showRenderDialog(ctx, initialDoc, () => {
        openDialog = null;
      });
    },
  });
}

function showRenderDialog(ctx: AppContext, initialDoc: SceneDocument, onClose: () => void): () => void {
  let closed = false;
  let resolutionPx = 1200;
  let sampleTarget: SampleTarget = 256;
  let snapshot: RenderSceneSnapshot | null = null;
  let tracer: WebGLPathTracer | null = null;
  let renderRenderer: WebGLRenderer | null = null;
  let animationFrame = 0;
  let startedAt = 0;
  let targetReached = false;
  let failureShown = false;
  let documentSignature = JSON.stringify(initialDoc);

  const content = el('div', { class: 'render-dialog-content' });
  const changedHint = el('div', { class: 'render-hint' }, ['Scene changed — Restart to update this render.']);
  changedHint.hidden = true;
  const image = el('canvas', { class: 'render-image', 'aria-label': 'Progressively converging path-traced image' });
  const output = image.getContext('2d');
  const progress = el('div', { class: 'render-progress' }, ['Preparing render…']);
  const errorMessage = el('div', { class: 'render-error', role: 'alert' });
  errorMessage.hidden = true;
  const settingControls = el('div', { class: 'render-settings' });

  const resolutionControl = select({
    label: 'Long edge',
    options: [
      { value: 1200, label: '1200 px' },
      { value: 2000, label: '2000 px' },
      { value: 3000, label: '3000 px' },
    ],
    get: () => resolutionPx,
    set: (value) => {
      resolutionPx = value;
      resizeRender();
    },
  });
  const sampleControl = select({
    label: 'Samples',
    options: [
      { value: 64 as SampleTarget, label: '64' },
      { value: 256 as SampleTarget, label: '256' },
      { value: 1024 as SampleTarget, label: '1024' },
      { value: 0 as SampleTarget, label: 'Until stopped' },
    ],
    get: () => sampleTarget,
    set: (value) => {
      sampleTarget = value;
      targetReached = false;
      if (tracer) tracer.pausePathTracing = false;
      pauseButton.textContent = 'Pause';
      pauseButton.disabled = !tracer || failureShown;
      updateProgress();
    },
  });
  settingControls.append(group('Output', [resolutionControl, sampleControl]));

  const pauseButton = button('Pause', () => togglePause());
  const restartButton = button('Restart', () => restart());
  const downloadButton = button('Download PNG', () => downloadPng());
  downloadButton.disabled = true;
  const actionRow = el('div', { class: 'render-actions' }, [pauseButton, restartButton, downloadButton]);
  content.append(changedHint, image, progress, errorMessage, settingControls, actionRow);

  const storeUnsubscribe = ctx.store.subscribe((doc) => {
    changedHint.hidden = JSON.stringify(doc) === documentSignature;
  });
  const onShaderRejection = (event: PromiseRejectionEvent) => {
    if (!renderRenderer || !isRenderFailure(event.reason)) return;
    event.preventDefault();
    failRender(readableError(event.reason));
  };
  window.addEventListener('unhandledrejection', onShaderRejection);

  const close = ctx.ui.openDialog('Render', content, {
    wide: true,
    onClose: () => {
      closed = true;
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('unhandledrejection', onShaderRejection);
      storeUnsubscribe();
      disposeCurrentRender();
      onClose();
    },
  });

  // Let the dialog paint before the synchronous BVH construction begins.
  animationFrame = requestAnimationFrame(() => {
    animationFrame = 0;
    if (!closed) restart(initialDoc);
  });
  return close;

  function restart(capturedDoc?: SceneDocument): void {
    if (closed) return;
    disposeCurrentRender();
    failureShown = false;
    targetReached = false;
    errorMessage.hidden = true;
    errorMessage.textContent = '';
    progress.textContent = 'Building scene snapshot…';
    downloadButton.disabled = true;
    pauseButton.disabled = true;
    pauseButton.textContent = 'Pause';

    const doc = capturedDoc ?? cloneScene(ctx.store.doc as SceneDocument);
    documentSignature = JSON.stringify(doc);
    changedHint.hidden = JSON.stringify(ctx.store.doc) === documentSignature;
    startedAt = performance.now();

    try {
      snapshot = buildRenderScene(ctx, doc);
      const dimensions = renderResolution(resolutionPx, doc.camera.body.sensorWidthMm, doc.camera.body.sensorHeightMm);
      image.width = dimensions.width;
      image.height = dimensions.height;
      if (!output) throw new Error('This browser could not create a 2D canvas for the render preview.');
      output.fillStyle = '#090a0b';
      output.fillRect(0, 0, image.width, image.height);

      const webglCanvas = document.createElement('canvas');
      const renderer = new WebGLRenderer({
        canvas: webglCanvas,
        antialias: false,
        alpha: false,
        preserveDrawingBuffer: true,
      });
      renderRenderer = renderer;
      renderer.setPixelRatio(1);
      renderer.setSize(dimensions.width, dimensions.height, false);
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.toneMapping = NeutralToneMapping;
      renderer.toneMappingExposure = 1;
      renderer.debug.checkShaderErrors = true;
      renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
        const details = [
          gl.getProgramInfoLog(program),
          gl.getShaderInfoLog(vertexShader),
          gl.getShaderInfoLog(fragmentShader),
        ].filter((part): part is string => Boolean(part));
        failRender(details.length > 0 ? details.join('\n') : 'The path-tracer shader did not compile.');
      };
      renderer.domElement.addEventListener('webglcontextlost', onContextLost);
      if (!renderer.capabilities.isWebGL2) {
        throw new Error('High-quality rendering requires WebGL 2, which is unavailable in this browser.');
      }

      const pathTracer = new WebGLPathTracer(renderer);
      tracer = pathTracer;
      pathTracer.multipleImportanceSampling = true;
      pathTracer.bounces = 6;
      pathTracer.transmissiveBounces = 4;
      pathTracer.renderScale = 1;
      pathTracer.synchronizeRenderSize = true;
      pathTracer.dynamicLowRes = false;
      pathTracer.renderToCanvas = true;
      pathTracer.rasterizeScene = false;
      pathTracer.renderDelay = 0;
      pathTracer.minSamples = 0;
      pathTracer.fadeDuration = 0;
      pathTracer.setScene(snapshot.scene, snapshot.camera);
      pauseButton.disabled = false;
      updateProgress();
      animationFrame = requestAnimationFrame(renderFrame);
    } catch (error) {
      failRender(readableError(error));
    }
  }

  function resizeRender(): void {
    if (!snapshot || !renderRenderer || closed) return;
    const dimensions = renderResolution(
      resolutionPx,
      snapshot.camera.filmGauge,
      snapshot.camera.filmGauge / snapshot.camera.aspect,
    );
    image.width = dimensions.width;
    image.height = dimensions.height;
    renderRenderer.setSize(dimensions.width, dimensions.height, false);
    tracer?.reset();
    targetReached = false;
    if (tracer) tracer.pausePathTracing = false;
    downloadButton.disabled = true;
    updateProgress();
  }

  function renderFrame(): void {
    animationFrame = 0;
    if (closed || !tracer || !renderRenderer || !snapshot || failureShown) return;
    try {
      tracer.renderSample();
      if (failureShown) return;
      const samples = tracer.samples;
      if (sampleTarget !== 0 && samples >= sampleTarget) {
        targetReached = true;
        tracer.pausePathTracing = true;
        pauseButton.textContent = 'Complete';
        pauseButton.disabled = true;
      }
      drawPreview(renderRenderer, snapshot);
      downloadButton.disabled = samples < 1;
      updateProgress();
    } catch (error) {
      failRender(readableError(error));
      return;
    }
    animationFrame = requestAnimationFrame(renderFrame);
  }

  function drawPreview(renderer: WebGLRenderer, renderSnapshot: RenderSceneSnapshot): void {
    if (!output) throw new Error('This browser could not create a 2D canvas for the render preview.');
    output.drawImage(renderer.domElement, 0, 0, image.width, image.height);
    if (renderSnapshot.flashBandFraction <= 0) return;

    // Approximate the live-view flash curtain: the entire lower band is darkened, even
    // though a strict model would render strobe and continuous emitters separately.
    const top = image.height * (1 - renderSnapshot.flashBandFraction);
    const gradient = output.createLinearGradient(0, top, 0, image.height);
    gradient.addColorStop(0, 'rgb(0 0 0 / 0.12)');
    gradient.addColorStop(1, 'rgb(0 0 0 / 0.78)');
    output.fillStyle = gradient;
    output.fillRect(0, top, image.width, image.height - top);
  }

  function updateProgress(): void {
    const elapsed = formatElapsed(startedAt > 0 ? performance.now() - startedAt : 0);
    if (!tracer) {
      if (!failureShown) progress.textContent = `Preparing render… · ${elapsed}`;
      return;
    }
    const count = Math.floor(tracer.samples);
    const targetText = sampleTarget === 0 ? 'until stopped' : `${sampleTarget} target`;
    const state = targetReached ? 'Target reached' : tracer.pausePathTracing ? 'Paused' : 'Rendering';
    progress.textContent = `${state} · ${count} samples · ${elapsed} · ${targetText}`;
  }

  function togglePause(): void {
    if (!tracer || targetReached || failureShown) return;
    tracer.pausePathTracing = !tracer.pausePathTracing;
    pauseButton.textContent = tracer.pausePathTracing ? 'Resume' : 'Pause';
    updateProgress();
  }

  function downloadPng(): void {
    if (downloadButton.disabled) return;
    image.toBlob((blob) => {
      if (!blob) {
        ctx.ui.toast('Could not create the PNG image.', 'error');
        errorMessage.textContent = 'The browser could not encode this render as a PNG.';
        errorMessage.hidden = false;
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${safeSceneName(snapshot?.scene.name ?? ctx.store.doc.meta.name)}-render.png`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }, 'image/png');
  }

  function failRender(message: string): void {
    if (failureShown || closed) return;
    failureShown = true;
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    if (tracer) tracer.pausePathTracing = true;
    const readable = message.length > 3000 ? `${message.slice(0, 3000)}…` : message;
    errorMessage.textContent = `The HQ render stopped. ${readable}`;
    errorMessage.hidden = false;
    progress.textContent = 'Render failed';
    pauseButton.disabled = true;
    ctx.ui.toast(`HQ render failed: ${readable.split('\n')[0]}`, 'error');
  }

  function onContextLost(event: Event): void {
    event.preventDefault();
    failRender('The render WebGL context was lost. Close the dialog and try again.');
  }

  function disposeCurrentRender(): void {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    if (tracer) {
      try {
        tracer.dispose();
      } catch {
        // A partial WebGL initialization can still leave the tracer with no live targets.
      }
      tracer = null;
    }
    if (renderRenderer) {
      const canvas = renderRenderer.domElement;
      canvas.removeEventListener('webglcontextlost', onContextLost);
      try {
        renderRenderer.dispose();
        renderRenderer.forceContextLoss();
        canvas.width = 1;
        canvas.height = 1;
      } catch {
        // Continue snapshot cleanup even if the browser already lost this context.
      }
      renderRenderer = null;
    }
    snapshot?.dispose();
    snapshot = null;
  }
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function safeSceneName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ') || 'scene';
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

function isRenderFailure(reason: unknown): boolean {
  const message = readableError(reason);
  return /webgl|shader|program|path.?trac|gpu|compile/i.test(message);
}

function addRenderStyles(): void {
  if (document.getElementById('render-dialog-styles')) return;
  const style = el('style', { id: 'render-dialog-styles' });
  style.textContent = `
    .render-dialog-content { display: grid; gap: 10px; }
    .render-image { display: block; width: min(100%, 1000px); height: auto; max-height: 65vh; margin: 0 auto; background: #090a0b; object-fit: contain; }
    .render-progress { color: var(--text-dim); font: 12px/1.4 var(--mono); }
    .render-hint { color: var(--accent); font-size: 12px; }
    .render-error { border: 1px solid var(--danger); border-radius: var(--radius); padding: 8px; color: var(--text); font: 12px/1.45 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; }
    .render-settings .control-group { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; }
    .render-settings .control-group-title { grid-column: 1 / -1; }
    .render-settings .control-row { grid-template-columns: auto minmax(120px, 1fr); }
    .render-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
    @media (max-width: 650px) { .render-settings .control-group { grid-template-columns: 1fr; } }
  `;
  document.head.append(style);
}
