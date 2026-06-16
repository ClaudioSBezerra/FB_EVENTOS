"use strict";
// FB_EVENTOS — Lot geometry validators (Phase 1, Plan 01-03 — Task 1).
//
// D-10 ratifies the geometry jsonb shape as a discriminated union on `type`
// so v2 (extrude3d) lands additively — NO ALTER TABLE — when the 3D upgrade
// hits Phase 4+. Today we only accept v1 polygon2d; the CHECK constraint
// in migration 0011 enforces `version=1 AND type='polygon2d'` at the DB
// boundary, and this Zod schema is the second line of defense at the
// Server Action boundary.
//
// Coordinate system is ABSOLUTE PIXEL relative to the original-resolution
// planta image (D-10 + RESEARCH §A5). The Konva stage applies its own
// pan/zoom transform; storage matches origin pixels so a re-uploaded image
// at the same resolution lines up automatically.
//
// REFERENCES:
//   - 01-CONTEXT.md D-10 (jsonb shape)
//   - 01-RESEARCH.md §A5 (polygon2d field list + Konva Line.points format)
//   - src/db/migrations/0011_phase1_force_rls.sql (CHECK constraint)
Object.defineProperty(exports, "__esModule", { value: true });
exports.geometrySchema = exports.polygon2dV1Schema = exports.pointSchema = void 0;
exports.computePolygonArea = computePolygonArea;
exports.computeGeometryAreaM2 = computeGeometryAreaM2;
const zod_1 = require("zod");
// ────────────────────────────────────────────────────────────────────────────
// Shape primitives
// ────────────────────────────────────────────────────────────────────────────
/**
 * A 2D point pair [x, y]. Float coordinates in pixels, relative to the
 * planta image's intrinsic (origin-resolution) coordinate space.
 */
exports.pointSchema = zod_1.z.tuple([zod_1.z.number().finite(), zod_1.z.number().finite()]);
// ────────────────────────────────────────────────────────────────────────────
// v1 — polygon2d (the only shape Phase 1 supports today)
// ────────────────────────────────────────────────────────────────────────────
exports.polygon2dV1Schema = zod_1.z.object({
    version: zod_1.z.literal(1),
    type: zod_1.z.literal('polygon2d'),
    /** Vertex list. Minimum 3 points for a valid polygon (line + triangle floor). */
    points: zod_1.z.array(exports.pointSchema).min(3, 'Polígono precisa de pelo menos 3 vértices'),
    /** Rendering order — higher z renders on top. Defaults to 0. */
    z_index: zod_1.z.number().int().default(0),
    /**
     * Forward-compat hook for the v2 3D upgrade. When `version` flips to 2
     * (type 'extrude3d'), this becomes load-bearing; v1 keeps it optional so
     * the editor can pre-stamp a height that v2 will pick up without an
     * ALTER TABLE pass.
     */
    extrude_height: zod_1.z.number().nullable().optional(),
    /** Optional hex fill (e.g. category color); editor falls back to category. */
    fill: zod_1.z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, 'Cor de preenchimento deve ser hex #RRGGBB')
        .optional(),
    /** Optional hex stroke. */
    stroke: zod_1.z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, 'Cor de borda deve ser hex #RRGGBB')
        .optional(),
    /** Optional stroke width (px). */
    stroke_width: zod_1.z.number().int().min(0).max(20).optional(),
});
// ────────────────────────────────────────────────────────────────────────────
// Discriminated union — extend here when v2 lands. The CHECK constraint in
// migration 0011 must be relaxed in lock-step (e.g. add OR clause for
// version=2 AND type='extrude3d').
// ────────────────────────────────────────────────────────────────────────────
exports.geometrySchema = zod_1.z.discriminatedUnion('type', [exports.polygon2dV1Schema]);
// ────────────────────────────────────────────────────────────────────────────
// Area computation — server-side shoelace formula
// ────────────────────────────────────────────────────────────────────────────
/**
 * Polygon area in pixel² via the shoelace formula. Result is the absolute
 * value (we treat polygons drawn clockwise + counter-clockwise the same).
 *
 * For a closed simple polygon with vertices (x0,y0)..(xn-1,yn-1):
 *   area = 0.5 × |Σ (xi × yi+1 − xi+1 × yi)| where i+1 wraps to 0.
 *
 * For self-intersecting polygons the formula returns the signed-sum area
 * (still useful as a rough size proxy — UX should prevent self-intersection
 * in Phase 2's vertex-edit tool).
 *
 * NOTE: The result is in PIXELS². The organizadora-facing area_m² value
 * uses the SAME numeric scale (1 px ≡ 1 m² in v1 — D-10 + RESEARCH §A5).
 * Phase 4 may introduce a per-event `scale_px_per_m` field to convert; for
 * the Trindade piloto the planta is uploaded at 1 px ≡ 1 m so the raw
 * shoelace output is the m² area directly.
 */
function computePolygonArea(points) {
    if (points.length < 3)
        return 0;
    let acc = 0;
    for (let i = 0; i < points.length; i++) {
        const cur = points[i];
        const nxt = points[(i + 1) % points.length];
        if (!cur || !nxt)
            continue;
        acc += cur[0] * nxt[1] - nxt[0] * cur[1];
    }
    return Math.abs(acc) / 2;
}
/**
 * Convenience: compute area from a parsed Geometry. Returns 0 for shape
 * types that don't have a 2D footprint (future-proofing).
 */
function computeGeometryAreaM2(geometry) {
    if (geometry.type === 'polygon2d') {
        return computePolygonArea(geometry.points);
    }
    return 0;
}
