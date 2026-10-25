// Physical camera: sensor framing, optics, exposure controls, live depth of field and flash sync.

import { flashSyncCoverage } from '../../scene/photometry';
import { formatShutter } from '../../scene/units';
import type { AppContext } from '../../core/context';
import { el } from '../../ui/dom';
import { createCameraHelpers } from './helpers';
import { letterboxRect } from './cameraMath';
import { installCameraPanel } from './panel';
import { createCameraViewPass } from './pipeline';

export function install(ctx: AppContext): void {
  const helpers = createCameraHelpers(ctx);
  const frameOverlay = el('div', { class: 'camera-frame-overlay' });
  frameOverlay.style.position = 'absolute';
  frameOverlay.style.boxSizing = 'border-box';
  frameOverlay.style.border = '1px solid rgb(255 255 255 / 0.16)';
  frameOverlay.style.pointerEvents = 'none';
  frameOverlay.style.overflow = 'hidden';

  const band = el('div', { class: 'camera-sync-band' });
  band.style.position = 'absolute';
  band.style.left = '0';
  band.style.right = '0';
  band.style.bottom = '0';
  band.style.background = 'linear-gradient(to bottom, rgb(0 0 0 / 0.12), rgb(0 0 0 / 0.78))';

  const bandLabel = el('div', { class: 'camera-sync-label' });
  bandLabel.style.position = 'absolute';
  bandLabel.style.left = '8px';
  bandLabel.style.bottom = '6px';
  bandLabel.style.padding = '3px 6px';
  bandLabel.style.borderRadius = '3px';
  bandLabel.style.background = 'rgb(0 0 0 / 0.55)';
  bandLabel.style.color = '#fff';
  bandLabel.style.fontSize = '11px';
  bandLabel.style.fontFamily = 'var(--font)';
  band.append(bandLabel);

  const thirdsGrid = el('div', { class: 'camera-thirds-grid' });
  thirdsGrid.style.position = 'absolute';
  thirdsGrid.style.inset = '0';
  thirdsGrid.style.display = 'none';
  for (const fraction of [1 / 3, 2 / 3]) {
    const vertical = el('div');
    vertical.style.position = 'absolute';
    vertical.style.top = '0';
    vertical.style.bottom = '0';
    vertical.style.left = `${fraction * 100}%`;
    vertical.style.borderLeft = '1px solid rgb(255 255 255 / 0.36)';
    thirdsGrid.append(vertical);

    const horizontal = el('div');
    horizontal.style.position = 'absolute';
    horizontal.style.left = '0';
    horizontal.style.right = '0';
    horizontal.style.top = `${fraction * 100}%`;
    horizontal.style.borderTop = '1px solid rgb(255 255 255 / 0.36)';
    thirdsGrid.append(horizontal);
  }
  frameOverlay.append(band, thirdsGrid);
  ctx.ui.viewportOverlay.append(frameOverlay);

  let cameraViewPass: ReturnType<typeof createCameraViewPass> | null = null;
  let panelState: ReturnType<typeof installCameraPanel> | null = null;

  const refreshOverlay = () => {
    const doc = ctx.store.doc;
    const aspect = doc.camera.body.sensorWidthMm / doc.camera.body.sensorHeightMm;
    const rect = letterboxRect(ctx.frame.size.width, ctx.frame.size.height, aspect);
    frameOverlay.style.left = `${rect.x}px`;
    frameOverlay.style.top = `${rect.y}px`;
    frameOverlay.style.width = `${rect.width}px`;
    frameOverlay.style.height = `${rect.height}px`;
    frameOverlay.style.display = ctx.views.mode === 'camera' ? 'block' : 'none';
    thirdsGrid.style.display = panelState?.thirdsEnabled() ? 'block' : 'none';

    const hasStrobe = doc.lights.some((light) => light.enabled && light.output.kind === 'strobe');
    if (hasStrobe && doc.camera.shutterS < doc.camera.body.flashSyncS) {
      const flashCoverage = flashSyncCoverage(doc.camera.shutterS, doc.camera.body.flashSyncS);
      // This overlay approximates the curtain shadow; ambient and continuous light would still expose that band.
      band.style.display = 'block';
      band.style.height = `${(1 - flashCoverage) * 100}%`;
      bandLabel.textContent = `Shutter faster than flash sync (${formatShutter(doc.camera.body.flashSyncS)})`;
    } else {
      band.style.display = 'none';
    }
  };

  panelState = installCameraPanel(ctx, refreshOverlay);
  cameraViewPass = createCameraViewPass(ctx, () => panelState?.dofEnabled() ?? true);

  const sync = (doc: Parameters<typeof helpers.sync>[0]) => {
    helpers.sync(doc);
    refreshOverlay();
    cameraViewPass?.resize();
  };
  sync(ctx.store.doc);
  ctx.store.subscribe(sync);

  const setView = (mode: 'set' | 'camera') => {
    if (mode === 'camera') {
      cameraViewPass?.resize();
      ctx.frame.setPipeline(cameraViewPass?.render ?? null);
    } else {
      ctx.frame.setPipeline(null);
      cameraViewPass?.dispose();
    }
    refreshOverlay();
  };
  ctx.views.onChange(setView);
  ctx.frame.onResize(() => {
    cameraViewPass?.resize();
    refreshOverlay();
  });
  setView(ctx.views.mode);
}
