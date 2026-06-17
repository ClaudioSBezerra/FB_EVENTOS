// FB_EVENTOS — Create user form (admin, 2026-06-17 admin-first rework).

'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { createUser } from '@/lib/actions/admin/usuarios'

const schema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres').max(120),
  email: z.email('Email inválido'),
  password: z.string().min(12, 'Mínimo 12 caracteres'),
  isSuperAdmin: z.boolean(),
})

type FormValues = z.infer<typeof schema>

export function CreateUserForm() {
  const router = useRouter()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '', isSuperAdmin: false },
  })

  async function onSubmit(values: FormValues) {
    setSubmitError(null)
    const result = await createUser(values)
    if (!result.ok) {
      if (result.error === 'email_taken') {
        form.setError('email', { message: 'Já existe um usuário com esse email.' })
        return
      }
      setSubmitError('Não foi possível criar o usuário. Tente novamente.')
      return
    }
    router.push(`/admin/usuarios/${result.userId}`)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
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
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" placeholder="usuario@exemplo.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
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
                Passe a senha por canal externo. O usuário pode trocar depois.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="isSuperAdmin"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border border-slate-200 bg-slate-50 p-4">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(c) => field.onChange(c === true)}
                />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>Marcar como super administrador</FormLabel>
                <FormDescription>
                  Concede acesso ao painel /admin (CRUD de organizadoras e usuários). Use com
                  cuidado.
                </FormDescription>
                <FormMessage />
              </div>
            </FormItem>
          )}
        />

        {submitError && <p className="text-sm font-medium text-red-600">{submitError}</p>}

        <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
          {form.formState.isSubmitting ? 'Criando…' : 'Criar usuário'}
        </Button>
      </form>
    </Form>
  )
}
