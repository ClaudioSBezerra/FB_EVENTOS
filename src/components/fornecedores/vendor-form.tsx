// FB_EVENTOS — Vendor create form (Phase 1, Plan 01-04 — Task 2).
//
// React Hook Form + zodResolver(vendorCreateSchema). Embeds CnpjInput which
// runs the BrasilAPI lookup as soon as Layer 1 validation passes (D-16).
//
// On successful create, redirects to /[slug]/fornecedores/<vendorId> so the
// organizadora lands on the detail page (where doc upload + approval live).

'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Controller, useForm } from 'react-hook-form'
import type { z } from 'zod'

import { CnpjInput } from '@/components/fornecedores/cnpj-input'
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
import { createVendor } from '@/lib/actions/fornecedores'
import { vendorCreateSchema } from '@/lib/validators/vendor'

type VendorFormValues = z.input<typeof vendorCreateSchema>

export interface VendorFormProps {
  tenantSlug: string
}

export function VendorForm({ tenantSlug }: VendorFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const form = useForm<VendorFormValues>({
    // biome-ignore lint/suspicious/noExplicitAny: zodResolver output-vs-input type drift
    resolver: zodResolver(vendorCreateSchema) as any,
    defaultValues: {
      legalName: '',
      tradeName: '',
      cnpj: '',
      email: '',
      phone: '',
      address: '',
    },
  })

  function onSubmit(values: VendorFormValues) {
    setSubmitError(null)
    startTransition(async () => {
      const result = await createVendor(values as Parameters<typeof createVendor>[0])
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
        setSubmitError('Falha inesperada ao cadastrar fornecedor.')
        return
      }
      router.push(`/${tenantSlug}/fornecedores/${created.id}`)
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="legalName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Razão social</FormLabel>
              <FormControl>
                <Input placeholder="Empresa Fornecedora LTDA" {...field} />
              </FormControl>
              <FormDescription>Nome legal completo (PII; LGPD-03 inventário).</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="tradeName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome fantasia (opcional)</FormLabel>
              <FormControl>
                <Input placeholder="Stand Bom de Bola" {...field} value={field.value ?? ''} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="cnpj"
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>CNPJ</FormLabel>
              <FormControl>
                <Controller
                  control={form.control}
                  name="cnpj"
                  render={({ field: cnpjField }) => (
                    <CnpjInput
                      name={cnpjField.name}
                      value={cnpjField.value ?? ''}
                      onChange={cnpjField.onChange}
                      onBlur={cnpjField.onBlur}
                    />
                  )}
                />
              </FormControl>
              {fieldState.error && <FormMessage />}
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email do contato</FormLabel>
              <FormControl>
                <Input type="email" placeholder="contato@empresa.com.br" {...field} />
              </FormControl>
              <FormDescription>PII — recebe notificações de aprovação / contrato.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Telefone (opcional)</FormLabel>
              <FormControl>
                <Input placeholder="+55 (62) 99999-0000" {...field} value={field.value ?? ''} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Endereço (opcional)</FormLabel>
              <FormControl>
                <Input
                  placeholder="Rua, número, bairro, cidade/UF"
                  {...field}
                  value={field.value ?? ''}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {submitError && <p className="text-sm font-medium text-red-500">{submitError}</p>}

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? 'Salvando…' : 'Cadastrar fornecedor'}
        </Button>
      </form>
    </Form>
  )
}
