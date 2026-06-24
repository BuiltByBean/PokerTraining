import { describe, expect, it } from 'vitest';
import { jitter, profileForLevel, type SkillProfile } from '../src/bots/skill';

const KEYS: (keyof SkillProfile)[] = [
  'tightness', 'aggression', 'bluffFreq', 'drawDiscipline', 'potOddsAdherence', 'mistakeRate', 'sizingNoise',
];

describe('profileForLevel', () => {
  it('keeps every dial within [0,1] across all levels', () => {
    for (let lvl = 1; lvl <= 10; lvl++) {
      const p = profileForLevel(lvl);
      for (const k of KEYS) {
        expect(p[k]).toBeGreaterThanOrEqual(0);
        expect(p[k]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('rising dials increase with level, falling dials decrease', () => {
    const lo = profileForLevel(1);
    const hi = profileForLevel(10);
    expect(hi.tightness).toBeGreaterThan(lo.tightness);
    expect(hi.aggression).toBeGreaterThan(lo.aggression);
    expect(hi.bluffFreq).toBeGreaterThan(lo.bluffFreq);
    expect(hi.drawDiscipline).toBeGreaterThan(lo.drawDiscipline);
    expect(hi.potOddsAdherence).toBeGreaterThan(lo.potOddsAdherence);
    expect(hi.mistakeRate).toBeLessThan(lo.mistakeRate); // experts punt less
    expect(hi.sizingNoise).toBeLessThan(lo.sizingNoise);
  });

  it('is monotonic in pot-odds adherence', () => {
    let prev = -1;
    for (let lvl = 1; lvl <= 10; lvl++) {
      const v = profileForLevel(lvl).potOddsAdherence;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('clamps out-of-range levels', () => {
    expect(profileForLevel(0)).toEqual(profileForLevel(1));
    expect(profileForLevel(99)).toEqual(profileForLevel(10));
  });
});

describe('jitter', () => {
  it('stays within [0,1] and is deterministic for a seed', () => {
    const base = profileForLevel(5);
    const a = jitter(base, 123);
    const b = jitter(base, 123);
    expect(a).toEqual(b);
    for (const k of KEYS) {
      expect(a[k]).toBeGreaterThanOrEqual(0);
      expect(a[k]).toBeLessThanOrEqual(1);
    }
  });

  it('different seeds give different profiles', () => {
    const base = profileForLevel(5);
    expect(jitter(base, 1)).not.toEqual(jitter(base, 2));
  });
});
