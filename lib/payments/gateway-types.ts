/**
 * The normalized payment contract the backend returns. The storefront renders
 * from these shapes ALONE — it never sees a gateway response, a provider name,
 * or a channel-specific quirk.
 */

export type PaymentInstruction =
  | {
      type: 'MANUAL_TRANSFER'
      title: string
      description: string
      bank: string
      accountName: string
      accountNumber: string
      amount: number
      uniqueCode: number | null
      steps: string[]
    }
  | { type: 'QR'; title: string; description: string; amount: number; qrString: string | null; qrImageUrl: string | null; steps: string[] }
  | { type: 'VA'; title: string; description: string; amount: number; bank: string; number: string; steps: string[] }
  | { type: 'DEEPLINK'; title: string; description: string; amount: number; buttonText: string; actionUrl: string | null; steps: string[] }
  | { type: 'REDIRECT'; title: string; description: string; amount: number; buttonText: string; actionUrl: string | null; steps: string[] }

/** Additive block a checkout response carries for a gateway payment. */
export interface GatewayPayment {
  paymentMethod: string
  paymentChannel: string
  /** Infrastructure detail — never rendered to the customer. */
  provider: string
  providerStatus: string
  redirectUrl: string | null
  deeplinkUrl: string | null
  qrString: string | null
  vaNumber: string | null
  expiryAt: string | null
  paymentInstruction: PaymentInstruction
}
