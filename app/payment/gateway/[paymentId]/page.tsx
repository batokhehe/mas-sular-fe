'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Check, Copy, Download, ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PaymentCountdown } from '@/components/payment/payment-countdown'
import { paymentsApi } from '@/lib/api/payments.api'
import type { PaymentInstruction } from '@/lib/payments/gateway-types'
import { formatIDR } from '@/lib/utils/format'

/** Copy-to-clipboard button with inline confirmation. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard?.writeText(value)
        setCopied(true)
        toast.success(`${label} disalin`)
        window.setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <Check className="mr-2 size-4" /> : <Copy className="mr-2 size-4" />}
      Salin
    </Button>
  )
}

function AmountRow({ amount }: { amount: number }) {
  return (
    <div className="flex items-center justify-between rounded-xl border p-3">
      <div>
        <p className="text-xs text-muted-foreground">Total pembayaran</p>
        <p className="text-lg font-semibold">{formatIDR(amount)}</p>
      </div>
      <CopyButton value={String(amount)} label="Nominal" />
    </div>
  )
}

function Steps({ steps }: { steps: string[] }) {
  if (steps.length === 0) return null
  return (
    <ol className="list-decimal space-y-1 rounded-xl bg-muted/40 p-4 pl-8 text-sm text-muted-foreground">
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  )
}

/** One renderer per normalized instruction type — no gateway knowledge anywhere. */
function InstructionView({ instruction, expired }: { instruction: PaymentInstruction; expired: boolean }) {
  switch (instruction.type) {
    case 'QR':
      return (
        <div className="space-y-4">
          <AmountRow amount={instruction.amount} />
          <div className="flex flex-col items-center gap-3 rounded-xl border p-6">
            {instruction.qrImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={instruction.qrImageUrl} alt="Kode QRIS" className="size-56 object-contain" />
            ) : (
              <div className="flex size-56 items-center justify-center rounded-lg bg-muted p-4 text-center text-xs text-muted-foreground">
                Kode QR akan tampil di aplikasi pembayaran Anda.
              </div>
            )}
            {instruction.qrImageUrl && (
              <Button asChild variant="outline" size="sm" disabled={expired}>
                <a href={instruction.qrImageUrl} download="qris.png" target="_blank" rel="noreferrer">
                  <Download className="mr-2 size-4" /> Unduh QR
                </a>
              </Button>
            )}
          </div>
          <Steps steps={instruction.steps} />
        </div>
      )

    case 'VA':
      return (
        <div className="space-y-4">
          <div className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">{instruction.bank} Virtual Account</p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <p className="font-mono text-xl font-semibold tracking-wide">{instruction.number || '—'}</p>
              {instruction.number && <CopyButton value={instruction.number} label="Nomor VA" />}
            </div>
          </div>
          <AmountRow amount={instruction.amount} />
          <Steps steps={instruction.steps} />
        </div>
      )

    case 'DEEPLINK':
    case 'REDIRECT':
      return (
        <div className="space-y-4">
          <AmountRow amount={instruction.amount} />
          <Button asChild className="w-full rounded-full" size="lg" disabled={expired || !instruction.actionUrl}>
            <a href={instruction.actionUrl ?? '#'} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-2 size-4" />
              {instruction.buttonText}
            </a>
          </Button>
          {!instruction.actionUrl && (
            <p className="text-center text-sm text-muted-foreground">
              Tautan pembayaran belum tersedia. Muat ulang halaman ini sebentar lagi.
            </p>
          )}
          <Steps steps={instruction.steps} />
        </div>
      )

    case 'MANUAL_TRANSFER':
    default:
      return (
        <div className="space-y-4">
          <div className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">{instruction.bank}</p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <p className="font-mono text-xl font-semibold">{instruction.accountNumber}</p>
              <CopyButton value={instruction.accountNumber} label="Nomor rekening" />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">a.n. {instruction.accountName}</p>
          </div>
          <AmountRow amount={instruction.amount} />
          <Steps steps={instruction.steps} />
        </div>
      )
  }
}

export default function GatewayPaymentPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = use(params)
  const [expired, setExpired] = useState(false)

  // Read-only: rebuilds the stored attempt. Refreshing never re-charges.
  const query = useQuery({
    queryKey: ['payment-instructions', paymentId],
    queryFn: () => paymentsApi.instructions(paymentId),
    retry: false,
  })

  const gateway = query.data?.gateway ?? null

  return (
    <main className="container max-w-lg space-y-4 px-4 py-8">
      {query.isLoading ? (
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : query.isError || !gateway ? (
        <Card className="space-y-3 p-6 text-center">
          <p className="font-medium">Instruksi pembayaran tidak tersedia</p>
          <p className="text-sm text-muted-foreground">
            Pesanan Anda tetap tersimpan. Buka daftar pesanan untuk melihat status pembayaran.
          </p>
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/orders">Lihat Pesanan</Link>
          </Button>
        </Card>
      ) : (
        <>
          <div className="text-center">
            <h1 className="text-xl font-bold">{gateway.paymentInstruction.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{gateway.paymentInstruction.description}</p>
          </div>

          <PaymentCountdown expiryAt={gateway.expiryAt} onExpire={() => setExpired(true)} />

          <Card className="p-4">
            <InstructionView instruction={gateway.paymentInstruction} expired={expired} />
          </Card>

          <Button asChild variant="outline" className="w-full rounded-full">
            <Link href="/orders">Lihat Status Pesanan</Link>
          </Button>
        </>
      )}
    </main>
  )
}
