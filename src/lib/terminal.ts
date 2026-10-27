export type TerminalKind = 'command' | 'output' | 'muted' | 'ok' | 'warn' | 'error'

export interface TerminalEntry {
  kind: TerminalKind
  text: string
}

export const terminalLineClass: Record<TerminalKind, string> = {
  command: 'text-[#7ee787]',
  output: 'text-[#c9d6cf]',
  muted: 'text-[#6f8378]',
  ok: 'text-[#7ee787]',
  warn: 'text-[#d29922]',
  error: 'text-[#ff7b72]',
}

/**
 * Echoes a command without its secret-bearing arguments.
 *
 * `revoke` used to take a refresh token; it now takes a session id, but users
 * may still paste a token from an old bookmark, so the argument is redacted
 * either way. `verify` is handled separately by the email-verification page.
 */
export function redactCommand(input: string): string {
  const trimmed = input.trim()
  const [command, ...args] = trimmed.split(/\s+/)
  if (command?.toLowerCase() === 'revoke' && args.length > 0) {
    return 'revoke <redacted>'
  }
  return trimmed
}
