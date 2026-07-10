/** Extract the 12-char short ID from a Docker container ID */
export function shortId(fullId: string): string {
  return fullId.substring(0, 12);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
