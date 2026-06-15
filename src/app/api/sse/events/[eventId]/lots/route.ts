// FB_EVENTOS — SSE Route Handler: GET /api/sse/events/[eventId]/lots (Plan 02-04).
// STUB — implementation in GREEN phase of TDD.
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  _context: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  return new Response('Not implemented', { status: 501 })
}
