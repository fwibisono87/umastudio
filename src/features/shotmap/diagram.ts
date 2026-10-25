// The shot map diagram: a top-down SVG built as a plain string, so it renders in the
// dialog, exports to PNG/SVG and unit-tests in node without any DOM.
//
// Plan coordinates are metres (plan x = world x, plan y = world z, +Z at the bottom of
// the page); everything is scaled to pixels by `pixelsPerMetre` (100 px per metre by
// default) and the viewBox is fitted to planBounds.

import { getModifier, type ModifierPreset } from '../../scene/modifiers';
import type { LightState, PropState, SceneDocument } from '../../scene/types';
import { formatAperture, formatPowerStops, formatShutter, RAD2DEG } from '../../scene/units';
import {
  away,
  distance2,
  heightOf,
  horizontalFovDeg,
  planBounds,
  toPlan,
  type PlanPoint,
} from './geometry';

export interface DiagramOptions {
  /** Diagram resolution, pixels per metre. */
  pixelsPerMetre?: number;
}

const FONT = 'sans-serif';
const GRID_M = 1;
const INK = '#333333';
const DIM = '#8a8f96';
const BEAM_FILL = 'rgba(232, 163, 61, 0.13)';
const FOV_FILL = 'rgba(90, 150, 210, 0.12)';

export function renderDiagramSvg(doc: SceneDocument, options: DiagramOptions = {}): string {
  const s = options.pixelsPerMetre ?? 100;
  const b = planBounds(doc);
  const x0 = b.minX * s;
  const y0 = b.minY * s;
  const w = (b.maxX - b.minX) * s;
  const h = (b.maxY - b.minY) * s;

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${[x0, y0, w, h].map(num).join(' ')}" width="${num(w)}" height="${num(h)}" font-family="${FONT}">`,
  );
  out.push(`<rect x="${num(x0)}" y="${num(y0)}" width="${num(w)}" height="${num(h)}" fill="#ffffff"/>`);
  out.push(grid(b, s));
  out.push(backdrop(s));
  out.push(cameraWedge(doc, s));
  for (const light of doc.lights) out.push(lightBeam(light, s));
  for (const prop of doc.props) out.push(propShape(prop, s));
  out.push(subjectMark(doc, s));
  out.push(cameraMark(doc, s));
  for (const light of doc.lights) out.push(lightMark(light, doc, s));
  for (const prop of doc.props) out.push(propLabel(prop, doc, s));
  out.push(scaleBar(b, s));
  out.push('</svg>');
  return out.join('\n');
}

// ---------------------------------------------------------------- primitives

function num(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function dec1(v: number): string {
  return (Math.round(v * 10) / 10).toFixed(1);
}

/** Escapes user text for SVG/XML. Names and notes are user input. */
function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function text(
  content: string,
  at: PlanPoint,
  s: number,
  o: { size?: number; fill?: string; anchor?: string; weight?: string } = {},
): string {
  const attrs = [
    `x="${num(at[0] * s)}"`,
    `y="${num(at[1] * s)}"`,
    `font-size="${o.size ?? 12}"`,
    `fill="${o.fill ?? INK}"`,
    `text-anchor="${o.anchor ?? 'middle'}"`,
    'stroke="none"',
  ];
  if (o.weight) attrs.push(`font-weight="${o.weight}"`);
  return `<text ${attrs.join(' ')}>${escapeText(content)}</text>`;
}

function grid(b: { minX: number; maxX: number; minY: number; maxY: number }, s: number): string {
  const lines: string[] = [];
  for (let x = Math.ceil(b.minX); x <= Math.floor(b.maxX); x += GRID_M) {
    lines.push(`<line x1="${num(x * s)}" y1="${num(b.minY * s)}" x2="${num(x * s)}" y2="${num(b.maxY * s)}"/>`);
  }
  for (let y = Math.ceil(b.minY); y <= Math.floor(b.maxY); y += GRID_M) {
    lines.push(`<line x1="${num(b.minX * s)}" y1="${num(y * s)}" x2="${num(b.maxX * s)}" y2="${num(y * s)}"/>`);
  }
  return `<g stroke="#e4e6e8" stroke-width="1" data-kind="grid">${lines.join('')}</g>`;
}

function scaleBar(b: { minX: number; maxX: number; minY: number; maxY: number }, s: number): string {
  const x = (b.minX + 0.35) * s;
  const y = (b.maxY - 0.45) * s;
  const len = s; // 1 metre
  return [
    `<g stroke="${INK}" stroke-width="2" data-kind="scale">`,
    `<line x1="${num(x)}" y1="${num(y)}" x2="${num(x + len)}" y2="${num(y)}"/>`,
    `<line x1="${num(x)}" y1="${num(y - 5)}" x2="${num(x)}" y2="${num(y + 5)}"/>`,
    `<line x1="${num(x + len)}" y1="${num(y - 5)}" x2="${num(x + len)}" y2="${num(y + 5)}"/>`,
    '</g>',
    text('1 m', [b.minX + 0.85, b.maxY - 0.62], s, { fill: INK, anchor: 'start' }),
  ].join('');
}

function backdrop(s: number): string {
  // The paper sweep (buildSweepGeometry in src/core/studio.ts): 3.6 m wide, from z = -1.5
  // back to the wall at z = -3.
  return [
    `<g data-kind="backdrop">`,
    `<rect x="${num(-1.8 * s)}" y="${num(-3 * s)}" width="${num(3.6 * s)}" height="${num(1.5 * s)}" fill="#ececee" stroke="#c9ccd0" stroke-width="1.5"/>`,
    text('Backdrop', [0, -2.25], s, { fill: DIM }),
    '</g>',
  ].join('');
}

// ---------------------------------------------------------------- subject

function subjectMark(doc: SceneDocument, s: number): string {
  const [x, y] = toPlan(doc.subject.position);
  const cx = x * s;
  const cy = y * s;
  const r = 0.225 * s; // 0.45 m diameter
  // yaw 0 faces +Z, i.e. down the page; a positive yaw turns her toward +X, which is a
  // clockwise-from-down turn on the page, hence rotate(-yaw).
  const turn = -doc.subject.yawDeg;
  const label = doc.subject.modelName ?? 'Subject';
  return [
    `<g data-kind="subject" stroke="${INK}" stroke-width="2">`,
    `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" fill="#f4f5f6"/>`,
    `<g transform="rotate(${num(turn)} ${num(cx)} ${num(cy)})">`,
    `<polygon points="${num(cx)},${num(cy + r * 1.45)} ${num(cx - r * 0.4)},${num(cy + r * 0.55)} ${num(cx + r * 0.4)},${num(cy + r * 0.55)}" fill="${INK}" stroke="none"/>`,
    '</g>',
    text(label, [x, y + 0.55], s, { size: 12, fill: INK, weight: 'bold' }),
    '</g>',
  ].join('');
}

// ---------------------------------------------------------------- camera

function cameraWedge(doc: SceneDocument, s: number): string {
  const c = toPlan(doc.camera.position);
  const t = toPlan(doc.camera.target);
  const half = horizontalFovDeg(doc.camera.lens.focalLengthMm, doc.camera.body.sensorWidthMm) / 2;
  const length = distance2(c, t) + 1;
  return wedge(c, aimDeg(c, t), half, length, FOV_FILL, s, 'camera-beam');
}

function cameraMark(doc: SceneDocument, s: number): string {
  const c = toPlan(doc.camera.position);
  const t = toPlan(doc.camera.target);
  const turn = aimDeg(c, t);
  const subject = toPlan(doc.subject.position);
  const body = [
    `<rect x="${num(-0.3 * s)}" y="${num(-0.17 * s)}" width="${num(0.34 * s)}" height="${num(0.34 * s)}" fill="#dfe3e8"/>`,
    `<polygon points="${num(0.04 * s)},${num(-0.1 * s)} ${num(0.22 * s)},0 ${num(0.04 * s)},${num(0.1 * s)}" fill="#dfe3e8"/>`,
    `<line x1="0" y1="0" x2="${num(0.22 * s)}" y2="0" stroke-width="1"/>`,
  ].join('');
  const cam = doc.camera;
  const label = `${num(cam.lens.focalLengthMm)} mm · ${formatAperture(cam.aperture)} · ${formatShutter(cam.shutterS)} · ISO ${num(cam.iso)}`;
  return [
    `<g data-kind="camera" stroke="${INK}" stroke-width="2" stroke-linejoin="round">`,
    `<g transform="translate(${num(c[0] * s)} ${num(c[1] * s)}) rotate(${num(turn)})">${body}</g>`,
    text(label, away(subject, c, 0.75), s, { size: 12, fill: INK }),
    '</g>',
  ].join('');
}

// ---------------------------------------------------------------- lights

function lightBeam(light: LightState, s: number): string {
  const p = toPlan(light.position);
  const t = toPlan(light.target);
  const modifier = getModifier(light.modifierId);
  const beam = beamAngleDeg(light, modifier);
  const colour = light.enabled ? BEAM_FILL : 'rgba(150, 150, 150, 0.1)';
  const dash = light.enabled ? '' : ' stroke="#9aa0a6" stroke-dasharray="6 5"';
  return `<g data-light-beam="${escapeText(light.id)}"${dash}>${wedge(p, aimDeg(p, t), beam / 2, distance2(p, t), colour, s)}</g>`;
}

function lightMark(light: LightState, doc: SceneDocument, s: number): string {
  const modifier = getModifier(light.modifierId);
  const p = toPlan(light.position);
  const t = toPlan(light.target);
  const turn = aimDeg(p, t);
  const subject = toPlan(doc.subject.position);
  const ink = light.enabled ? INK : '#9aa0a6';
  const face = light.enabled ? '#f6f1e7' : '#e8e8e8';
  const dash = light.enabled ? '' : ' stroke-dasharray="6 5"';
  const icon = `<g transform="translate(${num(p[0] * s)} ${num(p[1] * s)}) rotate(${num(turn)})">${modifierIcon(modifier, s, face)}</g>`;
  return [
    `<g data-light-id="${escapeText(light.id)}" stroke="${ink}" stroke-width="2" stroke-linejoin="round"${dash}>`,
    icon,
    text(light.name, labelPoint(subject, p, modifier, 0, s), s, { size: 12, fill: ink, weight: 'bold' }),
    text(outputLabel(light), labelPoint(subject, p, modifier, 1, s), s, { size: 11, fill: ink }),
    text(modifierLabel(light, modifier), labelPoint(subject, p, modifier, 2, s), s, { size: 11, fill: ink }),
    text(`h ${dec1(heightOf(light.position))} m`, labelPoint(subject, p, modifier, 3, s), s, { size: 11, fill: ink }),
    '</g>',
  ].join('');
}

function beamAngleDeg(light: LightState, modifier: ModifierPreset): number {
  const grid = light.accessories.gridDeg;
  return grid != null && grid < modifier.beamAngleDeg ? grid : modifier.beamAngleDeg;
}

function outputLabel(light: LightState): string {
  const o = light.output;
  return o.kind === 'strobe' ? `${num(o.fullPowerWs)} Ws · ${formatPowerStops(o.powerStops)}` : `${num(o.watts)} W`;
}

function modifierLabel(light: LightState, modifier: ModifierPreset): string {
  const grid = light.accessories.gridDeg;
  return grid != null ? `${modifier.shortName} + grid ${num(grid)}°` : modifier.shortName;
}

/** Where a light's label block goes: offset away from the subject so it clears the icon. */
function labelPoint(subject: PlanPoint, p: PlanPoint, modifier: ModifierPreset, line: number, s: number): PlanPoint {
  const anchor = away(subject, p, Math.max(modifier.widthM, 0.1) / 2 + 0.7);
  const lineHeight = 13 / s; // 13 px between lines
  return [anchor[0], anchor[1] + (line - 1.5) * lineHeight];
}

function modifierIcon(m: ModifierPreset, s: number, fill: string): string {
  const w = m.widthM * s;
  const depth = Math.max(m.depthM, 0.04) * s;
  switch (m.category) {
    case 'bare':
      return `<circle r="${num(Math.max(w / 2, 3))}" fill="${fill}"/>`;
    case 'reflector':
    case 'dish':
      return `<polygon points="${num(-depth)},0 ${num(-depth * 0.2)},${num(-w / 2)} ${num(-depth * 0.2)},${num(w / 2)}" fill="${fill}"/>`;
    case 'softbox':
    case 'stripbox':
      return `<rect x="${num(-depth)}" y="${num(-w / 2)}" width="${num(depth)}" height="${num(w)}" fill="${fill}"/>`;
    case 'octabox':
      return `<polygon points="${octagon(w / 2).join(' ')}" fill="${fill}"/>`;
    case 'umbrella':
      return `<path d="M 0 ${num(-w / 2)} Q ${num(w * 0.55)} 0 0 ${num(w / 2)}" fill="none"/>`;
    case 'snoot':
      return `<rect x="${num(-depth)}" y="${num(-Math.max(w / 2, 0.03 * s))}" width="${num(depth)}" height="${num(Math.max(w, 0.06 * s))}" fill="${fill}"/>`;
  }
}

function octagon(radius: number): string[] {
  const points: string[] = [];
  for (let i = 0; i < 8; i++) {
    const a = ((22.5 + i * 45) * Math.PI) / 180;
    points.push(`${num(Math.cos(a) * radius)},${num(Math.sin(a) * radius)}`);
  }
  return points;
}

// ---------------------------------------------------------------- props

function propShape(prop: PropState, s: number): string {
  const p = toPlan(prop.position);
  const t = toPlan(prop.target);
  const turn = aimDeg(p, t);
  const w = prop.widthM * s;
  const thickness = 0.1 * s;
  let shape: string;
  if (prop.kind === 'bounce') {
    shape = `<rect x="${num(-thickness / 2)}" y="${num(-w / 2)}" width="${num(thickness)}" height="${num(w)}" fill="#ffffff" stroke="${INK}" stroke-width="2"/>`;
  } else if (prop.kind === 'flag') {
    shape = `<line x1="0" y1="${num(-w / 2)}" x2="0" y2="${num(w / 2)}" stroke="#1c1e20" stroke-width="${num(thickness)}"/>`;
  } else {
    shape = `<line x1="0" y1="${num(-w / 2)}" x2="0" y2="${num(w / 2)}" stroke="${DIM}" stroke-width="${num(thickness)}" stroke-dasharray="7 6"/>`;
  }
  return `<g data-prop-id="${escapeText(prop.id)}"><g transform="translate(${num(p[0] * s)} ${num(p[1] * s)}) rotate(${num(turn)})">${shape}</g></g>`;
}

function propLabel(prop: PropState, doc: SceneDocument, s: number): string {
  const subject = toPlan(doc.subject.position);
  const p = toPlan(prop.position);
  return text(prop.name, away(subject, p, prop.widthM / 2 + 0.45), s, { size: 11, fill: INK });
}

// ---------------------------------------------------------------- wedges

function wedge(
  apex: PlanPoint,
  centreDeg: number,
  halfDeg: number,
  lengthM: number,
  fill: string,
  s: number,
  kind?: string,
): string {
  const a0 = ((centreDeg - halfDeg) * Math.PI) / 180;
  const a1 = ((centreDeg + halfDeg) * Math.PI) / 180;
  const p1 = [apex[0] + Math.cos(a0) * lengthM, apex[1] + Math.sin(a0) * lengthM] as PlanPoint;
  const p2 = [apex[0] + Math.cos(a1) * lengthM, apex[1] + Math.sin(a1) * lengthM] as PlanPoint;
  const kindAttr = kind ? ` data-kind="${kind}"` : '';
  return (
    `<polygon${kindAttr} points="${num(apex[0] * s)},${num(apex[1] * s)} ${num(p1[0] * s)},${num(p1[1] * s)} ${num(p2[0] * s)},${num(p2[1] * s)}" fill="${fill}"/>`
  );
}

/** Plan angle of a → b in degrees, as an SVG rotate() angle (x right, y down). */
function aimDeg(a: PlanPoint, b: PlanPoint): number {
  return Math.atan2(b[1] - a[1], b[0] - a[0]) * RAD2DEG;
}
