// FB_EVENTOS — Login form (Phase 0, Plan 04 — Task 2).
//
// T-0-06 mitigation: error message is uniform "Credenciais inválidas" — does
// NOT distinguish "user not found" from "wrong password" or "email not
// verified". The backend may emit specific error codes, but the UI maps
// them all to one generic string.

'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { authClient, signIn } from '@/auth/client'
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

const loginSchema = z.object({
  email: z.email('Email inválido'),
  password: z.string().min(1, 'Senha obrigatória'),
})

type LoginFormValues = z.infer<typeof loginSchema>

export function LoginForm() {
  const router = useRouter()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  async function onSubmit(values: LoginFormValues) {
    setSubmitError(null)
    const result = await signIn.email({
      email: values.email,
      password: values.password,
    })
    if (result.error) {
      // Uniform error — never leak whether the email exists.
      setSubmitError('Credenciais inválidas')
      return
    }
    // Look up the active org slug for the redirect.
    try {
      const sessionResp = await authClient.getSession()
      const slug =
        (sessionResp.data as unknown as { activeOrganization?: { slug?: string } })
          ?.activeOrganization?.slug ?? null
      if (slug) {
        router.replace(`/${slug}/dashboard`)
        return
      }
    } catch {
      // fall through to /login bounce
    }
    router.replace('/')
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
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Senha</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {submitError && <p className="text-sm font-medium text-red-500">{submitError}</p>}
        <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
          {form.formState.isSubmitting ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
    </Form>
  )
}
