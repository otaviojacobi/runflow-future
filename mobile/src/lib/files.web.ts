/** Web preview: the browser downloads the file (there is no share sheet for local files on the web). */
export async function shareTextFile(name: string, text: string, mimeType: string, _dialogTitle: string): Promise<boolean> {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
  return true;
}
