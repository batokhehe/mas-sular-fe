import { cn } from '@/lib/utils'

/**
 * Local logo artwork keyed by the backend's stable provider id.
 *
 * Deliberately EMPTY: the repository ships no Paxel/JNE artwork, and this phase
 * may not introduce remote image URLs, base64 blobs, or third-party assets. Every
 * provider therefore renders the monogram fallback below. Dropping a real,
 * licensed file into `public/providers/` and adding one line here is the only
 * change needed to switch a provider over — no component edit, no new branch.
 */
const PROVIDER_LOGOS: Record<string, string> = {}

/** Short, stable monogram for a provider with no artwork (e.g. 'Paxel' -> 'PA'). */
function monogram(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) return '?'
  return (trimmed.length <= 3 ? trimmed : trimmed.slice(0, 2)).toUpperCase()
}

/**
 * Provider mark for a checkout shipping group. Both branches occupy the exact
 * same 36x36 box, so swapping artwork in never shifts the layout, and `shrink-0`
 * keeps it from crowding the heading on narrow screens.
 */
export function ProviderLogo({
  provider,
  title,
  className,
}: {
  provider: string
  title: string
  className?: string
}) {
  const src = PROVIDER_LOGOS[provider.toLowerCase()]

  if (src) {
    return (
      <img
        src={src}
        alt={`Logo ${title}`}
        width={36}
        height={36}
        className={cn('size-9 shrink-0 rounded-lg object-contain', className)}
      />
    )
  }

  return (
    <span
      // Decorative: the group heading next to it already names the provider,
      // so announcing the monogram too would just repeat it.
      aria-hidden="true"
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted',
        'text-[11px] font-semibold uppercase tracking-tight text-muted-foreground',
        className,
      )}
    >
      {monogram(title)}
    </span>
  )
}
