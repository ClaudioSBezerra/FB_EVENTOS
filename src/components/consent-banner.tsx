// FB_EVENTOS — LGPD-02 cookie consent banner (Phase 0, Plan 05).
//
// Client component rendered from src/app/layout.tsx. On first visit (no
// `fb_lgpd_consent_v1` key in localStorage) the banner appears at the
// bottom of the viewport with three choices:
//   - "Aceitar tudo"            → essential + analytics + marketing
//   - "Recusar não-essenciais"  → essential only
//   - "Personalizar"            → opens a placeholder dialog (Phase 1+
//                                 will wire granular per-scope toggles)
//
// After a choice is recorded:
//   - localStorage.setItem('fb_lgpd_consent_v1', JSON.stringify({...}))
//   - If a Better Auth session is available, POSTs to /api/lgpd/consent
//     (a Route Handler that inserts a consent_records row via withTenant).
//     The Route Handler is intentionally permissive when no session is
//     active — the cookie record alone is sufficient for unauthenticated
//     visitors.
//
// SCHEMA WIRE FORMAT (matches consent_records.granted_scopes jsonb):
//   { essential: true, analytics: boolean, marketing: boolean,
//     version: '2026-06-01', at: <ISO 8601 timestamp> }
//
// IMPORTANT: this banner does NOT block any analytics/marketing scripts in
// Phase 0 (there are none). Phase 1+ ad/analytics integration must read
// the localStorage value at boot and gate script injection accordingly.

'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

const STORAGE_KEY = 'fb_lgpd_consent_v1'
const CONSENT_VERSION = '2026-06-01'

interface ConsentChoice {
  essential: true
  analytics: boolean
  marketing: boolean
  version: string
  at: string
}

function recordChoice(choice: ConsentChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice))
  } catch {
    // localStorage may be blocked (private mode, storage quota). Silent
    // fallback: the banner will re-appear next visit. We do NOT throw.
  }

  // Fire-and-forget POST to the Server Action / Route Handler. Phase 1+
  // wires `/api/lgpd/consent` (a Route Handler at src/app/api/lgpd/
  // consent/route.ts) which calls recordConsentMetadata() inside
  // withTenant() once the user has signed in. The Route Handler is
  // deferred to a follow-up commit; for Phase 0 the localStorage
  // persistence alone satisfies LGPD-02.
  if (typeof fetch === 'function') {
    void fetch('/api/lgpd/consent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...choice, consentText: bannerText() }),
    }).catch(() => {
      // 404 expected in Phase 0; the cookie record alone is sufficient.
    })
  }
}

function bannerText(): string {
  return (
    'Usamos cookies essenciais para o funcionamento da plataforma. ' +
    'Analytics e marketing são opcionais. Consulte nossa Política LGPD.'
  )
}

export function ConsentBanner(): React.ReactElement | null {
  const [needsChoice, setNeedsChoice] = useState(false)

  useEffect(() => {
    // localStorage is only available in the browser; useEffect guards SSR.
    try {
      const existing = localStorage.getItem(STORAGE_KEY)
      if (!existing) {
        setNeedsChoice(true)
      }
    } catch {
      // If localStorage is blocked, show the banner — better to over-show
      // than to silently block a legally required disclosure.
      setNeedsChoice(true)
    }
  }, [])

  if (!needsChoice) {
    return null
  }

  const dismiss = (analytics: boolean, marketing: boolean) => {
    const choice: ConsentChoice = {
      essential: true,
      analytics,
      marketing,
      version: CONSENT_VERSION,
      at: new Date().toISOString(),
    }
    recordChoice(choice)
    setNeedsChoice(false)
  }

  const openCustomize = () => {
    // Phase 0 placeholder — alerts the user that granular controls land in
    // Phase 1+. The "Recusar não-essenciais" option provides the strict-
    // minimum LGPD-compliant default in the meantime.
    alert(
      'Controles granulares estarão disponíveis em breve. Use ' +
        '"Recusar não-essenciais" para a configuração mais restritiva por enquanto.',
    )
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-4">
      <Card className="mx-auto max-w-3xl border-slate-300 p-4 shadow-lg">
        <p className="mb-3 text-sm text-slate-700">
          Usamos cookies essenciais para o funcionamento da plataforma. Analytics e marketing são
          opcionais. Consulte nossa{' '}
          <a className="underline" href="/docs/lgpd">
            Política LGPD
          </a>
          .
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => dismiss(true, true)}>Aceitar tudo</Button>
          <Button variant="outline" onClick={() => dismiss(false, false)}>
            Recusar não-essenciais
          </Button>
          <Button variant="ghost" onClick={openCustomize}>
            Personalizar
          </Button>
        </div>
      </Card>
    </div>
  )
}
