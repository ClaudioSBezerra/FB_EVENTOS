// FB_EVENTOS — Event create/update form (Phase 1, Plan 01-02 — Task 1).
//
// React Hook Form + zodResolver(eventCreateSchema). Submits to the
// createEvent Server Action via `useTransition` for non-blocking UI.
//
// Form fields:
//   - name             text
//   - startsAt         datetime-local (HTML5 input)
//   - endsAt           datetime-local
//   - placeName        text
//   - placeAddress     text (multi-line via textarea-ish input — Phase 0
//                      shadcn primitives don't ship Textarea yet, so we
//                      use Input until 01-03 lands a Textarea component)
//   - capacity         number (integer)
//   - timezone         text (default 'America/Sao_Paulo')
//   - currency         hidden literal 'BRL' (Phase 1 lock)
//
// Submit returns the created PersistedEventRow; the page redirects to
// /[slug]/eventos/[eventId] on success.

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
import { createEvent } from '@/lib/actions/eventos'
import { eventCreateSchema } from '@/lib/validators/event'

// Form-internal shape uses ISO datetime STRINGS for the date fields so
// HTML5 datetime-local inputs can bind directly. The zodResolver still
// uses `eventCreateSchema` which accepts string-or-Date and coerces on
// parse — the Server Action then receives proper Date values.
type EventFormValues = z.input<typeof eventCreateSchema>

interface EventFormProps {
  /** Tenant slug — used to build the post-submit redirect URL. */
  tenantSlug: string
  /** Optional pre-populated values (edit mode). */
  defaultValues?: Partial<EventFormValues>
}

function toDatetimeLocalString(d: Date | string | undefined): string {
  if (!d) return ''
  const date = d instanceof Date ? d : new Date(d)
  // HTML5 datetime-local expects "YYYY-MM-DDTHH:mm" in LOCAL time. We strip
  // the seconds + timezone offset and let the browser interpret it.
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function EventForm({ tenantSlug, defaultValues }: EventFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const form = useForm<EventFormValues>({
    // biome-ignore lint/suspicious/noExplicitAny: zodResolver's output-vs-input type drift
    resolver: zodResolver(eventCreateSchema) as any,
    defaultValues: {
      name: defaultValues?.name ?? '',
      // Stored as ISO strings; schema's `.transform` coerces to Date on parse.
      startsAt: defaultValues?.startsAt ?? '',
      endsAt: defaultValues?.endsAt ?? '',
      placeName: defaultValues?.placeName ?? '',
      placeAddress: defaultValues?.placeAddress ?? '',
      capacity: defaultValues?.capacity ?? 100,
      timezone: defaultValues?.timezone ?? 'America/Sao_Paulo',
      currency: defaultValues?.currency ?? 'BRL',
    },
  })

  function onSubmit(values: EventFormValues) {
    setSubmitError(null)
    startTransition(async () => {
      // next-safe-action v8: pass the (string-or-Date) form values; the action's
      // .inputSchema(eventCreateSchema) coerces and validates server-side.
      const result = await createEvent(values as Parameters<typeof createEvent>[0])
      if (result?.serverError) {
        setSubmitError(
          typeof result.serverError === 'string' ? result.serverError : 'Erro de servidor.',
        )
        return
      }
      if (result?.validationErrors) {
        setSubmitError('Verifique os campos do formulário e tente novamente.')
        return
      }
      const created = result?.data
      if (!created) {
        setSubmitError('Falha inesperada ao criar evento.')
        return
      }
      router.push(`/${tenantSlug}/eventos/${created.id}`)
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome do evento</FormLabel>
              <FormControl>
                <Input placeholder="Festa de Trindade 2026" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="startsAt"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Início</FormLabel>
              <FormControl>
                <Input
                  type="datetime-local"
                  value={toDatetimeLocalString(field.value as string | Date | undefined)}
                  onChange={(e) => {
                    // Convert local-time input → ISO datetime string with offset.
                    const v = e.target.value
                    field.onChange(v ? new Date(v).toISOString() : '')
                  }}
                  name={field.name}
                  ref={field.ref}
                  onBlur={field.onBlur}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="endsAt"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Término</FormLabel>
              <FormControl>
                <Input
                  type="datetime-local"
                  value={toDatetimeLocalString(field.value as string | Date | undefined)}
                  onChange={(e) => {
                    const v = e.target.value
                    field.onChange(v ? new Date(v).toISOString() : '')
                  }}
                  name={field.name}
                  ref={field.ref}
                  onBlur={field.onBlur}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="placeName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome do local</FormLabel>
              <FormControl>
                <Input placeholder="Santuário Basílica de Trindade" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="placeAddress"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Endereço completo</FormLabel>
              <FormControl>
                <Input placeholder="Av. Padre Pelagio, s/n — Trindade/GO" {...field} />
              </FormControl>
              <FormDescription>
                Endereço completo do local. Esse dado pode identificar a operação da organizadora
                (LGPD — categoria PII baixa).
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="capacity"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Capacidade (pessoas)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={1}
                  max={1_000_000}
                  value={field.value ?? ''}
                  onChange={(e) => field.onChange(Number.parseInt(e.target.value, 10) || 0)}
                  name={field.name}
                  ref={field.ref}
                  onBlur={field.onBlur}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="timezone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Timezone (IANA)</FormLabel>
              <FormControl>
                <Input placeholder="America/Sao_Paulo" {...field} />
              </FormControl>
              <FormDescription>
                Padrão para o piloto Brasil: <code>America/Sao_Paulo</code>.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Currency é fixo em BRL na Phase 1 — input invisível para satisfazer o schema. */}
        <input type="hidden" {...form.register('currency')} value="BRL" readOnly />

        {submitError && <p className="text-sm font-medium text-red-500">{submitError}</p>}

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? 'Salvando…' : 'Criar evento'}
        </Button>
      </form>
    </Form>
  )
}
