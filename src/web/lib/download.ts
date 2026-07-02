/** Trigger a browser download of a Blob under the given filename */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadText(text: string, mime: string, filename: string): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}
