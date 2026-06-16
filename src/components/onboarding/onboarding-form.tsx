// FB_EVENTOS — Onboarding form (org name + slug).
//
// Reached from /onboarding when a logged-in user lacks an active organization.
// Calls `authClient.organization.create({name, slug})`. Better Auth's
// organization plugin handles:
//   - INSERT into `organization` (id = tenant_id by Phase 0 invariant)
//   - INSERT into `member` (this user = owner)
//   - update session.activeOrganizationId
//   - the database hook in src/lib/auth/set-active-org.ts then injects
//     session.tenantId so subsequent withTenant() calls resolve.

'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { authClient } from '@/auth/client'
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
import { SYSTEM_PREFIXES } from '@/lib/tenant-prefixes'

const slugRegex = /^[a-z][a-z0-9-]{2,30}$/

const onboardingSchema = z.object({
  orgName: z.string().min(2, 'Nome da organização obrigatório'),
  orgSlug: z
    .string()
    .regex(slugRegex, 'Slug: minúsculas, números, hífens; comece com letra (3-30 chars)')
    .refine(
      (s) => !SYSTEM_PREFIXES.has(s),
      'Esse slug é reservado pelo sistema (ex: api, login, dashboard).',
    ),
})

type OnboardingFormValues = z.infer<typeof onboardingSchema>

export function OnboardingForm() {
  const router = useRouter()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const form = useForm<OnboardingFormValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: { orgName: '', orgSlug: '' },
  })

  async function onSubmit(values: OnboardingFormValues) {
    setSubmitError(null)

    const result = await authClient.organization.create({
      name: values.orgName,
      slug: values.orgSlug,
    })

    if (result.error) {
      const message = result.error.message ?? ''
      if (/slug|exists|taken/i.test(message)) {
        form.setError('orgSlug', {
          message: 'Esse slug já está em uso ou inválido. Tente outro.',
        })
        return
      }
      setSubmitError('Não foi possível criar a organização. Tente novamente em alguns segundos.')
      return
    }

    // Better Auth set the new org as active. Redirect via /; the home server
    // component resolves activeOrgId → slug and forwards to the dashboard.
    router.replace('/')
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <FormField
          control={form.control}
          name="orgName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome da organizadora</FormLabel>
              <FormControl>
                <Input placeholder="Festa de Trindade, Igreja XYZ, etc." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="orgSlug"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Slug (URL da organização)</FormLabel>
              <FormControl>
                <Input placeholder="festa-trindade" {...field} />
              </FormControl>
              <p className="text-xs text-slate-500">
                Sua organização ficará acessível em <strong>/{field.value || 'sua-org'}/...</strong>
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        {submitError && <p className="text-sm font-medium text-red-600">{submitError}</p>}

        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Criando…' : 'Criar organização'}
        </Button>
      </form>
    </Form>
  )
}
