/** Web preview: the browser's own print dialog (with "Save as PDF") on the report's HTML. */
export async function sharePdf(html: string, _dialogTitle: string): Promise<boolean> {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
  return true;
}
