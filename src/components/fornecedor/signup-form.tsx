// FB_EVENTOS — Fornecedor self-service signup form (Phase 2, Plan 02-02 Task 1).
//
// Client Component: react-hook-form + signupFornecedorSchema.
//
// Three LGPD consent checkboxes (D-24):
//   - marketing (optional)
//   - analytics (optional)
//   - payment_data (REQUIRED via z.literal(true) — T-02-02-02)
//
// On submit: calls signupFornecedor(slug, values) Server Action.
// On success: router.push(`/${slug}/portal`) — placeholder until Plan 02-08.
//
// REFERENCES:
//   - 02-CONTEXT.md D-21 D-24, T-02-02-02
//   - 02-02-PLAN.md Task 1
//   - src/components/auth/signup-form.tsx (analog for LGPD checkboxes pattern)
//   - src/components/fornecedores/cnpj-input.tsx (CnpjInput component)
//   - src/lib/actions/signup-fornecedor.ts (Server Action)
//   - src/lib/validators/signup-fornecedor.ts (Zod schema)

'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'

import { CnpjInput } from '@/components/fornecedores/cnpj-input'
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
import { signupFornecedor } from '@/lib/actions/signup-fornecedor'
import {
  LGPD_CONSENT_TEXTS,
  type SignupFornecedorSchema,
  signupFornecedorSchema,
} from '@/lib/validators/signup-fornecedor'

interface SignupFornecedorFormProps {
  slug: string
}

export function SignupFornecedorForm({ slug }: SignupFornecedorFormProps) {
  const router = useRouter()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<SignupFornecedorSchema>({
    resolver: zodResolver(signupFornecedorSchema),
    defaultValues: {
      email: '',
      password: '',
      name: '',
      legalName: '',
      tradeName: '',
      cnpj: '',
      phone: '',
      consents: {
        marketing: false,
        analytics: false,
        // payment_data must be true to submit — literal(true) in schema
        payment_data: false as unknown as true,
      },
    },
  })

  async function onSubmit(values: SignupFornecedorSchema) {
    setSubmitError(null)
    setIsSubmitting(true)
    try {
      const result = await signupFornecedor(slug, values)
      router.push(result.redirectTo)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erro inesperado. Tente novamente.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        {/* ── Account fields ──────────────────────────────────────────── */}
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="seu@email.com.br"
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
                <Input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Mínimo 10 caracteres"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Seu nome</FormLabel>
              <FormControl>
                <Input placeholder="Nome completo" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* ── Empresa fields ──────────────────────────────────────────── */}
        <hr className="border-slate-200" />

        <FormField
          control={form.control}
          name="legalName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Razão social</FormLabel>
              <FormControl>
                <Input placeholder="EMPRESA EXEMPLO LTDA" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="tradeName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Nome fantasia <span className="text-slate-400 font-normal">(opcional)</span>
              </FormLabel>
              <FormControl>
                <Input placeholder="Nome comercial" {...field} value={field.value ?? ''} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* CNPJ uses CnpjInput (Layer 1 + Layer 2 BrasilAPI lookup on blur) */}
        <FormField
          control={form.control}
          name="cnpj"
          render={() => (
            <FormItem>
              <FormLabel>CNPJ</FormLabel>
              <FormControl>
                <Controller
                  control={form.control}
                  name="cnpj"
                  render={({ field }) => (
                    <CnpjInput
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      name={field.name}
                    />
                  )}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Telefone <span className="text-slate-400 font-normal">(opcional)</span>
              </FormLabel>
              <FormControl>
                <Input
                  type="tel"
                  placeholder="+55 (62) 99999-0000"
                  {...field}
                  value={field.value ?? ''}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* ── LGPD consents (D-24) ────────────────────────────────────── */}
        <hr className="border-slate-200" />

        <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-700">Consentimentos LGPD</p>

          <FormField
            control={form.control}
            name="consents.marketing"
            render={({ field }) => (
              <FormItem className="flex items-start gap-3">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    className="mt-0.5"
                  />
                </FormControl>
                <div className="space-y-1">
                  <FormLabel className="text-sm font-normal leading-snug">
                    Marketing (opcional)
                  </FormLabel>
                  <FormDescription className="text-xs text-slate-500">
                    {LGPD_CONSENT_TEXTS.marketing}
                  </FormDescription>
                </div>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="consents.analytics"
            render={({ field }) => (
              <FormItem className="flex items-start gap-3">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    className="mt-0.5"
                  />
                </FormControl>
                <div className="space-y-1">
                  <FormLabel className="text-sm font-normal leading-snug">
                    Análise de uso (opcional)
                  </FormLabel>
                  <FormDescription className="text-xs text-slate-500">
                    {LGPD_CONSENT_TEXTS.analytics}
                  </FormDescription>
                </div>
              </FormItem>
            )}
          />

          {/* payment_data is REQUIRED — T-02-02-02 */}
          <FormField
            control={form.control}
            name="consents.payment_data"
            render={({ field }) => (
              <FormItem className="flex items-start gap-3">
                <FormControl>
                  <Checkbox
                    checked={field.value as unknown as boolean}
                    onCheckedChange={(checked) => field.onChange(checked as unknown as true)}
                    className="mt-0.5"
                  />
                </FormControl>
                <div className="space-y-1">
                  <FormLabel className="text-sm font-normal leading-snug">
                    Dados de pagamento{' '}
                    <span className="text-red-600 font-semibold">(obrigatório)</span>
                  </FormLabel>
                  <FormDescription className="text-xs text-slate-500">
                    {LGPD_CONSENT_TEXTS.payment_data}
                  </FormDescription>
                </div>
              </FormItem>
            )}
          />

          <FormMessage>{form.formState.errors.consents?.payment_data?.message}</FormMessage>
        </div>

        {/* ── Submit ──────────────────────────────────────────────────── */}
        {submitError && (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {submitError}
          </div>
        )}

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Cadastrando...' : 'Criar conta de fornecedor'}
        </Button>
      </form>
    </Form>
  )
}
