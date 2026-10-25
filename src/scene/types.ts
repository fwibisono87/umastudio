// The scene document: all persistent app state, serialisable as JSON.
//
// Every feature reads and writes this document through the store (core/store.ts) and
// nothing else is shared between features. It is also the save format, so changing a
// shape here means bumping SCENE_VERSION and adding a migration in scene/document.ts.
//
// Conventions (see docs/DESIGN.md, "Units"):
//   - distances in metres, angles in degrees, focal length and sensor size in mm,
//     shutter in seconds, strobe output in Ws, continuous output in W + lm/W
//   - right-handed, Y up, floor at y = 0; the subject stands at the origin facing +Z,
//     so the default camera sits on +Z looking back at her
//   - colours are sRGB hex strings, e.g. "#808080"

export const SCENE_VERSION = 1;

export type Vec3 = [number, number, number];

/** Something placed by position and aimed at a point (camera, lights, props). */
export interface Aimed {
  position: Vec3;
  /** World-space point the object faces. */
  target: Vec3;
  /** Rotation about the aim axis, degrees. */
  rollDeg: number;
}

export interface SceneDocument {
  version: typeof SCENE_VERSION;
  meta: SceneMeta;
  subject: SubjectState;
  camera: CameraState;
  lights: LightState[];
  props: PropState[];
  environment: EnvironmentState;
}

export interface SceneMeta {
  name: string;
  notes: string;
}

// ---------------------------------------------------------------- subject

export interface SubjectState {
  /**
   * File name of the loaded model, for display and shot-map labels only. Model files
   * are never stored in the document (they're the user's, and © Cygames); after loading
   * a saved scene the user drops the model folder in again.
   */
  modelName: string | null;
  /** Where she stands on the floor. */
  position: Vec3;
  /** Turn about the vertical axis, degrees; 0 faces +Z. */
  yawDeg: number;
  pose: PoseState;
  /** Facial morph weights 0..1 by morph name (e.g. "Mouth_Smile"); absent = 0. */
  morphs: Record<string, number>;
}

export interface PoseState {
  /**
   * Local rotation offsets from the rest pose, keyed by canonical bone name (the
   * UmaViewer English names: "Hip", "Spine", "Arm_L", ...). Euler XYZ, degrees, in the
   * bone's local frame. Absent = rest. IK is solved by the posing feature and written
   * back here as plain rotations, so the document never needs IK data.
   */
  bones: Record<string, Vec3>;
  /** Offset of the root/hip from rest, metres (crouching, leaning). */
  rootOffset: Vec3;
}

// ---------------------------------------------------------------- camera

export interface CameraState extends Aimed {
  body: CameraBody;
  lens: LensState;
  /** f-number, e.g. 8 for f/8. */
  aperture: number;
  /** Seconds, e.g. 1/125. */
  shutterS: number;
  iso: number;
  /**
   * White balance, kelvin: a light of this colour temperature renders neutral. 5500 K
   * matches flash and daylight; set it to 3200 K under tungsten.
   */
  whiteBalanceK: number;
}

export interface CameraBody {
  name: string;
  sensorWidthMm: number;
  sensorHeightMm: number;
  /** Fastest shutter speed at which the whole frame is open during a flash, seconds. */
  flashSyncS: number;
}

export interface LensState {
  focalLengthMm: number;
  /** Distance to the focal plane, metres. */
  focusDistanceM: number;
  /** Aperture blade count, for bokeh shape in the HQ render. */
  bladeCount: number;
}

// ---------------------------------------------------------------- lights

export interface LightState extends Aimed {
  /** Stable id, unique within the document. */
  id: string;
  name: string;
  enabled: boolean;
  output: StrobeOutput | ContinuousOutput;
  /** Correlated colour temperature, kelvin. */
  colorTempK: number;
  /** Key into MODIFIERS (scene/modifiers.ts). */
  modifierId: string;
  /** Light-shaping accessories on top of the modifier. */
  accessories: LightAccessories;
}

export interface StrobeOutput {
  kind: 'strobe';
  /** Rated energy at full power, watt-seconds. */
  fullPowerWs: number;
  /**
   * Stops below full power: 0 = 1/1, 1 = 1/2, ... 7 = 1/128. Fractional values are
   * allowed (strobes dial in 1/10-stop steps).
   */
  powerStops: number;
}

export interface ContinuousOutput {
  kind: 'continuous';
  /** Electrical power, watts. */
  watts: number;
  /** Luminous efficacy, lumens per watt (LED ~ 90-130, tungsten ~ 15). */
  lumensPerWatt: number;
}

export interface LightAccessories {
  /** Honeycomb grid, full beam angle in degrees, or null for none. */
  gridDeg: number | null;
  /** Barn doors (only meaningful on open reflectors); each leaf's closing angle, degrees, 0 = open. */
  barnDoors: { top: number; bottom: number; left: number; right: number } | null;
}

// ---------------------------------------------------------------- props

/** Passive set pieces that shape light without emitting any. */
export interface PropState extends Aimed {
  id: string;
  name: string;
  kind: 'bounce' | 'flag' | 'diffusion';
  widthM: number;
  heightM: number;
  /** Bounce: surface colour (white / silver / gold); flag: usually black. */
  color: string;
  /** Diffusion: fraction of light transmitted, 0..1. */
  transmission: number;
}

// ---------------------------------------------------------------- environment

export interface EnvironmentState {
  /** Background paper / wall colour. */
  backdropColor: string;
  /** Diffuse reflectance of the floor, 0..1. */
  floorReflectance: number;
  /** Room light reaching the subject from everywhere, lux (0 = blacked-out studio). */
  ambientLux: number;
}
