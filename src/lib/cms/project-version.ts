/**
 * Next `updatedAt` for a guarded project save. The compare-and-update only
 * matches when the stored value equals `expected`, so stepping at least one
 * millisecond (the column's TIMESTAMP(3) precision) past it guarantees every
 * successful save invalidates the token it consumed, even when the
 * application clock has not advanced or runs behind.
 */
export function nextProjectVersion(expected: Date, now: Date = new Date()): Date {
  return new Date(Math.max(now.getTime(), expected.getTime() + 1));
}
