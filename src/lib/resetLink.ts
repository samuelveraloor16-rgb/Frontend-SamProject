/** Clasifica enlaces de recuperación sin escribir ni conservar la URL. */
export function parseResetLink(url: string): { token: string | null } | null {
  if (!/^samproject:\/\/reset(?:[/?#]|$)/i.test(url)) return null;
  const match = /^samproject:\/\/reset\?token=([a-f0-9]{64})$/i.exec(url);
  return { token: match?.[1] ?? null };
}

export type ResetLinkState = { id: number; token: string | null };

/** Una pantalla antigua nunca puede borrar ni cerrar un enlace posterior. */
export class ResetLinkCoordinator {
  private serial = 0;
  private current: ResetLinkState | null = null;
  private hotResetSeen = false;
  isCurrent(id: number): boolean { return this.current?.id === id; }
  receive(url: string, initial = false): ResetLinkState | null {
    const parsed = parseResetLink(url);
    if (!parsed || (initial && this.hotResetSeen)) return this.current;
    if (!initial) this.hotResetSeen = true;
    if (this.current && this.current.token === parsed.token) return this.current;
    this.current = { id: ++this.serial, token: parsed.token };
    return this.current;
  }
  discard(id: number): ResetLinkState | null {
    if (this.current?.id === id) this.current = { id, token: null };
    return this.current;
  }
  close(id: number): ResetLinkState | null {
    if (this.current?.id === id) this.current = null;
    return this.current;
  }
}
