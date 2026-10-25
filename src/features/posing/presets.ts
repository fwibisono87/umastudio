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
  { name: 'Rest', bones: {}, rootOffset: [0, 0, 0] },
  {
    name: 'Relaxed standing',
    bones: {
      Arm_L: [0, 0, -82], Elbow_L: [0, 0, -10],
      Arm_R: [0, 0, 82], Elbow_R: [0, 0, 10],
      Shoulder_L: [0, 0, -4], Shoulder_R: [0, 0, 4],
    },
    rootOffset: [0, 0, 0],
  },
  {
    name: 'Contrapposto',
    bones: {
      Hip: [0, 0, -4], Waist: [0, 0, 4], Spine: [0, 0, 2], Chest: [0, 0, 2],
      Arm_L: [0, 0, -78], Elbow_L: [0, 0, -12],
      Arm_R: [0, 0, 82], Elbow_R: [0, 0, 10],
      Knee_L: [0, 0, 5],
    },
    rootOffset: [-0.035, 0, 0.015],
  },
  {
    name: 'Hands on hips',
    bones: {
      Arm_L: [0, 0, -75], Elbow_L: [0, 0, -100], Wrist_L: [0, 0, 16],
      Arm_R: [0, 0, 75], Elbow_R: [0, 0, 100], Wrist_R: [0, 0, -16],
    },
    rootOffset: [0, 0, 0],
  },
  {
    name: 'Arms crossed',
    bones: {
      Arm_L: [0, 0, 26], Elbow_L: [0, 0, 128], Wrist_L: [0, 0, -18],
      Arm_R: [0, 0, -26], Elbow_R: [0, 0, -128], Wrist_R: [0, 0, 18],
    },
    rootOffset: [0, 0, 0],
  },
  {
    name: 'Looking over shoulder',
    bones: { Spine: [0, -8, 0], Chest: [0, -12, 0], Neck: [0, 18, 0], Head: [0, 38, 0] },
    rootOffset: [0, 0, 0],
  },
  {
    name: 'Hand to chin',
    bones: {
      Arm_L: [0, 0, 93], Elbow_L: [0, 0, 76], Wrist_L: [0, 0, -12],
      Shoulder_L: [0, 0, -8],
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
