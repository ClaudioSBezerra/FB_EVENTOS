// FB_EVENTOS — Client-side wrapper pro PlantaEditor (carga dinâmica, ssr:false).
//
// react-konva acessa window.Konva já no import — se o PlantaEditor for
// SSR'ed pela page Server Component, o React tenta renderizar Konva no
// servidor e quebra com "Element type is invalid" (#306) ou similar.
//
// Pattern recomendado pelo react-konva pra Next.js 13+:
//   1. Componente Konva é importado normal (não dynamic) dentro dele
//      mesmo.
//   2. UM wrapper Client Component faz `next/dynamic` com ssr:false em
//      cima do componente inteiro.
//   3. Server Component renderiza o wrapper.
//
// Sem ssr:false aqui, qualquer fix individual de dynamic-per-componente
// (`{ default: m.Layer }`) ainda gera erros porque o react-konva carrega
// no SSR antes do dynamic resolver.

'use client'

import dynamic from 'next/dynamic'

import type { ComponentProps } from 'react'

import type { PlantaEditor as PlantaEditorType } from './planta-editor'

export const PlantaEditorClient = dynamic<ComponentProps<typeof PlantaEditorType>>(
  () => import('./planta-editor').then((m) => m.PlantaEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-96 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
        Carregando editor da planta…
      </div>
    ),
  },
)
