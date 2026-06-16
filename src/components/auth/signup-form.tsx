// FB_EVENTOS — Signup form with LGPD consent (Phase 0, Plan 04 — Task 2).
//
// Three-layer LGPD-01 + T-0-08 mitigation:
//   1. Zod 4 client schema: consent: z.literal(true, ...) — form cannot
//      submit without the checkbox.
//   2. Better Auth signUp.email payload includes consentVersion + consentAt
//      (additionalFields are required:true → backend rejects empty consent).
//   3. After signUp succeeds, recordConsentMetadata() Server Action inserts
//      an audit-grade row into consent_records with the IP captured from
//      next/headers server-side — never trusts a client-supplied IP.
//
// Reserved-slug rejection (RESEARCH Pitfall 7): client-side check against
// SYSTEM_PREFIXES; backend layer (Phase 1+ org-create hook) will also reject.

'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { authClient, signUp } from '@/auth/client'
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
import { recordConsentMetadata } from '@/lib/actions/consent'
import { SYSTEM_PREFIXES } from '@/lib/tenant-prefixes'

const LGPD_CONSENT_VERSION = '2026-06-01'
const LGPD_CONSENT_TEXT_V1 =
  'Concordo com a Política de Privacidade da FB_EVENTOS e autorizo o tratamento dos meus dados pessoais conforme a LGPD (Lei 13.709/2018). Posso revogar o consentimento a qualquer momento via /perfil/consentimento.'

const slugRegex = /^[a-z][a-z0-9-]{2,30}$/

const signupSchema = z.object({
  email: z.email('Email inválido'),
  password: z.string().min(12, 'Senha deve ter ao menos 12 caracteres'),
  name: z.string().min(2, 'Nome deve ter ao menos 2 caracteres'),
  orgName: z.string().min(2, 'Nome da organização obrigatório'),
  orgSlug: z
    .string()
    .regex(slugRegex, 'Slug: minúsculas, números, hífens; comece com letra (3-30 chars)')
    .refine(
      (s) => !SYSTEM_PREFIXES.has(s),
      'Esse slug é reservado pelo sistema (ex: api, login, dashboard).',
    ),
  consent: z.literal(true, {
    message: 'O consentimento LGPD é obrigatório para criar a conta',
  }),
})

type SignupFormValues = z.infer<typeof signupSchema>

export function SignupForm() {
  const router = useRouter()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const form = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      email: '',
      password: '',
      name: '',
      orgName: '',
      orgSlug: '',
      consent: false as unknown as true,
    },
  })

  async function onSubmit(values: SignupFormValues) {
    setSubmitError(null)

    const consentAt = new Date()

    // 1. Better Auth signUp.email — additionalFields enforce consent required.
    //    The auth client (inferAdditionalFields) types consentAt as Date
    //    because of the type:'date' additionalFields config — Better Auth
    //    handles the JSON-over-the-wire serialization.
    const { data, error } = await signUp.email({
      email: values.email,
      password: values.password,
      name: values.name,
      // additionalFields:
      consentVersion: LGPD_CONSENT_VERSION,
      consentAt,
      // consentIp deliberately NOT sent — captured server-side via
      // recordConsentMetadata() reading from next/headers.
    } as Parameters<typeof signUp.email>[0])

    if (error) {
      // Uniform error wording — do NOT distinguish "email exists" from other
      // failures (T-0-06 email-enumeration mitigation).
      setSubmitError('Não foi possível concluir o cadastro. Verifique os dados e tente novamente.')
      return
    }

    const newUserId = data?.user?.id

    // 2. Audit-grade consent capture (IP from server headers). Pass the
    //    freshly-created user.id because autoSignIn:false means there is no
    //    live session yet — without this the action would short-circuit on
    //    no_session and consent_records would never be written.
    await recordConsentMetadata({
      consentVersion: LGPD_CONSENT_VERSION,
      consentText: LGPD_CONSENT_TEXT_V1,
      userId: newUserId,
    })

    // 3. Workaround for Better Auth `sendOnSignUp:true` regression observed
    //    in production (2026-06-16): the auto-dispatch of the verification
    //    email did not fire even though signUp.email returned success. Call
    //    sendVerificationEmail explicitly here so the user always receives
    //    the link. Worst-case (auto-dispatch DID fire) the user gets two
    //    copies of the same email — preferable to none.
    await authClient.sendVerificationEmail({
      email: values.email,
      callbackURL: '/login',
    })

    // 4. Redirect to verify-email landing.
    router.replace('/verify-email')
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome</FormLabel>
              <FormControl>
                <Input placeholder="Seu nome" autoComplete="name" {...field} />
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
                <Input
                  type="email"
                  placeholder="voce@empresa.com"
                  autoComplete="email"
                  {...field}
                />
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
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormDescription>Mínimo 12 caracteres.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="orgName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome da organização</FormLabel>
              <FormControl>
                <Input placeholder="Acme Eventos" {...field} />
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
              <FormLabel>Identificador da organização (slug)</FormLabel>
              <FormControl>
                <Input placeholder="acme-eventos" {...field} />
              </FormControl>
              <FormDescription>
                Aparecerá na URL: app.fb-eventos.com/<strong>{field.value || 'acme'}</strong>
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="consent"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
              <FormControl>
                <Checkbox
                  checked={field.value as unknown as boolean}
                  onCheckedChange={(c) => field.onChange(c === true)}
                />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>Consentimento LGPD (obrigatório)</FormLabel>
                <FormDescription>{LGPD_CONSENT_TEXT_V1}</FormDescription>
                <FormMessage />
              </div>
            </FormItem>
          )}
        />
        {submitError && <p className="text-sm font-medium text-red-500">{submitError}</p>}
        <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
          {form.formState.isSubmitting ? 'Criando conta…' : 'Criar conta'}
        </Button>
      </form>
    </Form>
  )
}
