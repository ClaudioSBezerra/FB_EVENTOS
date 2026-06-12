// FB_EVENTOS — Password reset (request + consume) (Phase 0, Plan 04 — Task 2).
//
// T-0-06 mitigation: the "request reset" flow ALWAYS responds with the same
// "Se a conta existir você receberá um email" message — backend success and
// "unknown email" cases are indistinguishable from the UI. Email enumeration
// is blocked.

'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { requestPasswordReset, resetPassword } from '@/auth/client'
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

const requestSchema = z.object({
  email: z.email('Email inválido'),
})

const consumeSchema = z.object({
  newPassword: z.string().min(12, 'Senha deve ter ao menos 12 caracteres'),
})

type RequestFormValues = z.infer<typeof requestSchema>
type ConsumeFormValues = z.infer<typeof consumeSchema>

export function ResetPasswordForm() {
  const params = useSearchParams()
  const router = useRouter()
  const token = params.get('token')

  if (token) {
    return <ConsumeMode token={token} router={router} />
  }
  return <RequestMode />
}

function RequestMode() {
  const [submitted, setSubmitted] = useState(false)
  const form = useForm<RequestFormValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: { email: '' },
  })

  async function onSubmit(values: RequestFormValues) {
    // Fire-and-ignore — uniform success regardless of backend outcome.
    try {
      await requestPasswordReset({
        email: values.email,
        redirectTo: '/reset-password',
      })
    } catch {
      /* swallow — uniform response */
    }
    setSubmitted(true)
  }

  if (submitted) {
    return (
      <p className="text-sm text-slate-700">
        Se uma conta com esse email existir, você receberá um link para redefinir sua senha em
        instantes.
      </p>
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
          {form.formState.isSubmitting ? 'Enviando…' : 'Enviar link de reset'}
        </Button>
      </form>
    </Form>
  )
}

function ConsumeMode({ token, router }: { token: string; router: ReturnType<typeof useRouter> }) {
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm<ConsumeFormValues>({
    resolver: zodResolver(consumeSchema),
    defaultValues: { newPassword: '' },
  })

  async function onSubmit(values: ConsumeFormValues) {
    setSubmitError(null)
    const result = await resetPassword({
      newPassword: values.newPassword,
      token,
    })
    if (result.error) {
      setSubmitError('Token inválido ou expirado. Solicite um novo link.')
      return
    }
    router.replace('/login')
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="newPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nova senha</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {submitError && <p className="text-sm font-medium text-red-500">{submitError}</p>}
        <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
          {form.formState.isSubmitting ? 'Atualizando…' : 'Atualizar senha'}
        </Button>
      </form>
    </Form>
  )
}
