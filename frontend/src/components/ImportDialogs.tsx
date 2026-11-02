/** F29 imports: students from a spreadsheet (personal invites) and workouts from pasted quick text. */
import { CircleAlert, CircleCheck, Copy, FileSpreadsheet, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useSaveTemplate } from "@/api/library";
import { useGroups } from "@/api/members";
import type { Club, Sport } from "@/api/types";
import { estimate } from "@/domain/workout";
import { parseQuickText } from "@/domain/quicktext";
import { t, tn } from "@/i18n";
import { api } from "@/lib/api";
import { parseCsv } from "@/lib/csv";
import { queryClient } from "@/queryClient";
import { Badge, Button, Dialog, Select, Textarea, cn, toast } from "@/ui";
import { SPORTS, SPORT_LABEL } from "./sport";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const REASON: Record<string, string> = { invalid_email: "e-mail inválido", duplicate: "repetido na planilha", already_member: "já é aluno", already_invited: "já tem convite" };
interface BulkResult { created: number; items: { email: string; url: string; name: string | null }[]; skipped: { row: number; email: string; reason: string }[]; over_limit: number }

export function ImportStudentsDialog({ club, open, onOpenChange }: { club: Club; open: boolean; onOpenChange: (v: boolean) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange} size="lg" title={t("Importar alunos")} description={t("Cole a planilha ou envie um arquivo CSV com nome, e-mail e grupos. Cada aluno recebe um convite pessoal por e-mail.")}>{open && <StudentsBody club={club} onClose={() => onOpenChange(false)} />}</Dialog>;
}
function StudentsBody({ club, onClose }: { club: Club; onClose: () => void }) {
  const groups = useGroups(club.id);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const rows = useMemo(() => {
    const all = parseCsv(text);
    if (!all.length) return [];
    const head = all[0]!.map((h) => h.toLowerCase());
    const hasHeader = head.some((h) => /e-?mail/.test(h));
    const col = (re: RegExp, fallback: number) => { const i = head.findIndex((h) => re.test(h)); return hasHeader && i >= 0 ? i : fallback; };
    const [ni, ei, gi] = [col(/nome|name/, 0), col(/e-?mail/, 1), col(/grupo|group/, 2)];
    return (hasHeader ? all.slice(1) : all).map((r) => ({ name: r[ni] ?? "", email: (r[ei] ?? "").toLowerCase(), groups: r[gi] ?? "" }));
  }, [text]);
  const known = new Set((groups.data ?? []).map((g) => g.name.toLowerCase()));
  const valid = rows.filter((r) => EMAIL.test(r.email));
  const send = async () => {
    setBusy(true);
    try { const r = await api.post<BulkResult>(`/clubs/${club.id}/invites/bulk`, { rows: valid }); setResult(r); queryClient.invalidateQueries({ queryKey: ["clubs", club.id, "invites"] }); toast.success(tn(r.created, "{n} convite enviado", "{n} convites enviados")); }
    catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  if (result) return (
    <div className="grid gap-4">
      <p className="flex items-center gap-2 rounded-lg bg-success-soft px-4 py-3 text-on-success-soft"><CircleCheck className="size-5" />{tn(result.created, "{n} convite criado. O aluno recebe o link por e-mail.", "{n} convites criados. Cada aluno recebe o link por e-mail.")}</p>
      {result.over_limit > 0 && <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-4 py-3 text-sm text-on-warning-soft"><CircleAlert className="mt-0.5 size-4 shrink-0" />{tn(result.over_limit, "{n} aluno passa do limite do plano: ele só consegue entrar quando houver vaga.", "{n} alunos passam do limite do plano: eles só conseguem entrar quando houver vaga.")}</p>}
      {result.skipped.length > 0 && <div className="grid gap-1"><h3 className="rf-text-title-sm">{t("Não importados")}</h3><ul className="text-sm text-fg-muted">{result.skipped.map((s) => <li key={s.row}>{t("Linha {n}", { n: s.row })}: {s.email || "–"} · {t(REASON[s.reason] ?? s.reason)}</li>)}</ul></div>}
      {result.items.length > 0 && <Button variant="secondary" icon={<Copy />} className="justify-self-start" onClick={() => navigator.clipboard?.writeText(result.items.map((i) => `${i.name ?? i.email}: ${i.url}`).join("\n")).then(() => toast.success(t("Links copiados")))}>{t("Copiar os links")}</Button>}
      <div className="flex justify-end"><Button onClick={onClose}>{t("Concluir")}</Button></div>
    </div>
  );
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" icon={<Upload />} onClick={() => file.current?.click()}>{t("Enviar arquivo CSV")}</Button>
        <span className="text-sm text-fg-muted">{t("ou cole abaixo (do Excel ou Google Planilhas)")}</span>
        <input ref={file} type="file" accept=".csv,text/csv,text/plain" className="hidden" aria-label={t("Arquivo CSV")} onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); e.target.value = ""; }} />
      </div>
      <Textarea aria-label={t("Planilha de alunos")} rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={"nome;email;grupos\nAna Souza;ana@email.com;Iniciantes\nBruno Lima;bruno@email.com;Força e corrida"} className="font-mono text-sm" />
      {rows.length > 0 && (
        <div className="max-h-64 overflow-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-sunken text-left text-xs text-fg-muted"><tr><th className="px-3 py-2 font-semibold">{t("Nome")}</th><th className="px-3 py-2 font-semibold">{t("E-mail")}</th><th className="px-3 py-2 font-semibold">{t("Grupos")}</th></tr></thead>
            <tbody className="divide-y divide-line-subtle">
              {rows.map((r, i) => (
                <tr key={i} className={cn(!EMAIL.test(r.email) && "text-danger-text")}>
                  <td className="px-3 py-1.5">{r.name || "–"}</td>
                  <td className="px-3 py-1.5">{r.email || "–"}{!EMAIL.test(r.email) && <Badge tone="danger" className="ml-2">{t("inválido")}</Badge>}</td>
                  <td className="px-3 py-1.5">{r.groups.split(/[,|]/).map((g) => g.trim()).filter(Boolean).map((g) => <Badge key={g} tone={known.has(g.toLowerCase()) ? "info" : "neutral"} className="mr-1">{g}{known.has(g.toLowerCase()) ? "" : ` (${t("não existe")})`}</Badge>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm text-fg-muted"><FileSpreadsheet className="size-4" />{rows.length ? t("{v} de {n} linhas válidas", { v: valid.length, n: rows.length }) : t("Colunas: nome, e-mail e grupos (opcional)")}</span>
        <Button disabled={!valid.length} loading={busy} onClick={send}>{valid.length ? tn(valid.length, "Convidar {n} aluno", "Convidar {n} alunos") : t("Convidar")}</Button>
      </div>
    </div>
  );
}

export function ImportWorkoutsDialog({ club, open, onOpenChange }: { club: Club; open: boolean; onOpenChange: (v: boolean) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange} size="lg" title={t("Importar treinos")} description={t("Um treino por linha: nome, dois-pontos e o treino em escrita rápida. Ótimo para trazer a planilha que você já tem.")}>{open && <WorkoutsBody club={club} onClose={() => onOpenChange(false)} />}</Dialog>;
}
function WorkoutsBody({ club, onClose }: { club: Club; onClose: () => void }) {
  const save = useSaveTemplate(club.id);
  const [sport, setSport] = useState<Sport>(club.modalities[0] ?? "run");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const items = useMemo(() => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const i = line.indexOf(":");
    const name = i > 0 ? line.slice(0, i).trim() : "";
    const body = i > 0 ? line.slice(i + 1).trim() : line;
    const r = parseQuickText(body, sport);
    return { line, name: name || body.slice(0, 40), structure: r.structure, ok: r.structure.blocks.length > 0 && !r.warnings.length, warnings: r.warnings };
  }), [text, sport]);
  const good = items.filter((x) => x.ok);
  const go = async () => {
    setBusy(true);
    try {
      for (const it of good) { const est = estimate(it.structure, sport); await save.mutateAsync({ data: { name: it.name, sport, structure: it.structure, description: null, est_duration_s: est.duration_s || null, est_distance_m: est.distance_m, tags: ["importado"] } }); }
      toast.success(tn(good.length, "{n} treino importado", "{n} treinos importados"), t("Estão na biblioteca com a etiqueta “importado”."));
      onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-4">
      <Select aria-label={t("Modalidade")} value={sport} onChange={(e) => setSport(e.target.value as Sport)} className="w-48">{SPORTS.map((s) => <option key={s} value={s}>{t(SPORT_LABEL[s])}</option>)}</Select>
      <Textarea aria-label={t("Treinos em escrita rápida")} rows={6} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-sm"
        placeholder={"Tiros 6x1km: 15' aquec + 6x1km @4:30 c/ 2' trote + 10' desaq\nRegenerativo: 40' Z1\nLongão: 1h40 Z2"} />
      {items.length > 0 && (
        <ul className="grid max-h-56 gap-1 overflow-auto text-sm">
          {items.map((x, i) => <li key={i} className="flex items-start gap-2">{x.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-success-text" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning-text" />}<span><b>{x.name}</b>{!x.ok && <span className="text-fg-muted"> · {x.warnings[0] ?? t("não entendi esta linha")}</span>}</span></li>)}
        </ul>
      )}
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{t("Cancelar")}</Button><Button disabled={!good.length} loading={busy} onClick={go}>{good.length ? tn(good.length, "Importar {n} treino", "Importar {n} treinos") : t("Importar")}</Button></div>
    </div>
  );
}
