import { describe, it, expect } from 'vitest'
import { delayToLOS, LOS_THRESHOLDS } from '@/types/evaluation'
import type { LOSGrade } from '@/types/evaluation'

describe('delayToLOS', () => {
  // ---- A: delay ≤ 10s ----
  it('returns A for delay = 0', () => {
    expect(delayToLOS(0)).toBe('A')
  })

  it('returns A for delay = 5 (mid-range)', () => {
    expect(delayToLOS(5)).toBe('A')
  })

  it('returns A for delay = 10 (upper boundary)', () => {
    expect(delayToLOS(10)).toBe('A')
  })

  // ---- B: 10 < delay ≤ 20 ----
  it('returns B for delay = 10.01 (just above A boundary)', () => {
    expect(delayToLOS(10.01)).toBe('B')
  })

  it('returns B for delay = 15 (mid-range)', () => {
    expect(delayToLOS(15)).toBe('B')
  })

  it('returns B for delay = 20 (upper boundary)', () => {
    expect(delayToLOS(20)).toBe('B')
  })

  // ---- C: 20 < delay ≤ 35 ----
  it('returns C for delay = 25 (mid-range)', () => {
    expect(delayToLOS(25)).toBe('C')
  })

  it('returns C for delay = 35 (upper boundary)', () => {
    expect(delayToLOS(35)).toBe('C')
  })

  // ---- D: 35 < delay ≤ 55 ----
  it('returns D for delay = 45 (mid-range)', () => {
    expect(delayToLOS(45)).toBe('D')
  })

  it('returns D for delay = 55 (upper boundary)', () => {
    expect(delayToLOS(55)).toBe('D')
  })

  // ---- E: 55 < delay ≤ 80 ----
  it('returns E for delay = 70 (mid-range)', () => {
    expect(delayToLOS(70)).toBe('E')
  })

  it('returns E for delay = 80 (upper boundary)', () => {
    expect(delayToLOS(80)).toBe('E')
  })

  // ---- F: delay > 80 ----
  it('returns F for delay = 80.01 (just above E boundary)', () => {
    expect(delayToLOS(80.01)).toBe('F')
  })

  it('returns F for delay = 100', () => {
    expect(delayToLOS(100)).toBe('F')
  })

  it('returns F for delay = 1000 (very large)', () => {
    expect(delayToLOS(1000)).toBe('F')
  })

  // ---- Edge cases ----
  it('returns A for negative delay (unusual but should not crash)', () => {
    expect(delayToLOS(-1)).toBe('A')
  })

  it('returns A for very small positive delay', () => {
    expect(delayToLOS(0.001)).toBe('A')
  })

  // ---- All thresholds are covered ----
  it('covers all six LOS grades', () => {
    const grades: LOSGrade[] = ['A', 'B', 'C', 'D', 'E', 'F']
    const delays = [0, 15, 25, 45, 70, 100]
    const results = delays.map(delayToLOS)
    expect(results).toEqual(grades)
  })
})

describe('LOS_THRESHOLDS', () => {
  it('has exactly 6 entries (A through F)', () => {
    expect(LOS_THRESHOLDS).toHaveLength(6)
  })

  it('grades are in order A-F', () => {
    const grades = LOS_THRESHOLDS.map(t => t.grade)
    expect(grades).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  })

  it('max values are strictly increasing (except F which is Infinity)', () => {
    for (let i = 0; i < LOS_THRESHOLDS.length - 2; i++) {
      expect(LOS_THRESHOLDS[i].max).toBeLessThan(LOS_THRESHOLDS[i + 1].max)
    }
    expect(LOS_THRESHOLDS[5].max).toBe(Infinity)
  })
})
