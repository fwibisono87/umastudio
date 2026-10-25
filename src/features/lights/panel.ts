import type { AppContext } from '../../core/context';
import { button, buttonRow, group, numberField, select, slider, textField, type Control } from '../../ui/controls';
import { el } from '../../ui/dom';
import { createLight, nextId } from '../../scene/document';
import { GRID_ANGLES_DEG, MODIFIERS, getModifier } from '../../scene/modifiers';
import { meterReading, type MeterMode } from '../../scene/lightModel';
import { APERTURE_STOPS, formatPowerStops } from '../../scene/units';
import type { LightState, PropState, SceneDocument, Vec3 } from '../../scene/types';

const FACE_OFFSET: Vec3 = [0, 1.35, 0];
const BOUNCE_COLORS = [
  { value: '#ffffff', label: 'White' },
  { value: '#c8cdd2', label: 'Silver' },
  { value: '#d9aa38', label: 'Gold' },
] as const;

export function installLightsPanel(ctx: AppContext): void {
  const body = ctx.ui.addPanel({ id: 'lights', title: 'Lights', order: 110 });
  const lightList = el('div', { class: 'light-list' });
  const lightDetails = el('div', { class: 'light-details' });
  const propList = el('div', { class: 'prop-list' });
  const propDetails = el('div', { class: 'prop-details' });
  const meterDetails = el('div', { class: 'meter-details' });
  let meterMode: MeterMode = 'toward-camera';
  let detailControls: Control[] = [];
  let renderedSelection = '\0';

  const meterModeControl = select<MeterMode>({
    label: 'Dome direction',
    options: [
      { value: 'toward-each-light', label: 'Toward each light' },
      { value: 'toward-camera', label: 'Toward camera' },
    ],
    get: () => meterMode,
    set: (value) => {
      meterMode = value;
      refreshMeter();
    },
  });

  const addStrobe = button('Add strobe', () => addLight('strobe'));
  const addContinuous = button('Add continuous', () => addLight('continuous'));
  const duplicate = button('Duplicate', duplicateSelectedLight);
  const deleteLight = button('Delete', deleteSelectedLight);
  const lightButtons = buttonRow([addStrobe, addContinuous, duplicate, deleteLight], 2);
  const lightsGroup = group('Lights', [lightList, lightButtons, lightDetails]);
  const propsButtons = buttonRow([
    button('Bounce white', () => addProp('bounce', '#ffffff')),
    button('Bounce silver', () => addProp('bounce', '#c8cdd2')),
    button('Bounce gold', () => addProp('bounce', '#d9aa38')),
    button('Flag', () => addProp('flag', '#101014')),
    button('Diffusion', () => addProp('diffusion', '#ffffff')),
  ], 2);
  const propsGroup = group('Props', [propsButtons, propList, propDetails]);
  const meterGroup = group('Light meter', [meterModeControl, meterDetails]);
  body.append(lightsGroup, meterGroup, propsGroup);

  const selectedLight = (): LightState | undefined => {
    const selection = ctx.selection.current;
    return selection?.kind === 'light' ? ctx.store.doc.lights.find((light) => light.id === selection.id) : undefined;
  };
  const selectedOwner = () => {
    const selection = ctx.selection.current;
    return selection?.kind === 'aim' ? selection.owner : selection;
  };
  const mutateLight = (id: string, label: string, recipe: (light: LightState) => void) => {
    ctx.store.update((doc) => {
      const light = doc.lights.find((item) => item.id === id);
      if (light) recipe(light);
    }, { label });
  };
  const mutateProp = (id: string, label: string, recipe: (prop: PropState) => void) => {
    ctx.store.update((doc) => {
      const prop = doc.props.find((item) => item.id === id);
      if (prop) recipe(prop);
    }, { label });
  };

  function addLight(kind: 'strobe' | 'continuous'): void {
    const doc = ctx.store.doc as SceneDocument;
    const id = nextId(doc, 'light');
    const side = doc.lights.length % 2 === 0 ? 1 : -1;
    const angle = (side * 45 * Math.PI) / 180;
    const subject = doc.subject.position;
    const position: Vec3 = [subject[0] + Math.sin(angle) * 2.2, 2, subject[2] + Math.cos(angle) * 2.2];
    const target: Vec3 = [subject[0] + FACE_OFFSET[0], subject[1] + FACE_OFFSET[1], subject[2] + FACE_OFFSET[2]];
    const light = createLight(id, kind === 'strobe' ? `Strobe ${doc.lights.length + 1}` : `Continuous ${doc.lights.length + 1}`, {
      position,
      target,
      modifierId: kind === 'strobe' ? 'softbox-90x120' : 'softbox-60x90',
      output: kind === 'strobe'
        ? { kind: 'strobe', fullPowerWs: 500, powerStops: 0 }
        : { kind: 'continuous', watts: 200, lumensPerWatt: 120 },
    });
    ctx.store.update((draft) => draft.lights.push(light), { label: `add ${kind}` });
    ctx.selection.set({ kind: 'light', id });
  }

  function duplicateSelectedLight(): void {
    const source = selectedLight();
    if (!source) return;
    const doc = ctx.store.doc as SceneDocument;
    const clone = structuredClone(source);
    clone.id = nextId(doc, 'light');
    clone.name = `${source.name} copy`;
    clone.position = [source.position[0] - 0.45, source.position[1], source.position[2] + 0.25];
    ctx.store.update((draft) => draft.lights.push(clone), { label: 'duplicate light' });
    ctx.selection.set({ kind: 'light', id: clone.id });
  }

  function deleteSelectedLight(): void {
    const source = selectedLight();
    if (!source) return;
    ctx.store.update((draft) => {
      draft.lights = draft.lights.filter((light) => light.id !== source.id);
    }, { label: `delete light ${source.id}` });
    ctx.selection.set(null);
  }

  function addProp(kind: PropState['kind'], color: string): void {
    const doc = ctx.store.doc as SceneDocument;
    const id = nextId(doc, 'prop');
    const subject = doc.subject.position;
    const position: Vec3 = kind === 'bounce'
      ? [subject[0] - 1.25, subject[1] + 1.25, subject[2] + 0.2]
      : kind === 'flag'
        ? [subject[0] + 1.1, subject[1] + 1.3, subject[2] + 0.2]
        : [subject[0], subject[1] + 1.6, subject[2] - 1];
    const target: Vec3 = kind === 'flag'
      ? [position[0], position[1], position[2] + 1]
      : [subject[0], subject[1] + FACE_OFFSET[1], subject[2]];
    const name = kind === 'bounce'
      ? `${color === '#ffffff' ? 'White' : color === '#c8cdd2' ? 'Silver' : 'Gold'} bounce`
      : kind === 'flag' ? 'Flag' : 'Diffusion scrim';
    const prop: PropState = {
      id,
      name,
      kind,
      position,
      target,
      rollDeg: 0,
      widthM: kind === 'flag' ? 0.8 : 1.2,
      heightM: kind === 'flag' ? 1.2 : 1.5,
      color,
      transmission: kind === 'diffusion' ? 0.65 : 0,
    };
    ctx.store.update((draft) => draft.props.push(prop), { label: `add ${kind}` });
    ctx.selection.set({ kind: 'prop', id });
  }

  function buildLightDetails(light: LightState): void {
    const id = light.id;
    const controls: Control[] = [];
    const update = (label: string, recipe: (state: LightState) => void) => mutateLight(id, `light ${id} ${label}`, recipe);
    const name = textField({ label: 'Name', get: () => findLight(id)?.name ?? '', set: (value) => update('name', (state) => { state.name = value; }) });
    controls.push(name);

    if (light.output.kind === 'strobe') {
      controls.push(
        numberField({
          label: 'Full power', unit: 'Ws', min: 1, max: 10000, step: 10, precision: 0,
          get: () => {
            const output = findLight(id)?.output;
            return output?.kind === 'strobe' ? output.fullPowerWs : 500;
          },
          set: (value) => update('full power', (state) => { if (state.output.kind === 'strobe') state.output.fullPowerWs = value; }),
        }),
        slider({
          label: 'Power', min: 0, max: 7, step: 0.1, format: formatPowerStops,
          get: () => {
            const output = findLight(id)?.output;
            return output?.kind === 'strobe' ? output.powerStops : 0;
          },
          set: (value) => update('power', (state) => { if (state.output.kind === 'strobe') state.output.powerStops = value; }),
        }),
      );
    } else {
      controls.push(
        numberField({
          label: 'Electrical power', unit: 'W', min: 1, max: 5000, step: 1, precision: 0,
          get: () => {
            const output = findLight(id)?.output;
            return output?.kind === 'continuous' ? output.watts : 200;
          },
          set: (value) => update('watts', (state) => { if (state.output.kind === 'continuous') state.output.watts = value; }),
        }),
        numberField({
          label: 'Efficacy', unit: 'lm/W', min: 1, max: 300, step: 1, precision: 0,
          get: () => {
            const output = findLight(id)?.output;
            return output?.kind === 'continuous' ? output.lumensPerWatt : 120;
          },
          set: (value) => update('efficacy', (state) => { if (state.output.kind === 'continuous') state.output.lumensPerWatt = value; }),
        }),
      );
    }
    controls.push(
      numberField({
        label: 'Colour temp', unit: 'K', min: 1000, max: 20000, step: 50, precision: 0,
        get: () => findLight(id)?.colorTempK ?? 5500,
        set: (value) => update('colour temp', (state) => { state.colorTempK = value; }),
      }),
      select({
        label: 'Modifier',
        options: MODIFIERS.map((modifier) => ({ value: modifier.id, label: modifier.name })),
        get: () => findLight(id)?.modifierId ?? 'softbox-90x120',
        set: (value) => update('modifier', (state) => { state.modifierId = value; }),
      }),
    );

    const grid = select({
      label: 'Grid',
      options: [{ value: 'none', label: 'None' }, ...GRID_ANGLES_DEG.map((angle) => ({ value: String(angle), label: `${angle}°` }))],
      get: () => findLight(id)?.accessories.gridDeg?.toString() ?? 'none',
      set: (value) => update('grid', (state) => { state.accessories.gridDeg = value === 'none' ? null : Number(value); }),
    });
    controls.push(grid);
    const barnFields = (['top', 'bottom', 'left', 'right'] as const).map((side) => numberField({
      label: `Door ${side}`,
      unit: '°',
      min: 0,
      max: 85,
      step: 1,
      precision: 0,
      get: () => findLight(id)?.accessories.barnDoors?.[side] ?? 0,
      set: (value) => update(`door ${side}`, (state) => {
        state.accessories.barnDoors ??= { top: 0, bottom: 0, left: 0, right: 0 };
        state.accessories.barnDoors[side] = value;
      }),
    }));
    controls.push(...barnFields);

    const distance = numberField({
      label: 'Distance', unit: 'm', min: 0.2, max: 20, step: 0.05, precision: 2,
      get: () => lightPolar(findLight(id), (ctx.store.doc as SceneDocument).subject.position).distance,
      set: (value) => update('placement', (state) => setPolarPosition(state, (ctx.store.doc as SceneDocument).subject.position, value, undefined)),
    });
    const height = numberField({
      label: 'Height', unit: 'm', min: 0, max: 15, step: 0.05, precision: 2,
      get: () => findLight(id)?.position[1] ?? 2,
      set: (value) => update('placement', (state) => { state.position[1] = value; }),
    });
    const azimuth = numberField({
      label: 'Angle', unit: '°', min: -180, max: 180, step: 1, precision: 0,
      get: () => lightPolar(findLight(id), (ctx.store.doc as SceneDocument).subject.position).angleDeg,
      set: (value) => update('placement', (state) => setPolarPosition(state, (ctx.store.doc as SceneDocument).subject.position, undefined, value)),
    });
    const roll = numberField({
      label: 'Roll', unit: '°', min: -180, max: 180, step: 1, precision: 1,
      title: '90° lays a stripbox horizontal.',
      get: () => findLight(id)?.rollDeg ?? 0,
      set: (value) => update('roll', (state) => { state.rollDeg = value; }),
    });
    controls.push(distance, height, azimuth, roll);

    const positionFields = vec3Fields('Position', () => findLight(id), (state) => state.position, (state, axis, value) => { state.position[axis] = value; }, update);
    const targetFields = vec3Fields('Target', () => findLight(id), (state) => state.target, (state, axis, value) => { state.target[axis] = value; }, update);
    controls.push(...positionFields, ...targetFields);

    const aim = button('Aim at subject', () => update('aim', (state) => { state.target = facePoint(ctx.store.doc as SceneDocument); }));
    const advanced = el('details', {}, [el('summary', {}, ['Advanced XYZ']), ...positionFields.map((control) => control.element), ...targetFields.map((control) => control.element)]);
    const modifierFields = group('Output and modifier', controls.slice(0, controls.indexOf(grid)));
    const accessoryFields = group('Accessories', [grid, ...barnFields]);
    const placementFields = group('Placement', [distance, height, azimuth, roll, aim, advanced]);
    lightDetails.replaceChildren(modifierFields, accessoryFields, placementFields);

    const refresh = () => {
      controls.forEach((control) => control.refresh());
      const state = findLight(id);
      const modifier = state ? getModifier(state.modifierId) : null;
      grid.element.hidden = !modifier?.acceptsGrid;
      barnFields.forEach((control) => { control.element.hidden = !modifier?.acceptsBarnDoors; });
    };
    detailControls = controls;
    refresh();
  }

  function buildPropDetails(prop: PropState): void {
    const id = prop.id;
    const controls: Control[] = [];
    const update = (label: string, recipe: (state: PropState) => void) => mutateProp(id, `prop ${id} ${label}`, recipe);
    controls.push(textField({ label: 'Name', get: () => findProp(id)?.name ?? '', set: (value) => update('name', (state) => { state.name = value; }) }));
    controls.push(
      numberField({ label: 'Width', unit: 'm', min: 0.05, max: 10, step: 0.05, precision: 2, get: () => findProp(id)?.widthM ?? 1, set: (value) => update('width', (state) => { state.widthM = value; }) }),
      numberField({ label: 'Height', unit: 'm', min: 0.05, max: 10, step: 0.05, precision: 2, get: () => findProp(id)?.heightM ?? 1, set: (value) => update('height', (state) => { state.heightM = value; }) }),
    );
    const positionFields = vec3Fields('Position', () => findProp(id), (state) => state.position, (state, axis, value) => { state.position[axis] = value; }, update);
    const targetFields = vec3Fields('Target', () => findProp(id), (state) => state.target, (state, axis, value) => { state.target[axis] = value; }, update);
    const roll = numberField({
      label: 'Roll', unit: '°', min: -180, max: 180, step: 1, precision: 1,
      title: '90° lays a stripbox horizontal.',
      get: () => findProp(id)?.rollDeg ?? 0,
      set: (value) => update('roll', (state) => { state.rollDeg = value; }),
    });
    controls.push(...positionFields, ...targetFields, roll);
    let colorControl: Control | null = null;
    if (prop.kind === 'bounce') {
      colorControl = select({
        label: 'Surface',
        options: BOUNCE_COLORS,
        get: () => findProp(id)?.color ?? '#ffffff',
        set: (value) => update('surface', (state) => { state.color = value; }),
      });
      controls.push(colorControl);
    }
    let transmission: Control | null = null;
    if (prop.kind === 'diffusion') {
      transmission = numberField({ label: 'Transmission', min: 0, max: 1, step: 0.01, precision: 2, get: () => findProp(id)?.transmission ?? 0.65, set: (value) => update('transmission', (state) => { state.transmission = value; }) });
      controls.push(transmission);
    }
    const aim = button('Aim at subject', () => update('aim', (state) => { state.target = facePoint(ctx.store.doc as SceneDocument); }));
    const deleteButton = button('Delete prop', () => {
      if (ctx.selection.current?.kind === 'aim') return;
      ctx.store.update((draft) => { draft.props = draft.props.filter((item) => item.id !== id); }, { label: `delete prop ${id}` });
      ctx.selection.set(null);
    });
    propDetails.replaceChildren(
      group('Size and material', [controls[0]!, controls[1]!, controls[2]!, ...(colorControl ? [colorControl] : []), ...(transmission ? [transmission] : [])]),
      group('Placement', [...positionFields, ...targetFields, roll, aim, deleteButton]),
    );
    detailControls = controls;
    controls.forEach((control) => control.refresh());
  }

  function findLight(id: string): LightState | undefined {
    return ctx.store.doc.lights.find((light) => light.id === id);
  }

  function findProp(id: string): PropState | undefined {
    return ctx.store.doc.props.find((prop) => prop.id === id);
  }

  function refreshMeter(): void {
    const doc = ctx.store.doc as SceneDocument;
    const point = facePoint(doc);
    const reading = meterReading(doc, point, meterMode);
    const rows = reading.lights.map((item) => el('div', { class: 'control-row' }, [
      el('span', { class: 'control-label' }, [item.name]),
      el('span', { class: 'control-value' }, [meterAperture(item.luxSeconds, doc.camera.iso)]),
    ]));
    if (reading.ambientLuxSeconds > 0) {
      rows.push(el('div', { class: 'control-row' }, [
        el('span', { class: 'control-label' }, ['Room ambient']),
        el('span', { class: 'control-value' }, [meterAperture(reading.ambientLuxSeconds, doc.camera.iso)]),
      ]));
    }
    const over = Number.isFinite(reading.stopsOver) ? `${signed(reading.stopsOver)} stop${Math.abs(reading.stopsOver) === 1 ? '' : 's'} ${reading.stopsOver >= 0 ? 'over' : 'under'}` : 'no light';
    rows.push(el('div', { class: 'control-row' }, [
      el('span', { class: 'control-label' }, ['Combined']),
      el('span', { class: 'control-value' }, [reading.totalLuxSeconds > 0 ? `${meterAperture(reading.totalLuxSeconds, doc.camera.iso)} · ${over}` : 'No light']),
    ]));
    meterDetails.replaceChildren(...rows);
    ctx.ui.setStatus('meter', `Meter ${reading.totalLuxSeconds > 0 ? meterAperture(reading.totalLuxSeconds, doc.camera.iso) : 'no light'} (${over})`);
  }

  function renderLists(doc: SceneDocument): void {
    const selected = ctx.selection.current;
    const owner = selectedOwner();
    const lightRows = doc.lights.map((light) => {
      const modifier = getModifier(light.modifierId);
      const power = light.output.kind === 'strobe'
        ? `${light.output.fullPowerWs} Ws · ${formatPowerStops(light.output.powerStops)}`
        : `${light.output.watts} W`;
      const item = button(`${light.name} · ${modifier.shortName} · ${power}`, () => ctx.selection.set({ kind: 'light', id: light.id }));
      item.style.gridColumn = '1 / 3';
      item.style.textAlign = 'left';
      item.classList.toggle('active', owner?.kind === 'light' && owner.id === light.id);
      const enabled = el('input', { type: 'checkbox', class: 'control-check', title: 'Enable light' });
      enabled.checked = light.enabled;
      enabled.addEventListener('change', () => mutateLight(light.id, 'enabled', (state) => { state.enabled = enabled.checked; }));
      const row = el('div', { class: 'control-row' }, [item, enabled]);
      return row;
    });
    lightList.replaceChildren(...lightRows);

    const propRows = doc.props.map((prop) => {
      const item = button(`${prop.name} · ${prop.kind} · ${prop.widthM.toFixed(1)} × ${prop.heightM.toFixed(1)} m`, () => ctx.selection.set({ kind: 'prop', id: prop.id }));
      item.style.gridColumn = '1 / 4';
      item.style.textAlign = 'left';
      item.classList.toggle('active', owner?.kind === 'prop' && owner.id === prop.id);
      return el('div', { class: 'control-row' }, [item]);
    });
    propList.replaceChildren(...propRows);

    duplicate.disabled = selected?.kind !== 'light';
    deleteLight.disabled = selected?.kind !== 'light';
    const key = owner?.kind === 'light'
      ? `light:${owner.id}:${doc.lights.find((item) => item.id === owner.id)?.output.kind ?? ''}`
      : owner?.kind === 'prop'
        ? `prop:${owner.id}:${doc.props.find((item) => item.id === owner.id)?.kind ?? ''}`
        : '';
    if (key !== renderedSelection) {
      renderedSelection = key;
      detailControls = [];
      if (owner?.kind === 'light') {
        const light = doc.lights.find((item) => item.id === owner.id);
        propDetails.replaceChildren(el('div', { class: 'control-label' }, ['Select a prop to edit it.']));
        lightDetails.replaceChildren();
        if (light) buildLightDetails(light);
      } else if (owner?.kind === 'prop') {
        const prop = doc.props.find((item) => item.id === owner.id);
        lightDetails.replaceChildren(el('div', { class: 'control-label' }, ['Select a light to edit it.']));
        propDetails.replaceChildren();
        if (prop) buildPropDetails(prop);
      } else {
        lightDetails.replaceChildren(el('div', { class: 'control-label' }, ['Select a light to edit it.']));
        propDetails.replaceChildren(el('div', { class: 'control-label' }, ['Select a prop to edit it.']));
      }
    } else {
      detailControls.forEach((control) => control.refresh());
      const light = owner?.kind === 'light' ? doc.lights.find((item) => item.id === owner.id) : undefined;
      if (light) {
        const modifier = getModifier(light.modifierId);
        const accessoryRows = lightDetails.querySelectorAll('.control-group:nth-child(2) .control-row');
        const gridRow = accessoryRows.item(0) as HTMLElement | null;
        if (gridRow) gridRow.hidden = !modifier.acceptsGrid;
        for (let i = 1; i < accessoryRows.length; i++) (accessoryRows.item(i) as HTMLElement).hidden = !modifier.acceptsBarnDoors;
      }
    }
  }

  const refresh = (doc: SceneDocument) => {
    renderLists(doc);
    refreshMeter();
  };
  ctx.store.subscribe((doc) => refresh(doc));
  ctx.selection.onChange(() => renderLists(ctx.store.doc as SceneDocument));
  renderLists(ctx.store.doc as SceneDocument);
  refreshMeter();
}

function vec3Fields<T extends LightState | PropState>(
  label: string,
  getState: () => T | undefined,
  get: (state: T) => Vec3,
  set: (state: T, axis: 0 | 1 | 2, value: number) => void,
  update: (label: string, recipe: (state: T) => void) => void,
): Control[] {
  return ([0, 1, 2] as const).map((axis) => numberField({
    label: `${label} ${'XYZ'[axis]}`,
    unit: 'm',
    min: -20,
    max: 20,
    step: 0.01,
    precision: 2,
    get: () => {
      const state = getState();
      return state ? get(state)[axis] : 0;
    },
    set: (value) => update(`${label.toLowerCase()} ${'xyz'[axis]}`, (state) => set(state, axis, value)),
  }));
}

function facePoint(doc: SceneDocument): Vec3 {
  return [doc.subject.position[0] + FACE_OFFSET[0], doc.subject.position[1] + FACE_OFFSET[1], doc.subject.position[2] + FACE_OFFSET[2]];
}

function lightPolar(state: LightState | undefined, subject: Vec3): { distance: number; angleDeg: number } {
  if (!state) return { distance: 0, angleDeg: 0 };
  const dx = state.position[0] - subject[0];
  const dz = state.position[2] - subject[2];
  return { distance: Math.hypot(dx, dz), angleDeg: (Math.atan2(dx, dz) * 180) / Math.PI };
}

function setPolarPosition(light: LightState, subject: Vec3, distance?: number, angleDeg?: number): void {
  const old = lightPolar(light, subject);
  const radius = distance ?? old.distance;
  const angle = ((angleDeg ?? old.angleDeg) * Math.PI) / 180;
  light.position[0] = subject[0] + Math.sin(angle) * radius;
  light.position[2] = subject[2] + Math.cos(angle) * radius;
}

function meterAperture(luxSeconds: number, iso: number): string {
  if (luxSeconds <= 0) return 'No light';
  const aperture = Math.sqrt((luxSeconds * iso) / 250);
  const nearest = APERTURE_STOPS.reduce((best, value) => Math.abs(Math.log2(value / aperture)) < Math.abs(Math.log2(best / aperture)) ? value : best, APERTURE_STOPS[0]!);
  const tenthStop = Math.round(2 * Math.log2(aperture / nearest) * 10) / 10;
  const suffix = Math.abs(tenthStop) < 0.05 ? '' : ` ${superscriptDelta(tenthStop)}`;
  return `f/${nearest}${suffix}`;
}

function signed(value: number): string {
  const rounded = Math.round(Math.abs(value) * 10) / 10;
  return `${value >= 0 ? '+' : '−'}${rounded.toFixed(1)}`;
}

function superscriptDelta(value: number): string {
  const digits: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '.': '·' };
  const text = `${value >= 0 ? '+' : '-'}${(Math.round(Math.abs(value) * 10) / 10).toFixed(1)}`;
  return [...text].map((character) => character === '+' ? '⁺' : character === '-' ? '⁻' : digits[character] ?? character).join('');
}
