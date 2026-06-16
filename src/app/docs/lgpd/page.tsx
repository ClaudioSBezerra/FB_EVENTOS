import Link from 'next/link'

export const metadata = {
  title: 'Política de Privacidade e LGPD · FB_EVENTOS',
  description:
    'Como a FB_EVENTOS coleta, trata e protege seus dados pessoais conforme a Lei 13.709/2018 (LGPD).',
}

const LAST_UPDATED = '2026-06-01'

export default function LgpdDocsPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            FB<span className="text-emerald-600">_</span>EVENTOS
          </Link>
          <Link href="/login" className="text-sm text-slate-600 hover:text-slate-900">
            Entrar
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-sm text-slate-500">
          Última atualização: <strong>{LAST_UPDATED}</strong>
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
          Política de Privacidade e LGPD
        </h1>
        <p className="mt-4 text-slate-700">
          Esta política descreve como a FB_EVENTOS, operada por Fortes Bezerra, coleta, utiliza,
          armazena e protege os seus dados pessoais em conformidade com a Lei 13.709/2018 (LGPD).
        </p>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">1. Dados coletados</h2>
          <p className="text-slate-700">
            Coletamos apenas o necessário para operar a plataforma e prestar o serviço contratado:
          </p>
          <ul className="ml-6 list-disc space-y-1 text-slate-700">
            <li>Nome, email e senha (criptografada) — para identificação e acesso.</li>
            <li>Nome e CNPJ da organizadora/fornecedor — para emissão de contratos e cobranças.</li>
            <li>Endereço IP e user-agent — para auditoria e segurança.</li>
            <li>Dados de pagamento via Pagar.me (não armazenamos cartão na nossa base).</li>
          </ul>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">2. Finalidades</h2>
          <ul className="ml-6 list-disc space-y-1 text-slate-700">
            <li>Operar a plataforma multi-tenant (autenticação, sessão, isolamento de dados).</li>
            <li>Emitir contratos digitais entre organizadora e fornecedor.</li>
            <li>Processar pagamentos via gateway integrado (Pagar.me).</li>
            <li>Comunicar atualizações operacionais (email transacional).</li>
            <li>Cumprir obrigações legais e regulatórias.</li>
          </ul>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">3. Base legal</h2>
          <p className="text-slate-700">
            Tratamos seus dados com base em: (i) <strong>consentimento</strong> dado no cadastro;
            (ii) <strong>execução de contrato</strong>; (iii){' '}
            <strong>cumprimento de obrigação legal</strong>; (iv){' '}
            <strong>legítimo interesse</strong> em segurança e prevenção a fraudes.
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">4. Compartilhamento</h2>
          <p className="text-slate-700">
            Não vendemos dados. Compartilhamos apenas com operadores estritamente necessários:
          </p>
          <ul className="ml-6 list-disc space-y-1 text-slate-700">
            <li>Pagar.me — processamento de PIX e cartão.</li>
            <li>ZapSign — assinatura digital de contratos.</li>
            <li>BrasilAPI — consulta pública de CNPJ.</li>
            <li>Provedor de email transacional (Hostinger SMTP).</li>
          </ul>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">5. Seus direitos (Art. 18 LGPD)</h2>
          <p className="text-slate-700">A qualquer momento você pode:</p>
          <ul className="ml-6 list-disc space-y-1 text-slate-700">
            <li>Confirmar a existência de tratamento dos seus dados.</li>
            <li>Acessar e corrigir dados incompletos, inexatos ou desatualizados.</li>
            <li>Solicitar anonimização, bloqueio ou eliminação de dados desnecessários.</li>
            <li>Solicitar a portabilidade dos seus dados.</li>
            <li>Revogar o consentimento previamente concedido.</li>
          </ul>
          <p className="text-slate-700">
            Solicitações podem ser enviadas para{' '}
            <a className="underline" href="mailto:contato@fortesbezerra.com.br">
              contato@fortesbezerra.com.br
            </a>{' '}
            ou via página de perfil quando logado.
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">6. Retenção</h2>
          <p className="text-slate-700">
            Dados de auditoria são mantidos pelo prazo legal aplicável. Dados pessoais são
            anonimizados após 30 dias da exclusão da conta, exceto quando obrigação legal exigir
            retenção maior.
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">7. Segurança</h2>
          <p className="text-slate-700">
            Adotamos medidas técnicas e administrativas: criptografia em trânsito (TLS), senhas com
            hash argon2, isolamento de dados por tenant via Postgres Row-Level Security forçado,
            registro de acessos sensíveis em audit log append-only.
          </p>
        </section>

        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">8. Contato do Encarregado (DPO)</h2>
          <p className="text-slate-700">
            Encarregado de Dados:{' '}
            <a className="underline" href="mailto:contato@fortesbezerra.com.br">
              contato@fortesbezerra.com.br
            </a>
          </p>
        </section>

        <p className="mt-12 text-sm text-slate-500">
          Esta política pode ser atualizada. Versões anteriores ficam disponíveis mediante
          solicitação. Versão vigente: <strong>{LAST_UPDATED}</strong>.
        </p>

        <div className="mt-10">
          <Link href="/signup" className="text-emerald-600 underline">
            ← Voltar para o cadastro
          </Link>
        </div>
      </main>
    </div>
  )
}
