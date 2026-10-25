/** Japanese MMD names map to the stable game-style names used by posing controls. */
const entries: [string, string][] = [
  ['センター', 'Position'],
  ['下半身', 'Hip'],
  ['上半身', 'Spine'],
  ['上半身2', 'Chest'],
  ['上半身２', 'Chest'],
  ['首', 'Neck'],
  ['頭', 'Head'],
  ['左肩', 'Shoulder_L'],
  ['左腕', 'Arm_L'],
  ['左ひじ', 'Elbow_L'],
  ['左肘', 'Elbow_L'],
  ['左手首', 'Wrist_L'],
  ['左足', 'Thigh_L'],
  ['左ひざ', 'Knee_L'],
  ['左膝', 'Knee_L'],
  ['左足首', 'Ankle_L'],
  ['左つま先', 'Toe_L'],
  ['右肩', 'Shoulder_R'],
  ['右腕', 'Arm_R'],
  ['右ひじ', 'Elbow_R'],
  ['右肘', 'Elbow_R'],
  ['右手首', 'Wrist_R'],
  ['右足', 'Thigh_R'],
  ['右ひざ', 'Knee_R'],
  ['右膝', 'Knee_R'],
  ['右足首', 'Ankle_R'],
  ['右つま先', 'Toe_R'],
  ['左目', 'Eye_L'],
  ['右目', 'Eye_R'],
];

const fingers = [
  { japanese: '親指', english: 'Thumb', digits: ['０', '１', '２'] },
  { japanese: '人指', english: 'Index', digits: ['１', '２', '３'] },
  { japanese: '人差指', english: 'Index', digits: ['１', '２', '３'] },
  { japanese: '中指', english: 'Middle', digits: ['１', '２', '３'] },
  { japanese: '薬指', english: 'Ring', digits: ['１', '２', '３'] },
  { japanese: '小指', english: 'Pinky', digits: ['１', '２', '３'] },
] as const;

for (const [japaneseSide, side] of [['左', 'L'], ['右', 'R']] as const) {
  for (const finger of fingers) {
    finger.digits.forEach((digit, index) => {
      const gameSegment = String(index + 1).padStart(2, '0');
      entries.push([`${japaneseSide}${finger.japanese}${digit}`, `${finger.english}_${gameSegment}_${side}`]);
      const asciiDigit = finger.english === 'Thumb' ? String(index) : String(index + 1);
      entries.push([`${japaneseSide}${finger.japanese}${asciiDigit}`, `${finger.english}_${gameSegment}_${side}`]);
    });
  }
}

export const BONE_NAME_MAP: ReadonlyMap<string, string> = new Map(entries);

/** Unknown and already-English UmaViewer names remain unchanged. */
export function canonicalBoneName(name: string): string {
  return BONE_NAME_MAP.get(name) ?? name;
}
