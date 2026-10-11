// Thrown-value readers shared by the scripts: a catch variable is unknown, and these
// read the code and message shapes the filesystem and decoder calls throw.
export function thrownCode(e: unknown): unknown {
  return typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
}

export function thrownMessage(e: unknown): unknown {
  return typeof e === "object" && e !== null ? (e as { message?: unknown }).message : undefined;
}

export function thrownDetail(e: unknown): unknown {
  return thrownMessage(e) ?? e;
}
