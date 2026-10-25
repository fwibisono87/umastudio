// Creating, copying and loading scene documents.

import { SCENE_VERSION, type LightState, type SceneDocument } from './types';

/**
 * A one-light portrait setup: 85 mm at 3.5 m, f/8 1/125 ISO 100, a 500 Ws strobe in a
 * 90×120 softbox 45° camera-right (+X is the photographer's right when the camera
 * looks down -Z). The subject stands at the origin facing +Z.
 */
export function createDefaultScene(): SceneDocument {
  return {
    version: SCENE_VERSION,
    meta: { name: 'Untitled set', notes: '' },
    subject: {
      modelName: null,
      position: [0, 0, 0],
      yawDeg: 0,
      pose: { bones: {}, rootOffset: [0, 0, 0] },
      morphs: {},
    },
    camera: {
      position: [0, 1.45, 3.5],
      target: [0, 1.3, 0],
      rollDeg: 0,
      body: { name: 'Full frame', sensorWidthMm: 36, sensorHeightMm: 24, flashSyncS: 1 / 200 },
      lens: { focalLengthMm: 85, focusDistanceM: 3.5, bladeCount: 9 },
      aperture: 8,
      shutterS: 1 / 125,
      iso: 100,
      whiteBalanceK: 5500,
    },
    lights: [
      createLight('key', 'Key', {
        position: [1.5, 2.0, 1.5],
        modifierId: 'softbox-90x120',
      }),
    ],
    props: [],
    environment: {
      backdropColor: '#8a8d91',
      floorReflectance: 0.3,
      ambientLux: 0,
    },
  };
}

/** A strobe aimed at the subject's face; override any field. */
export function createLight(id: string, name: string, overrides: Partial<LightState> = {}): LightState {
  return {
    id,
    name,
    enabled: true,
    position: [1.5, 2.0, 1.5],
    target: [0, 1.4, 0],
    rollDeg: 0,
    output: { kind: 'strobe', fullPowerWs: 500, powerStops: 0 },
    colorTempK: 5500,
    modifierId: 'softbox-90x120',
    accessories: { gridDeg: null, barnDoors: null },
    ...overrides,
  };
}

/** An id not yet used by any light or prop in `doc`, e.g. "light-3". */
export function nextId(doc: SceneDocument, prefix: string): string {
  const used = new Set([...doc.lights.map((l) => l.id), ...doc.props.map((p) => p.id)]);
  for (let i = 1; ; i++) {
    const id = `${prefix}-${i}`;
    if (!used.has(id)) return id;
  }
}

export function cloneScene(doc: SceneDocument): SceneDocument {
  return structuredClone(doc);
}

/**
 * Parses a saved scene (JSON text or an already-parsed object), migrating older
 * versions. Throws with a readable message if it isn't a scene. Missing fields are
 * filled from the defaults so documents saved before a field existed still load.
 */
export function parseScene(input: string | unknown): SceneDocument {
  const raw: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  if (!isObject(raw) || typeof raw.version !== 'number') {
    throw new Error('Not a umastudio scene file');
  }
  if (raw.version > SCENE_VERSION) {
    throw new Error(`Scene was saved by a newer umastudio (version ${raw.version})`);
  }
  // Migrations go here, oldest first: if (raw.version === 1) { ...; raw.version = 2 }
  return mergeDefaults(createDefaultScene(), raw) as SceneDocument;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

// Recursively fills keys missing from `value` with `defaults`. Arrays and maps keyed by
// user data (bones, morphs) are taken from `value` as-is.
function mergeDefaults(defaults: unknown, value: unknown): unknown {
  if (value === undefined) return defaults;
  if (!isObject(defaults) || !isObject(value)) return value;
  const out: Record<string, unknown> = { ...value };
  for (const [k, d] of Object.entries(defaults)) {
    out[k] = k === 'bones' || k === 'morphs' ? (value[k] ?? d) : mergeDefaults(d, value[k]);
  }
  return out;
}
