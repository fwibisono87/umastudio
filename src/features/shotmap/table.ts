// The shot map settings table: `settingsRows` turns the scene document into plain data
// (pure, unit-testable in node), `renderSettingsTable` renders those rows as an HTML
// table for the dialog and the print view.

import { getModifier } from '../../scene/modifiers';
import { meterReading } from '../../scene/lightModel';
import { incidentAperture } from '../../scene/photometry';
import type { LightState, PropState, SceneDocument } from '../../scene/types';
import { APERTURE_STOPS, formatAperture, formatPowerStops, formatShutter, nearestStop } from '../../scene/units';
import { angleFromCameraAxisDeg, distance3, heightOf } from './geometry';

export interface PairRow {
  kind: 'pair';
  section: 'Camera' | 'Environment';
  label: string;
  value: string;
  /** CSS colour shown as a swatch before the value (backdrop colour). */
  swatch?: string;
}

export interface LightRow {
  kind: 'light';
  section: 'Lights';
  name: string;
  type: 'Strobe' | 'Continuous';
  output: string;
  modifier: string;
  colorTemp: string;
  incident: string;
  distanceM: string;
  heightM: string;
  /** e.g. "45° camera-left". */
  angle: string;
}

export interface PropRow {
  kind: 'prop';
  section: 'Props';
  name: string;
  propKind: string;
  size: string;
}

export type SettingsRow = PairRow | LightRow | PropRow;

export function settingsRows(doc: SceneDocument): SettingsRow[] {
  const subject = doc.subject.position;
  const cam = doc.camera;
  const cameraRows: PairRow[] = [
    { kind: 'pair', section: 'Camera', label: 'Body', value: cam.body.name },
    {
      kind: 'pair',
      section: 'Camera',
      label: 'Sensor',
      value: `${num(cam.body.sensorWidthMm)} × ${num(cam.body.sensorHeightMm)} mm`,
    },
    { kind: 'pair', section: 'Camera', label: 'Focal length', value: `${num(cam.lens.focalLengthMm)} mm` },
    { kind: 'pair', section: 'Camera', label: 'Aperture', value: formatAperture(cam.aperture) },
    { kind: 'pair', section: 'Camera', label: 'Shutter', value: formatShutter(cam.shutterS) },
    { kind: 'pair', section: 'Camera', label: 'ISO', value: num(cam.iso) },
    { kind: 'pair', section: 'Camera', label: 'White balance', value: `${num(cam.whiteBalanceK)} K` },
    { kind: 'pair', section: 'Camera', label: 'Focus distance', value: metres(cam.lens.focusDistanceM) },
    { kind: 'pair', section: 'Camera', label: 'Distance to subject', value: metres(distance3(cam.position, subject)) },
    { kind: 'pair', section: 'Camera', label: 'Height', value: metres(heightOf(cam.position)) },
  ];

  const face: [number, number, number] = [subject[0], subject[1] + 1.35, subject[2]];
  const meter = meterReading(doc, face, 'toward-camera');
  const readings = new Map(meter.lights.map((reading) => [reading.id, reading.luxSeconds]));
  const lightRows: LightRow[] = doc.lights.map((light) => lightRow(doc, light, readings.get(light.id)));

  const propRows: PropRow[] = doc.props.map((prop) => ({
    kind: 'prop',
    section: 'Props',
    name: prop.name,
    propKind: propKindLabel(prop.kind),
    size: `${dec1(prop.widthM)} × ${dec1(prop.heightM)} m`,
  }));

  const environmentRows: PairRow[] = [
    {
      kind: 'pair',
      section: 'Environment',
      label: 'Backdrop colour',
      value: doc.environment.backdropColor,
      swatch: doc.environment.backdropColor,
    },
    { kind: 'pair', section: 'Environment', label: 'Ambient', value: `${num(doc.environment.ambientLux)} lux` },
  ];

  return [...cameraRows, ...lightRows, ...propRows, ...environmentRows];
}

function lightRow(doc: SceneDocument, light: LightState, incidentLuxSeconds: number | undefined): LightRow {
  return {
    kind: 'light',
    section: 'Lights',
    name: light.name,
    type: light.output.kind === 'strobe' ? 'Strobe' : 'Continuous',
    output: outputLabel(light),
    modifier: fullModifierLabel(light),
    colorTemp: `${num(light.colorTempK)} K`,
    incident: light.enabled && incidentLuxSeconds !== undefined ? meterAperture(incidentLuxSeconds, doc.camera.iso) : 'Off',
    distanceM: metres(distance3(light.position, doc.subject.position)),
    heightM: metres(heightOf(light.position)),
    angle: angleLabel(angleFromCameraAxisDeg(doc, light.position)),
  };
}

function outputLabel(light: LightState): string {
  const o = light.output;
  return o.kind === 'strobe' ? `${num(o.fullPowerWs)} Ws · ${formatPowerStops(o.powerStops)}` : `${num(o.watts)} W`;
}

function fullModifierLabel(light: LightState): string {
  const modifier = getModifier(light.modifierId);
  const extras: string[] = [];
  if (light.accessories.gridDeg != null) extras.push(`grid ${num(light.accessories.gridDeg)}°`);
  if (light.accessories.barnDoors != null) extras.push('barn doors');
  return extras.length ? `${modifier.name} + ${extras.join(' + ')}` : modifier.name;
}

/** "45° camera-left", "45° camera-right", "0° on axis". */
export function angleLabel(angleDeg: number): string {
  const side = angleDeg < -0.5 ? 'camera-left' : angleDeg > 0.5 ? 'camera-right' : 'on axis';
  return `${Math.round(Math.abs(angleDeg))}° ${side}`;
}

function propKindLabel(kind: PropState['kind']): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function metres(v: number): string {
  return `${dec1(v)} m`;
}

function dec1(v: number): string {
  return (Math.round(v * 10) / 10).toFixed(1);
}

function num(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function meterAperture(luxSeconds: number, iso: number): string {
  if (luxSeconds <= 0) return 'No light';
  const aperture = incidentAperture(luxSeconds, iso);
  return formatAperture(nearestStop(aperture, APERTURE_STOPS));
}

// ---------------------------------------------------------------- DOM rendering

const SECTIONS = ['Camera', 'Lights', 'Props', 'Environment'] as const;
const TABLE_COLUMNS = 9;

export function renderSettingsTable(rows: readonly SettingsRow[]): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'shotmap-settings';
  const body = document.createElement('tbody');
  table.append(body);

  for (const section of SECTIONS) {
    const sectionRows = rows.filter((r) => r.section === section);
    if (sectionRows.length === 0) continue;
    body.append(sectionHeader(section));
    const first = sectionRows[0];
    if (first && first.kind === 'pair') {
      for (const row of sectionRows) {
        if (row.kind !== 'pair') continue;
        const label = document.createElement('th');
        label.scope = 'row';
        label.textContent = row.label;
        const value = document.createElement('td');
        value.colSpan = TABLE_COLUMNS - 1;
        if (row.swatch) {
          const swatch = document.createElement('span');
          swatch.className = 'shotmap-swatch';
          swatch.style.background = row.swatch;
          value.append(swatch, ` ${row.value}`);
        } else {
          value.textContent = row.value;
        }
        const tr = document.createElement('tr');
        tr.className = 'shotmap-pair';
        tr.append(label, value);
        body.append(tr);
      }
    } else if (first && first.kind === 'light') {
      body.append(columnHeader(['Name', 'Type', 'Output', 'Modifier', 'CCT', 'Meter', 'Distance', 'Height', 'Angle']));
      for (const row of sectionRows) {
        if (row.kind !== 'light') continue;
        body.append(dataRow([row.name, row.type, row.output, row.modifier, row.colorTemp, row.incident, row.distanceM, row.heightM, row.angle]));
      }
    } else if (first && first.kind === 'prop') {
      body.append(columnHeader(['Name', 'Kind', 'Size']));
      for (const row of sectionRows) {
        if (row.kind !== 'prop') continue;
        body.append(dataRow([row.name, row.propKind, row.size]));
      }
    }
  }
  return table;
}

function sectionHeader(title: string): HTMLTableRowElement {
  const th = document.createElement('th');
  th.colSpan = TABLE_COLUMNS;
  th.textContent = title;
  const tr = document.createElement('tr');
  tr.className = 'shotmap-section';
  tr.append(th);
  return tr;
}

function columnHeader(titles: string[]): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.className = 'shotmap-cols';
  for (const title of titles) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = title;
    tr.append(th);
  }
  return tr;
}

function dataRow(cells: string[]): HTMLTableRowElement {
  const tr = document.createElement('tr');
  for (const value of cells) {
    const td = document.createElement('td');
    td.textContent = value;
    tr.append(td);
  }
  return tr;
}
