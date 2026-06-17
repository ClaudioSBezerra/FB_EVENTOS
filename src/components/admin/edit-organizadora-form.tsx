// FB_EVENTOS — Edit organizadora form (2026-06-17 admin-first rework).
//
// Só o nome é editável; slug fica imutável (mudar slug exige migração de
// URLs / cache / vendor portals — deferred).

'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { updateOrganizadora } from '@/lib/actions/admin/organizadoras'

const schema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres').max(120),
})

type FormValues = z.infer<typeof schema>

interface EditOrganizadoraFormProps {
  orgId: string
  initialName: string
}

export function EditOrganizadoraForm({ orgId, initialName }: EditOrganizadoraFormProps) {
  const router = useRouter()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: initialName },
  })

  async function onSubmit(values: FormValues) {
    setSubmitError(null)
    const result = await updateOrganizadora({ orgId, name: values.name })
    if (!result.ok) {
      setSubmitError(
        result.error === 'not_found'
          ? 'Organização não encontrada.'
          : 'Falha ao atualizar. Tente novamente.',
      )
      return
    }
    setSavedAt(Date.now())
    router.refresh()
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome da organizadora</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {submitError && <p className="text-sm font-medium text-red-600">{submitError}</p>}
        {savedAt && (
          <p className="text-sm font-medium text-emerald-700">
            Salvo às {new Date(savedAt).toLocaleTimeString('pt-BR')}.
          </p>
        )}
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Salvando…' : 'Salvar alterações'}
        </Button>
      </form>
    </Form>
  )
}
