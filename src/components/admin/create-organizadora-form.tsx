// FB_EVENTOS — Wizard organizadora + admin (2026-06-17 admin-first rework).
//
// Cria simultaneamente: tenant + organization + admin user + member(owner).

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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { createOrganizadora } from '@/lib/actions/admin/organizadoras'
import { SYSTEM_PREFIXES } from '@/lib/tenant-prefixes'

const slugRegex = /^[a-z][a-z0-9-]{2,30}$/

const schema = z.object({
  orgName: z.string().min(2, 'Mínimo 2 caracteres').max(120),
  orgSlug: z
    .string()
    .regex(slugRegex, 'Letras minúsculas, números, hífens; comece com letra (3-30)')
    .refine((s) => !SYSTEM_PREFIXES.has(s), 'Esse slug é reservado'),
  adminName: z.string().min(2, 'Mínimo 2 caracteres').max(120),
  adminEmail: z.email('Email inválido'),
  adminPassword: z.string().min(12, 'Mínimo 12 caracteres'),
})

type FormValues = z.infer<typeof schema>

export function CreateOrganizadoraForm() {
  const router = useRouter()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      orgName: '',
      orgSlug: '',
      adminName: '',
      adminEmail: '',
      adminPassword: '',
    },
  })

  async function onSubmit(values: FormValues) {
    setSubmitError(null)
    const result = await createOrganizadora(values)
    if (!result.ok) {
      if (result.error === 'slug_taken') {
        form.setError('orgSlug', { message: 'Esse slug já está em uso. Tente outro.' })
        return
      }
      if (result.error === 'email_taken') {
        form.setError('adminEmail', {
          message: 'Já existe um usuário com esse email. Use outro.',
        })
        return
      }
      setSubmitError('Não foi possível criar a organizadora. Tente novamente.')
      return
    }
    router.push('/admin/organizadoras')
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Organização
          </h2>
          <FormField
            control={form.control}
            name="orgName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nome da organizadora</FormLabel>
                <FormControl>
                  <Input placeholder="Paróquia Nossa Senhora da Guia" {...field} />
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
                <FormLabel>Slug</FormLabel>
                <FormControl>
                  <Input placeholder="paroquia-guia" {...field} />
                </FormControl>
                <FormDescription>
                  Aparecerá nas URLs: <code>/{field.value || 'slug'}/...</code>
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        <section className="space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Administrador da organizadora
          </h2>
          <p className="text-xs text-slate-600">
            Esse usuário será o proprietário (owner) da organizadora. O email será marcado como
            verificado automaticamente — ele recebe a senha por canal externo (fora do sistema).
          </p>
          <FormField
            control={form.control}
            name="adminName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nome completo</FormLabel>
                <FormControl>
                  <Input placeholder="João da Silva" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="adminEmail"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input type="email" placeholder="joao@paroquia.org" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="adminPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Senha inicial</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    placeholder="Mínimo 12 caracteres"
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  O usuário poderá trocar depois pelo fluxo de redefinição.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        {submitError && <p className="text-sm font-medium text-red-600">{submitError}</p>}

        <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
          {form.formState.isSubmitting ? 'Criando…' : 'Criar organizadora'}
        </Button>
      </form>
    </Form>
  )
}
