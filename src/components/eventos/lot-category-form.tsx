// FB_EVENTOS — Lot category create form (Phase 1, Plan 01-03 — Task 3).
//
// RHF + zodResolver(lotCategoryCreateSchema). Submits to createLotCategory
// Server Action via useTransition for non-blocking UI.
//
// Fields:
//   - name           text
//   - baseFixed      number (R$ flat per lot — aditivo D-09)
//   - perSqmRate     number (R$/m² — aditivo D-09)
//   - color          color picker (hex)

'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { createLotCategory } from '@/lib/actions/lot-categories'
import { lotCategoryCreateSchema } from '@/lib/validators/lot-category'

type LotCategoryFormValues = z.input<typeof lotCategoryCreateSchema>

interface LotCategoryFormProps {
  eventId: string
  tenantSlug: string
}

export function LotCategoryForm({ eventId, tenantSlug }: LotCategoryFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const form = useForm<LotCategoryFormValues>({
    // biome-ignore lint/suspicious/noExplicitAny: zodResolver input/output type drift (same as event-form)
    resolver: zodResolver(lotCategoryCreateSchema) as any,
    defaultValues: {
      eventId,
      name: '',
      baseFixed: 0,
      perSqmRate: 0,
      color: '#22c55e',
    },
  })

  const onSubmit = (values: LotCategoryFormValues) => {
    setSubmitError(null)
    startTransition(async () => {
      const res = await createLotCategory(values)
      if (res?.serverError) {
        setSubmitError(
          typeof res.serverError === 'string' ? res.serverError : 'Erro ao salvar categoria',
        )
        return
      }
      if (res?.data) {
        form.reset({
          eventId,
          name: '',
          baseFixed: 0,
          perSqmRate: 0,
          color: '#22c55e',
        })
        router.refresh()
      }
    })
    // Reference tenantSlug to silence unused-prop lint warnings.
    void tenantSlug
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit as (v: LotCategoryFormValues) => void)}
        className="space-y-4"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome</FormLabel>
              <FormControl>
                <Input placeholder="Ex.: Stand 4m²" {...field} value={field.value ?? ''} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="baseFixed"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Valor fixo (R$)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    {...field}
                    value={field.value ?? 0}
                    onChange={(e) => field.onChange(e.target.valueAsNumber || 0)}
                  />
                </FormControl>
                <FormDescription>Pago independente do tamanho do lote.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="perSqmRate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Valor por m² (R$)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    {...field}
                    value={field.value ?? 0}
                    onChange={(e) => field.onChange(e.target.valueAsNumber || 0)}
                  />
                </FormControl>
                <FormDescription>Multiplicado pela área (m²).</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="color"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Cor (mapa)</FormLabel>
              <FormControl>
                <Input
                  type="color"
                  className="h-10 w-20"
                  {...field}
                  value={field.value ?? '#22c55e'}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {submitError && (
          <p className="text-sm font-medium text-red-600" role="alert">
            {submitError}
          </p>
        )}

        <Button type="submit" disabled={isPending}>
          {isPending ? 'Salvando…' : 'Adicionar categoria'}
        </Button>
      </form>
    </Form>
  )
}
