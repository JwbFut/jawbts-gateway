/** Time-of-day greeting used by the `welcome` command. */
export type DayPeriod = 'morning' | 'afternoon' | 'evening' | 'midnight'

/**
 * Maps the browser's local hour to a greeting.
 *
 * 05:00–11:59 morning, 12:00–17:59 afternoon, 18:00–21:59 evening, and
 * 22:00–04:59 midnight (the "Good midnight" bucket requested by the UI).
 */
export function greetingFor(date: Date = new Date()): DayPeriod {
  const hour = date.getHours()
  if (hour >= 5 && hour < 12) {
    return 'morning'
  }
  if (hour >= 12 && hour < 18) {
    return 'afternoon'
  }
  if (hour >= 18 && hour < 22) {
    return 'evening'
  }
  return 'midnight'
}
