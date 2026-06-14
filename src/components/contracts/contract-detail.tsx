// FB_EVENTOS — Contract detail panel (Phase 1, Plan 01-05 Task 2).

interface ContractDetailProps {
  id: string
  status: string
  templateVersion: string
  pdfMinioKey: string | null
  zapsignDocId: string | null
  signedPdfMinioKey: string | null
  createdAt: Date
  pdfUrl: string | null
  signedPdfUrl: string | null
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

export function ContractDetail(props: ContractDetailProps) {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        <dt className="font-semibold text-slate-600">ID</dt>
        <dd className="font-mono text-xs">{props.id.slice(0, 8).toUpperCase()}</dd>

        <dt className="font-semibold text-slate-600">Status</dt>
        <dd>{props.status}</dd>

        <dt className="font-semibold text-slate-600">Template</dt>
        <dd className="text-xs">{props.templateVersion}</dd>

        <dt className="font-semibold text-slate-600">Emitido em</dt>
        <dd className="text-xs">{dateFmt.format(props.createdAt)}</dd>

        {props.zapsignDocId && (
          <>
            <dt className="font-semibold text-slate-600">ZapSign ID</dt>
            <dd className="font-mono text-xs">{props.zapsignDocId}</dd>
          </>
        )}
      </dl>

      <div className="space-y-1 pt-2">
        {props.pdfUrl ? (
          <a
            href={props.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:underline"
          >
            Baixar PDF (draft) ↓
          </a>
        ) : (
          <p className="text-sm text-slate-500">PDF em geração…</p>
        )}
        {props.signedPdfUrl && (
          <a
            href={props.signedPdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-sm font-semibold text-green-700 hover:underline"
          >
            Baixar PDF assinado ↓
          </a>
        )}
      </div>
    </div>
  )
}
