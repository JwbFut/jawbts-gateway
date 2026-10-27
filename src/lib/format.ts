const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
})

const relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** "Mar 8, 2026, 4:05 PM" in the visitor's locale-independent English format. */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value)
  return date ? dateTimeFormatter.format(date) : '—'
}

export function formatDate(value: string | number | Date | null | undefined): string {
  const date = toDate(value)
  return date ? dateFormatter.format(date) : '—'
}

export function formatRelative(value: string | number | Date | null | undefined): string {
  const date = toDate(value)
  if (!date) {
    return '—'
  }
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000)
  const abs = Math.abs(diffSeconds)
  if (abs < 45) {
    return relativeFormatter.format(diffSeconds, 'second')
  }
  const diffMinutes = Math.round(diffSeconds / 60)
  if (Math.abs(diffMinutes) < 60) {
    return relativeFormatter.format(diffMinutes, 'minute')
  }
  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) {
    return relativeFormatter.format(diffHours, 'hour')
  }
  const diffDays = Math.round(diffHours / 24)
  if (Math.abs(diffDays) < 30) {
    return relativeFormatter.format(diffDays, 'day')
  }
  const diffMonths = Math.round(diffDays / 30)
  if (Math.abs(diffMonths) < 12) {
    return relativeFormatter.format(diffMonths, 'month')
  }
  return relativeFormatter.format(Math.round(diffMonths / 12), 'year')
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
