import type { AppContext } from '../../core/context';
import { APERTURE_STOPS, formatAperture, formatShutter, ISO_STOPS, SHUTTER_STOPS } from '../../scene/units';
import { ev100 } from '../../scene/photometry';
import type { SceneDocument, Vec3 } from '../../scene/types';
import {
  BODY_PRESETS,
  COMMON_PRIMES_MM,
  placementFromPosition,
  positionFromPlacement,
} from './cameraMath';
import { bindControls, button, checkbox, group, numberField, readout, select, type Control } from '../../ui/controls';
import { el } from '../../ui/dom';

export interface CameraPanelState {
  dofEnabled(): boolean;
  thirdsEnabled(): boolean;
}

export function installCameraPanel(ctx: AppContext, onDisplayOptionsChange: () => void): CameraPanelState {
  let dof = true;
  let thirds = false;
  const controls: Control[] = [];
  const panel = ctx.ui.addPanel({ id: 'camera', title: 'Camera', order: 100 });

  const update = (recipe: (doc: SceneDocument) => void, label: string) => {
    ctx.store.update(recipe, { label: `camera ${label}` });
  };

  const body = select({
    label: 'Body',
    options: BODY_PRESETS.map((preset) => ({
      value: preset.name,
      label: `${preset.name} · ${preset.sensorWidthMm}×${preset.sensorHeightMm} mm · ${preset.category === 'leaf-shutter' ? 'leaf shutter' : 'focal-plane'} · ${formatShutter(preset.flashSyncS)}`,
    })),
    get: () => ctx.store.doc.camera.body.name,
    set: (name) => {
      const preset = BODY_PRESETS.find((candidate) => candidate.name === name);
      if (!preset) return;
      update((doc) => {
        doc.camera.body = {
          name: preset.name,
          sensorWidthMm: preset.sensorWidthMm,
          sensorHeightMm: preset.sensorHeightMm,
          flashSyncS: preset.flashSyncS,
        };
      }, 'body');
    },
  });
  controls.push(body);
  panel.append(group('Body', [body]));

  const focalLength = numberField({
    label: 'Focal length', unit: 'mm', min: 8, max: 800, step: 1,
    get: () => ctx.store.doc.camera.lens.focalLengthMm,
    set: (value) => update((doc) => { doc.camera.lens.focalLengthMm = value; }, 'focal length'),
  });
  const prime = select({
    label: 'Common prime',
    options: [
      { value: -1, label: 'Select a prime…' },
      ...COMMON_PRIMES_MM.map((value) => ({ value, label: `${value} mm` })),
    ],
    get: () => {
      const focal = ctx.store.doc.camera.lens.focalLengthMm;
      return COMMON_PRIMES_MM.includes(focal as (typeof COMMON_PRIMES_MM)[number]) ? focal : -1;
    },
    set: (value) => {
      if (value > 0) update((doc) => { doc.camera.lens.focalLengthMm = value; }, 'focal length');
    },
  });
  const focusDistance = numberField({
    label: 'Focus distance', unit: 'm', min: 0.1, max: 200, step: 0.1, precision: 2,
    get: () => ctx.store.doc.camera.lens.focusDistanceM,
    set: (value) => update((doc) => { doc.camera.lens.focusDistanceM = value; }, 'focus distance'),
  });
  const bladeCount = numberField({
    label: 'Aperture blades', min: 3, max: 16, step: 1,
    get: () => ctx.store.doc.camera.lens.bladeCount,
    set: (value) => update((doc) => { doc.camera.lens.bladeCount = Math.round(value); }, 'blade count'),
  });
  controls.push(focalLength, prime, focusDistance, bladeCount);
  panel.append(group('Lens', [
    focalLength,
    prime,
    focusDistance,
    bladeCount,
    button('Focus on subject', () => {
      const doc = ctx.store.doc;
      const face = subjectFace(doc);
      const camera = doc.camera.position;
      const distance = Math.hypot(camera[0] - face[0], camera[1] - face[1], camera[2] - face[2]);
      update((draft) => { draft.camera.lens.focusDistanceM = distance; }, 'focus distance');
    }),
  ]));

  const aperture = select({
    label: 'Aperture',
    options: APERTURE_STOPS.map((value) => ({ value, label: formatAperture(value) })),
    get: () => ctx.store.doc.camera.aperture,
    set: (value) => update((doc) => { doc.camera.aperture = value; }, 'aperture'),
  });
  const shutter = select({
    label: 'Shutter',
    options: SHUTTER_STOPS.map((value) => ({ value, label: formatShutter(value) })),
    get: () => ctx.store.doc.camera.shutterS,
    set: (value) => update((doc) => { doc.camera.shutterS = value; }, 'shutter'),
  });
  const iso = select({
    label: 'ISO',
    options: ISO_STOPS.map((value) => ({ value, label: `ISO ${value}` })),
    get: () => ctx.store.doc.camera.iso,
    set: (value) => update((doc) => { doc.camera.iso = value; }, 'ISO'),
  });
  const ev = readout('EV100', () => {
    const camera = ctx.store.doc.camera;
    return ev100(camera.aperture, camera.shutterS, camera.iso).toFixed(1);
  });
  controls.push(aperture, shutter, iso, ev);
  const syncWarning = el('div', { class: 'camera-sync-warning' });
  syncWarning.style.color = 'var(--danger)';
  syncWarning.style.fontSize = '12px';
  syncWarning.style.padding = '5px 0 0 106px';
  panel.append(group('Exposure', [aperture, shutter, iso, ev, syncWarning]));

  const distance = numberField({
    label: 'Distance', unit: 'm', min: 0.2, max: 100, step: 0.1, precision: 2,
    get: () => placement(ctx.store.doc).distanceM,
    set: (value) => setPlacement(ctx, update, { distanceM: value }),
  });
  const height = numberField({
    label: 'Height', unit: 'm', min: 0, max: 50, step: 0.05, precision: 2,
    get: () => placement(ctx.store.doc).heightM,
    set: (value) => setPlacement(ctx, update, { heightM: value }),
  });
  const angle = numberField({
    label: 'Orbit angle', unit: '°', min: -180, max: 180, step: 1, precision: 1,
    title: '0° is in front (+Z); positive angles move toward +X (to the right, seen from the default camera).',
    get: () => placement(ctx.store.doc).angleDeg,
    set: (value) => setPlacement(ctx, update, { angleDeg: value }),
  });
  const roll = numberField({
    label: 'Roll', unit: '°', min: -180, max: 180, step: 1, precision: 1,
    get: () => ctx.store.doc.camera.rollDeg,
    set: (value) => update((doc) => { doc.camera.rollDeg = value; }, 'roll'),
  });
  controls.push(distance, height, angle, roll);
  const aimButton = button('Aim at subject', () => {
    const face = subjectFace(ctx.store.doc);
    update((doc) => { doc.camera.target = face; }, 'aim');
  });

  const advanced = el('details', { class: 'control-group camera-advanced' });
  advanced.append(el('summary', {}, ['Advanced']));
  const positionControls = vectorControls(ctx, update, 'Position', 'position');
  const targetControls = vectorControls(ctx, update, 'Target', 'target');
  controls.push(...positionControls, ...targetControls);
  advanced.append(group('Position (world)', positionControls), group('Target (world)', targetControls));
  panel.append(group('Placement', [distance, height, angle, roll, aimButton, advanced]));

  const dofControl = checkbox({
    label: 'Live depth of field',
    get: () => dof,
    set: (value) => { dof = value; onDisplayOptionsChange(); },
  });
  const thirdsControl = checkbox({
    label: 'Thirds grid',
    get: () => thirds,
    set: (value) => { thirds = value; onDisplayOptionsChange(); },
  });
  controls.push(dofControl, thirdsControl);
  panel.append(group('View', [dofControl, thirdsControl]));

  bindControls(ctx.store, controls);
  const refreshExtras = (doc: SceneDocument) => {
    const hasStrobe = doc.lights.some((light) => light.enabled && light.output.kind === 'strobe');
    if (hasStrobe && doc.camera.shutterS < doc.camera.body.flashSyncS) {
      syncWarning.textContent = `Faster than flash sync (${formatShutter(doc.camera.body.flashSyncS)}).`;
    } else {
      syncWarning.textContent = '';
    }
    const camera = doc.camera;
    const focal = Number(camera.lens.focalLengthMm.toFixed(1));
    ctx.ui.setStatus('camera', `${focal} mm · ${formatAperture(camera.aperture)} · ${formatShutter(camera.shutterS)} · ISO ${camera.iso} · EV ${ev100(camera.aperture, camera.shutterS, camera.iso).toFixed(1)}`);
  };
  ctx.store.subscribe((doc) => refreshExtras(doc));
  refreshExtras(ctx.store.doc);

  return { dofEnabled: () => dof, thirdsEnabled: () => thirds };
}

function placement(doc: Readonly<SceneDocument>) {
  return placementFromPosition(doc.camera.position, doc.subject.position);
}

function setPlacement(
  ctx: AppContext,
  update: (recipe: (doc: SceneDocument) => void, label: string) => void,
  change: Partial<ReturnType<typeof placementFromPosition>>,
): void {
  const current = placement(ctx.store.doc);
  const next = { ...current, ...change };
  update((doc) => {
    doc.camera.position = positionFromPlacement(next, doc.subject.position);
  }, 'placement');
}

function subjectFace(doc: Readonly<SceneDocument>): Vec3 {
  return [doc.subject.position[0], doc.subject.position[1] + 1.35, doc.subject.position[2]];
}

function vectorControls(
  ctx: AppContext,
  update: (recipe: (doc: SceneDocument) => void, label: string) => void,
  label: string,
  key: 'position' | 'target',
): Control[] {
  return (['x', 'y', 'z'] as const).map((axis, index) => numberField({
    label: `${label} ${axis.toUpperCase()}`,
    unit: 'm',
    step: 0.05,
    precision: 2,
    get: () => ctx.store.doc.camera[key][index]!,
    set: (value) => update((doc) => {
      const vector = [...doc.camera[key]] as Vec3;
      vector[index] = value;
      doc.camera[key] = vector;
    }, key),
  }));
}
