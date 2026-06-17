// FB_EVENTOS — ZapSign simulator (piloto pré-credencial, 2026-06-17).
//
// Pareado com o payment simulator. Quando env.ZAPSIGN_SIMULATOR_ENABLED é
// true, o task `zapsign.send-contract` substitui a chamada
// `createDocument` (POST /api/v1/docs/) por `createSimulatedDocument`, que
// retorna um ZapsignCreateDocResponse-shaped object com token = `SIM_<uuid>`.
//
// A página de detalhe do contrato detecta o SIM_ prefix e mostra o painel
// "Simular Assinatura" — o clique chama a Server Action que UPDATE
// contracts.status='signed', enfileira o email "contrato_assinado" e
// registra audit, replicando o que o webhook real faria.

import { logger } from '@/lib/logger'
import type { ZapsignCreateDocRequest, ZapsignCreateDocResponse } from './types'

export const ZAPSIGN_SIMULATOR_PREFIX = 'SIM_'

export function isSimulatedZapsignToken(token: string | null | undefined): boolean {
  return typeof token === 'string' && token.startsWith(ZAPSIGN_SIMULATOR_PREFIX)
}

export function shouldUseZapsignSimulator(): boolean {
  const raw = process.env.ZAPSIGN_SIMULATOR_ENABLED
  return raw === 'true' || raw === '1'
}

export function createSimulatedDocument(
  payload: ZapsignCreateDocRequest,
): ZapsignCreateDocResponse {
  const token = `${ZAPSIGN_SIMULATOR_PREFIX}${crypto.randomUUID()}`
  const openId = Math.floor(Date.now() / 1000) % 1_000_000

  logger.warn(
    {
      component: 'zapsign-simulator',
      token,
      openId,
      signerCount: payload.signers.length,
    },
    'ZAPSIGN_SIMULATOR=ON — ZapSign API NOT called. Set ZAPSIGN_SIMULATOR_ENABLED=false once real ZAPSIGN_TOKEN lands.',
  )

  return {
    token,
    open_id: openId,
    status: 'pending',
    signed_file: null,
    signers: payload.signers.map((s, idx) => ({
      token: `${ZAPSIGN_SIMULATOR_PREFIX}signer_${idx + 1}_${crypto.randomUUID()}`,
      name: s.name,
      email: s.email,
      sign_url: `https://eventos.fbtax.cloud/__sim__/sign/${token}`,
      status: 'pending',
    })),
  } as ZapsignCreateDocResponse
}
