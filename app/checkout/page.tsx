'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertCircle, Loader2, MapPin, Banknote, CreditCard, Wallet, ChevronRight } from 'lucide-react'
import { StorefrontShell } from '@/components/storefront/shell'
import { Empty } from '@/components/common/empty'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useMe } from '@/lib/query/hooks/use-me'
import { useCheckout } from '@/lib/query/hooks/use-checkout'
import { useCheckoutSummary } from '@/lib/query/hooks/use-checkout-summary'
import { useCoverageCheck } from '@/lib/query/hooks/use-delivery-coverage'
import { useShippingOptions } from '@/lib/query/hooks/use-shipping-options'
import { useCartStore } from '@/lib/stores/cart-store'
import { useLastOrderStore } from '@/lib/stores/last-order-store'
import { ApiError } from '@/lib/api/client'
import { formatIDR } from '@/lib/utils/format'
import { formatAddressLine } from '@/lib/address/format-address'
import { checkoutSummaryRows } from '@/lib/checkout/summary'
import { cn } from '@/lib/utils'
import type { CreateOrderInput } from '@/lib/api/orders.api'
import type { ShippingOption } from '@/lib/types/models'

const schema = z.object({
  address_id: z.string().min(1, 'Select a delivery address'),
  courier: z.enum(['paxel', 'jne']),
  payment_method: z.enum(['COD', 'BANK_TRANSFER', 'QRIS']),
  voucher_code: z.string().optional(),
})
type FormValues = z.infer<typeof schema>

// Visual config only — values are the exact payment_method enum the schema/payload use.
const PAYMENT_METHODS = [
  { value: 'BANK_TRANSFER', name: 'Bank transfer', description: 'Manual transfer', icon: Banknote },
  { value: 'QRIS', name: 'QRIS', description: 'Scan to pay', icon: CreditCard },
  { value: 'COD', name: 'Cash on delivery', description: 'Pay when it arrives', icon: Wallet },
] as const

export default function CheckoutPage() {
  const router = useRouter()
  const { data: me, isLoading: meLoading } = useMe()
  const lines = useCartStore((s) => s.lines)
  const clearCart = useCartStore((s) => s.clear)
  const setLastOrder = useLastOrderStore((s) => s.setOrder)
  const checkout = useCheckout()

  // Idempotency key — stable across retries; regenerated only on a 422 mismatch.
  const idempotencyKey = useRef<string>(crypto.randomUUID())
  const [conflict, setConflict] = useState<null | 'processing' | 'mismatch'>(null)

  const {
    control,
    register,
    handleSubmit,
    setValue,
    getValues,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { courier: 'jne', payment_method: 'BANK_TRANSFER', voucher_code: '' },
  })

  const addresses = me?.addresses ?? []
  const checkoutItems = useMemo(() => lines.map((l) => ({ product_id: l.productId, qty: l.qty })), [lines])

  // 1) Delivery coverage gate for the selected address (DELIVERY / PICKUP_ONLY / DISABLED).
  const selectedAddressId = watch('address_id')
  const selectedAddress = addresses.find((a) => a.id === selectedAddressId)
  const coverageQuery = useCoverageCheck(selectedAddress)
  const coverage = coverageQuery.data
  const coverageBlocked = coverage?.coverageType === 'DISABLED'
  const coveragePickupOnly = coverage?.coverageType === 'PICKUP_ONLY'
  const deliverable = !!selectedAddress && !coverageBlocked && !coveragePickupOnly

  // 2) When deliverable, fetch shipping quotes from all providers and let the
  //    customer pick one (coverage no longer sets the fee — the provider does).
  const shippingQuery = useShippingOptions(selectedAddressId, checkoutItems, deliverable)
  const shippingOptions = shippingQuery.data ?? []
  const [selectedShipping, setSelectedShipping] = useState<ShippingOption | null>(null)

  // Reset the selection when the address changes; auto-pick the cheapest option once loaded.
  useEffect(() => {
    setSelectedShipping(null)
  }, [selectedAddressId])
  useEffect(() => {
    if (!selectedShipping && shippingOptions.length > 0) {
      const cheapest = [...shippingOptions].sort((a, b) => a.shippingCost - b.shippingCost)[0]
      setSelectedShipping(cheapest)
    }
  }, [shippingOptions, selectedShipping])

  const canPlaceOrder = deliverable && !!selectedShipping

  // Voucher is debounced so the (provider-hitting) summary endpoint is not called
  // on every keystroke; the discount always comes back from the backend summary.
  const voucherCodeRaw = watch('voucher_code')
  const [debouncedVoucher, setDebouncedVoucher] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedVoucher((voucherCodeRaw ?? '').trim()), 500)
    return () => clearTimeout(t)
  }, [voucherCodeRaw])

  // Server-authoritative money: subtotal / shipping / discount / grand total all
  // come from the backend. The frontend NEVER recalculates them.
  const summaryQuery = useCheckoutSummary({
    addressId: selectedAddressId,
    provider: selectedShipping?.provider,
    service: selectedShipping?.service,
    voucherCode: debouncedVoucher,
    items: checkoutItems,
    enabled: canPlaceOrder,
  })
  const summaryRows = summaryQuery.data ? checkoutSummaryRows(summaryQuery.data) : []

  // Preselect the default (or only) address once it loads; don't override a later
  // manual choice.
  useEffect(() => {
    if (addresses.length > 0 && !getValues('address_id')) {
      const preselect = addresses.find((a) => a.isDefault) ?? addresses[0]
      setValue('address_id', preselect.id)
    }
  }, [addresses, getValues, setValue])

  const onSubmit = (values: FormValues) => {
    setConflict(null)
    if (!selectedShipping) return
    const input: CreateOrderInput = {
      address_id: values.address_id,
      // courier kept for backward compatibility; provider+service drive the quote.
      courier: (selectedShipping.provider as 'paxel' | 'jne') ?? values.courier,
      shipping_provider: selectedShipping.provider,
      shipping_service: selectedShipping.service,
      payment_method: values.payment_method,
      voucher_code: values.voucher_code || undefined,
      items: checkoutItems,
    }
    checkout.mutate(
      { input, idempotencyKey: idempotencyKey.current },
      {
        onSuccess: (order) => {
          setLastOrder(order)
          clearCart()
          router.push('/checkout/success')
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) setConflict('processing')
          else if (err instanceof ApiError && err.status === 422) {
            setConflict('mismatch')
            idempotencyKey.current = crypto.randomUUID() // new attempt for a changed cart
          }
        },
      },
    )
  }

  if (meLoading) {
    return (
      <StorefrontShell>
        <div className="mx-auto max-w-2xl px-4 py-16 text-center text-muted-foreground">Loading…</div>
      </StorefrontShell>
    )
  }

  if (!me) {
    return (
      <StorefrontShell>
        <Empty
          title="Please sign in to checkout"
          description="You need an account to place an order."
          action={
            <Button asChild className="mt-2">
              <Link href="/login">Sign in</Link>
            </Button>
          }
        />
      </StorefrontShell>
    )
  }

  if (lines.length === 0) {
    return (
      <StorefrontShell>
        <Empty
          title="Your cart is empty"
          action={
            <Button asChild className="mt-2">
              <Link href="/catalog">Browse catalog</Link>
            </Button>
          }
        />
      </StorefrontShell>
    )
  }

  return (
    <StorefrontShell>
      <section className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold">Checkout</h1>

        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            {/* Left column */}
            <div className="space-y-4">
              {/* Address */}
              <Card className="space-y-3 p-4">
                <div className="flex items-center gap-2">
                  <MapPin className="size-4 text-primary" />
                  <Label className="text-base font-semibold">Delivery address</Label>
                </div>
                {addresses.length === 0 ? (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">You need a delivery address to check out.</p>
                    <Button asChild variant="outline" size="sm">
                      <Link href="/account/addresses">Add address first</Link>
                    </Button>
                  </div>
                ) : (
                  <Controller
                    control={control}
                    name="address_id"
                    render={({ field }) => {
                      const selected = addresses.find((a) => a.id === field.value)
                      return (
                        <div className="space-y-2">
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select an address" />
                            </SelectTrigger>
                            <SelectContent>
                              {addresses.map((a) => (
                                <SelectItem key={a.id} value={a.id}>
                                  {a.label} — {a.recipientName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {selected ? (
                            <div className="rounded-md bg-muted/50 p-3 text-sm">
                              <p className="font-medium">
                                {selected.recipientName} · {selected.phone}
                              </p>
                              <p className="mt-0.5 text-muted-foreground">{formatAddressLine(selected)}</p>
                            </div>
                          ) : null}
                        </div>
                      )
                    }}
                  />
                )}
                {errors.address_id ? <p className="text-sm text-destructive">{errors.address_id.message}</p> : null}

                {/* Delivery coverage status for the selected address */}
                {selectedAddress && coverageQuery.isFetching ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Checking delivery coverage…
                  </p>
                ) : null}
                {coverageBlocked ? (
                  <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                    <AlertCircle className="mt-0.5 size-4" />
                    <span>Sorry, we do not currently deliver to your location.</span>
                  </div>
                ) : coveragePickupOnly ? (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                    <AlertCircle className="mt-0.5 size-4" />
                    <span>This area is only available for Pickup.</span>
                  </div>
                ) : deliverable ? (
                  <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
                    <p className="font-medium">Delivery available to this area.</p>
                  </div>
                ) : null}
              </Card>

              {/* Order items (real cart lines) */}
              <Card className="space-y-3 p-4">
                <h2 className="font-semibold">Order ({lines.length} items)</h2>
                <ul className="space-y-3">
                  {lines.map((line) => (
                    <li key={line.productId} className="flex items-center gap-3">
                      <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={line.imageUrl} alt={line.name} className="size-full object-cover" />
                        <span className="absolute bottom-0 right-0 rounded-tl bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                          x{line.qty}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-1 text-sm font-medium">{line.name}</p>
                        <p className="text-xs text-muted-foreground">{formatIDR(line.price)} each</p>
                      </div>
                      {/* Real unit price × real qty (same per-line summation as cartSubtotal). */}
                      <p className="text-sm font-semibold text-primary">{formatIDR(line.price * line.qty)}</p>
                    </li>
                  ))}
                </ul>
              </Card>

              {/* Shipping service + payment */}
              <Card className="space-y-4 p-4">
                <div className="space-y-2">
                  <Label>Shipping method</Label>
                  {!selectedAddress ? (
                    <p className="text-sm text-muted-foreground">Select a delivery address first.</p>
                  ) : coverageBlocked ? (
                    <p className="text-sm text-muted-foreground">Delivery is unavailable in this area.</p>
                  ) : coveragePickupOnly ? (
                    <p className="text-sm text-muted-foreground">Only pickup is available in this area.</p>
                  ) : shippingQuery.isFetching ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" /> Loading shipping options…
                    </p>
                  ) : shippingQuery.isError ? (
                    <p className="text-sm text-destructive">Unable to load shipping options for this address.</p>
                  ) : shippingOptions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No shipping services available.</p>
                  ) : (
                    <div className="space-y-2">
                      {shippingOptions.map((opt) => {
                        const active =
                          selectedShipping?.provider === opt.provider &&
                          selectedShipping?.service === opt.service
                        return (
                          <button
                            type="button"
                            key={`${opt.provider}-${opt.service}`}
                            onClick={() => setSelectedShipping(opt)}
                            className={cn(
                              'flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors',
                              active ? 'border-primary bg-primary/5' : 'hover:border-primary/50',
                            )}
                          >
                            <div>
                              <p className="text-sm font-medium">{opt.serviceName}</p>
                              <p className="text-xs text-muted-foreground">{opt.estimatedDays}</p>
                            </div>
                            <span className="text-sm font-semibold">{formatIDR(opt.shippingCost)}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Payment method</Label>
                  <Controller
                    control={control}
                    name="payment_method"
                    render={({ field }) => (
                      <RadioGroup value={field.value} onValueChange={field.onChange} className="space-y-2">
                        {PAYMENT_METHODS.map((m) => {
                          const Icon = m.icon
                          const active = field.value === m.value
                          return (
                            <Label
                              key={m.value}
                              htmlFor={`pm-${m.value}`}
                              className={cn(
                                'flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors',
                                active ? 'border-primary bg-primary/5' : 'hover:border-primary/50',
                              )}
                            >
                              <RadioGroupItem value={m.value} id={`pm-${m.value}`} />
                              <Icon className="size-5 text-muted-foreground" />
                              <div className="flex-1">
                                <p className="text-sm font-medium">{m.name}</p>
                                <p className="text-xs text-muted-foreground">{m.description}</p>
                              </div>
                            </Label>
                          )
                        })}
                      </RadioGroup>
                    )}
                  />
                </div>
              </Card>
            </div>

            {/* Right column — sticky summary */}
            <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
              <Card className="space-y-2 p-4">
                <Label htmlFor="voucher">Voucher code (optional)</Label>
                <Input id="voucher" placeholder="e.g. WELCOME10" {...register('voucher_code')} />
              </Card>

              <Card className="space-y-3 p-4">
                <h2 className="font-semibold">Order summary</h2>
                {/* Every amount below is rendered verbatim from the backend
                    /checkout/summary response — the client performs no money math. */}
                {!canPlaceOrder ? (
                  <p className="text-xs text-muted-foreground">
                    Select a delivery address and shipping service to see the total.
                  </p>
                ) : summaryQuery.isLoading ? (
                  <div className="space-y-2" aria-busy="true">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-4 w-full animate-pulse rounded bg-muted" />
                    ))}
                  </div>
                ) : summaryQuery.isError ? (
                  <p className="text-xs text-destructive">
                    {(summaryQuery.error as Error)?.message ?? 'Unable to load the order total.'}
                  </p>
                ) : (
                  summaryRows.map((row) => (
                    <div
                      key={row.key}
                      className={cn(
                        'flex items-center justify-between text-sm',
                        row.key === 'grand_total' && 'font-semibold',
                      )}
                    >
                      <span className={row.key === 'grand_total' ? '' : 'text-muted-foreground'}>{row.label}</span>
                      <span className={row.key === 'grand_total' ? '' : 'font-medium'}>
                        {row.key === 'discount' ? `- ${formatIDR(Math.abs(row.value))}` : formatIDR(row.value)}
                      </span>
                    </div>
                  ))
                )}
                <Separator />

                {conflict ? (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
                    <AlertCircle className="mt-0.5 size-4 text-amber-600" />
                    <span>
                      {conflict === 'processing'
                        ? 'Your order is already being processed. Wait a moment, then retry — it will not create a duplicate.'
                        : 'Your cart changed since the last attempt. Review and place the order again.'}
                    </span>
                  </div>
                ) : null}

                <Button
                  type="submit"
                  size="lg"
                  className="w-full rounded-full"
                  disabled={checkout.isPending || !canPlaceOrder}
                >
                  {checkout.isPending ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" /> Placing order…
                    </>
                  ) : coverageBlocked ? (
                    'Delivery unavailable in this area'
                  ) : coveragePickupOnly ? (
                    'Pickup only in this area'
                  ) : (
                    <>
                      Place order
                      <ChevronRight className="ml-1 size-4" />
                    </>
                  )}
                </Button>
              </Card>
            </div>
          </div>
        </form>
      </section>
    </StorefrontShell>
  )
}
