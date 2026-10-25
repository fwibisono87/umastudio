import { describe, expect, it } from 'vitest';
import { canonicalBoneName } from './boneMap';

describe('canonicalBoneName', () => {
  it('maps standard Japanese MMD body and limb names to game names', () => {
    expect(canonicalBoneName('センター')).toBe('Position');
    expect(canonicalBoneName('下半身')).toBe('Hip');
    expect(canonicalBoneName('上半身2')).toBe('Chest');
    expect(canonicalBoneName('左肩')).toBe('Shoulder_L');
    expect(canonicalBoneName('右ひざ')).toBe('Knee_R');
    expect(canonicalBoneName('左足首')).toBe('Ankle_L');
  });

  it('maps fullwidth and ASCII finger digits and preserves known game names', () => {
    expect(canonicalBoneName('左親指０')).toBe('Thumb_01_L');
    expect(canonicalBoneName('左親指1')).toBe('Thumb_02_L');
    expect(canonicalBoneName('右人指３')).toBe('Index_03_R');
    expect(canonicalBoneName('左薬指2')).toBe('Ring_02_L');
    expect(canonicalBoneName('Head')).toBe('Head');
    expect(canonicalBoneName('Sp_Hi_MSkirt0_B_00')).toBe('Sp_Hi_MSkirt0_B_00');
  });
});
