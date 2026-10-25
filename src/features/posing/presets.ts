import type { Vec3 } from '../../scene/types';

export interface PosePreset {
  name: string;
  bones: Record<string, Vec3>;
  rootOffset: Vec3;
}

/**
 * Conservative offsets authored for the UmaViewer rest skeleton, whose arms extend along
 * ±X and whose bone-local frames are identity rotations.
 */
export const POSE_PRESETS: readonly PosePreset[] = [
  // Clear every bone offset and leave the subject at the document root.
  { name: 'Rest', bones: {}, rootOffset: [0, 0, 0] },
  // Let both arms hang beside the torso with a small forward bend at the elbows.
  {
    name: 'Relaxed standing',
    bones: {
      Arm_L: [-10, 0, -82], Elbow_L: [0, -10, 0],
      Arm_R: [-10, 0, 82], Elbow_R: [0, 10, 0],
    },
    rootOffset: [0, 0, 0],
  },
  // Shift weight to the straighter right leg and counter-tilt the shoulders.
  {
    name: 'Contrapposto',
    bones: {
      Hip: [0, 0, -4], Waist: [0, 0, 4], Spine: [0, 0, 2], Chest: [0, 0, 2],
      Arm_L: [-10, 20, -82], Elbow_L: [0, -10, 0],
      Arm_R: [-10, -20, 82], Elbow_R: [0, 10, 0],
      Knee_L: [0, 0, 5],
    },
    rootOffset: [0, 0, 0.015],
  },
  // Fold the forearms forward onto the waist while keeping the elbows flared out.
  {
    name: 'Hands on hips',
    bones: {
      Arm_L: [30, -30, -45], Elbow_L: [0, -90, 0],
      Arm_R: [30, 30, 45], Elbow_R: [0, 90, 0],
    },
    rootOffset: [0, 0, 0],
  },
  // Turn each upper arm down and fold the forearms across the chest at two heights.
  {
    name: 'Arms crossed',
    bones: {
      Arm_L: [-5, -60, -70], Elbow_L: [0, -110, 0],
      Arm_R: [-5, 60, 70], Elbow_R: [0, 95, 0],
    },
    rootOffset: [0, 0, 0],
  },
  // Turn the torso and head left while keeping both arms in the relaxed pose.
  {
    name: 'Looking over shoulder',
    bones: {
      Spine: [0, 8, 0], Chest: [0, 12, 0], Neck: [0, 12, 0], Head: [0, 22, 0],
      Arm_L: [-10, 0, -82], Elbow_L: [0, -10, 0],
      Arm_R: [-10, 0, 82], Elbow_R: [0, 10, 0],
    },
    rootOffset: [0, 0, 0],
  },
  // Bring the left wrist forward to the chin and leave the right arm hanging.
  {
    name: 'Hand to chin',
    bones: {
      Arm_L: [-15, -60, -55], Elbow_L: [0, -135, 0],
      Arm_R: [-10, 0, 82], Elbow_R: [0, 10, 0],
    },
    rootOffset: [0, 0, 0],
  },
];

export interface ExpressionPreset {
  name: string;
  weights: Record<string, number>;
}

/** Build presets from the loaded model's actual morph names; outfit-specific names vary. */
export function buildExpressionPresets(morphNames: readonly string[]): ExpressionPreset[] {
  return [
    { name: 'Smile', weights: weightsForExpression(morphNames, 'WaraiA') },
    { name: 'Big smile', weights: weightsForBigSmile(morphNames) },
    { name: 'Serious', weights: weightsForExpression(morphNames, 'SeriousA') },
    { name: 'Surprised', weights: weightsForExpression(morphNames, 'OdorokiA') },
    { name: 'Wink L', weights: winkLeft(morphNames) },
    { name: 'Closed eyes', weights: closedEyes(morphNames) },
  ];
}

function weightsForExpression(morphNames: readonly string[], expression: string): Record<string, number> {
  return Object.fromEntries(morphNames
    .filter((name) => expressionName(name) === expression)
    .map((name) => [name, 1]));
}

function weightsForBigSmile(morphNames: readonly string[]): Record<string, number> {
  return Object.fromEntries(morphNames.flatMap((name) => {
    const prefix = name.split('_', 1)[0];
    const expression = expressionName(name);
    const chosen = prefix === 'Mouth' ? 'WaraiE' : 'WaraiD';
    return expression === chosen ? [[name, 1] as const] : [];
  }));
}

function winkLeft(morphNames: readonly string[]): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const name of morphNames) {
    if (/^Eye_\d+_L\(CloseA\)/.test(name) || /^EyeBrow_\d+_L\(WaraiA\)/.test(name)) weights[name] = 1;
    else if (/^Mouth_\d+_0\(WaraiA\)/.test(name)) weights[name] = 1;
  }
  return weights;
}

function closedEyes(morphNames: readonly string[]): Record<string, number> {
  return Object.fromEntries(morphNames
    .filter((name) => /^Eye_\d+_[LR]\(CloseA\)/.test(name))
    .map((name) => [name, 1]));
}

function expressionName(name: string): string | null {
  return name.match(/\(([^)]+)\)/)?.[1] ?? null;
}
