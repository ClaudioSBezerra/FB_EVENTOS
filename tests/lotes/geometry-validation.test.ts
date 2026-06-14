// FB_EVENTOS — Geometry validation + shoelace area tests
// (Phase 1, Plan 01-03 — Task 1).
//
// Four load-bearing cases:
//
//   1. Valid polygon2d v1 (3+ points) passes Zod parse.
//   2. Polygon with 2 points fails (min 3 vertices).
//   3. Wrong version literal (e.g. v2 with v1 type) fails the discriminated
//      union — the schema rejects the union member, not just the field.
//   4. Shoelace area computation matches expected values for known polygons:
//      - 100×100 square = 10,000
//      - 6×4 axis-aligned rectangle = 24
//      - Right triangle (0,0) (10,0) (0,10) = 50
//      - Trapezoid sanity check (vertex count > 4)
//      All within 0.01 tolerance.

import { describe, expect, test } from 'vitest'

import {
  computeGeometryAreaM2,
  computePolygonArea,
  geometrySchema,
  polygon2dV1Schema,
} from '@/lib/validators/geometry'

describe('geometry validators — Zod parse + shoelace area (Plan 01-03 Task 1)', () => {
  test('valid polygon2d v1 with 3+ points parses successfully', () => {
    const triangle = {
      version: 1 as const,
      type: 'polygon2d' as const,
      points: [
        [0, 0],
        [10, 0],
        [0, 10],
      ] as Array<[number, number]>,
      z_index: 0,
    }
    const r = geometrySchema.safeParse(triangle)
    expect(r.success).toBe(true)
    if (r.success && r.data.type === 'polygon2d') {
      expect(r.data.points.length).toBe(3)
      expect(r.data.version).toBe(1)
    }

    // A larger square also passes
    const square = {
      version: 1 as const,
      type: 'polygon2d' as const,
      points: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ] as Array<[number, number]>,
      z_index: 2,
      fill: '#22c55e',
      stroke: '#15803d',
      stroke_width: 2,
    }
    const sq = polygon2dV1Schema.safeParse(square)
    expect(sq.success).toBe(true)
  })

  test('polygon with fewer than 3 points fails Zod (min 3 vertices)', () => {
    const tooFew = {
      version: 1 as const,
      type: 'polygon2d' as const,
      points: [
        [0, 0],
        [10, 0],
      ] as Array<[number, number]>,
      z_index: 0,
    }
    const r = geometrySchema.safeParse(tooFew)
    expect(r.success).toBe(false)
    if (!r.success) {
      const msg = r.error.issues.find((i) => i.path.includes('points'))?.message ?? ''
      expect(msg).toMatch(/3 vértices/i)
    }
  })

  test('wrong discriminator (version=2 with type polygon2d) fails the union', () => {
    const wrongVersion = {
      version: 2,
      type: 'polygon2d',
      points: [
        [0, 0],
        [10, 0],
        [0, 10],
      ],
      z_index: 0,
    }
    const r = geometrySchema.safeParse(wrongVersion)
    expect(r.success).toBe(false)
    // The polygon2dV1Schema directly should reject the literal mismatch too.
    const direct = polygon2dV1Schema.safeParse(wrongVersion)
    expect(direct.success).toBe(false)
  })

  test('shoelace area matches known polygons within 0.01 tolerance', () => {
    // 100×100 square = 10,000
    const square: Array<[number, number]> = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ]
    expect(computePolygonArea(square)).toBeCloseTo(10_000, 2)

    // 6×4 axis-aligned rectangle = 24
    const rect: Array<[number, number]> = [
      [0, 0],
      [6, 0],
      [6, 4],
      [0, 4],
    ]
    expect(computePolygonArea(rect)).toBeCloseTo(24, 2)

    // Right triangle (0,0) (10,0) (0,10) → 50
    const triangle: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [0, 10],
    ]
    expect(computePolygonArea(triangle)).toBeCloseTo(50, 2)

    // Trapezoid: (0,0), (10,0), (8,5), (2,5) — parallel sides 10 and 6,
    // height 5 → ((10+6)/2) × 5 = 40
    const trapezoid: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [8, 5],
      [2, 5],
    ]
    expect(computePolygonArea(trapezoid)).toBeCloseTo(40, 2)

    // CCW vs CW should yield the same absolute area (shoelace returns |sum|)
    const ccw: Array<[number, number]> = [
      [0, 0],
      [0, 100],
      [100, 100],
      [100, 0],
    ]
    expect(computePolygonArea(ccw)).toBeCloseTo(10_000, 2)

    // Degenerate (< 3 points) → 0
    expect(computePolygonArea([])).toBe(0)
    expect(
      computePolygonArea([
        [0, 0],
        [10, 0],
      ]),
    ).toBe(0)
  })

  test('computeGeometryAreaM2 dispatches by type and matches the shoelace output', () => {
    const parsed = geometrySchema.parse({
      version: 1,
      type: 'polygon2d',
      points: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
      z_index: 0,
    })
    expect(computeGeometryAreaM2(parsed)).toBeCloseTo(10_000, 2)
  })
})
