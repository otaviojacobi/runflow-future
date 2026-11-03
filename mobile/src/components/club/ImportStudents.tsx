/**
 * Importing students from a spreadsheet (O2, the web's ImportStudentsDialog): a CSV file from the phone or text pasted
 * from Excel / Google Planilhas, columns name, e-mail and groups; each valid row gets a personal invite by e-mail
 * (D-023). Seats over the plan's limit wait for a free seat (D-043).
 */
import * as Clipboard from "expo-clipboard";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useBulkInvites, type BulkResult } from "@/api/clubs";
import { useGroups } from "@/api/staff";
import { t, tn } from "@/i18n";
import { parseCsv } from "@/lib/csv";
import { pickTextFile } from "@/lib/textfile";
import { useTheme } from "@/theme/ThemeProvider";
import { Badge, Button, Dialog, Text, Textarea, toast } from "@/ui";
import { CircleAlert, CircleCheck, Copy, FileSpreadsheet, Upload } from "@/ui/icons";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const REASON: Record<string, string> = { invalid_email: "e-mail inválido", duplicate: "repetido na planilha", already_member: "já é aluno", already_invited: "já tem convite" };

export function ImportStudentsSheet({ clubId, open, onOpenChange }: { clubId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("Importar alunos")}
      description={t("Envie um arquivo CSV ou cole a planilha com nome, e-mail e grupos. Cada aluno recebe um convite pessoal por e-mail.")}>
      {open && <Body clubId={clubId} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function Body({ clubId, onClose }: { clubId: string; onClose: () => void }) {
  const { theme } = useTheme();
  const c = theme.color;
  const groups = useGroups(clubId);
  const bulk = useBulkInvites(clubId);
  const [text, setText] = useState("");
  const [result, setResult] = useState<BulkResult | null>(null);
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
  const pick = async () => {
    try {
      const f = await pickTextFile(["text/csv", "text/comma-separated-values", "text/plain", "application/vnd.ms-excel"]);
      if (f) setText(f.text);
    } catch {
      toast.info(t("Não conseguimos ler o arquivo"), t("Exporte a planilha como CSV e tente de novo."));
    }
  };
  const send = () => bulk.mutate(valid, {
    onSuccess: (r) => { setResult(r); toast.success(tn(r.created, "{n} convite enviado", "{n} convites enviados")); },
    onError: toast.error,
  });

  if (result) {
    return (
      <View style={{ gap: theme.space[4] }}>
        <View style={[styles.row, { gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: c.success.subtle }]}>
          <CircleCheck size={theme.size.iconMd} color={c.success.subtleFg} aria-hidden />
          <Text variant="bodySm" color={c.success.subtleFg} style={styles.flex}>{tn(result.created, "{n} convite criado. O aluno recebe o link por e-mail.", "{n} convites criados. Cada aluno recebe o link por e-mail.")}</Text>
        </View>
        {result.over_limit > 0 && (
          <View style={[styles.row, styles.top, { gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: c.warning.subtle }]}>
            <CircleAlert size={theme.size.iconSm} color={c.warning.subtleFg} aria-hidden style={{ marginTop: theme.space["0.5"] }} />
            <Text variant="bodySm" color={c.warning.subtleFg} style={styles.flex}>{tn(result.over_limit, "{n} aluno passa do limite do plano: ele só consegue entrar quando houver vaga.", "{n} alunos passam do limite do plano: eles só conseguem entrar quando houver vaga.")}</Text>
          </View>
        )}
        {result.skipped.length > 0 && (
          <View style={{ gap: theme.space[1] }}>
            <Text variant="titleSm" accessibilityRole="header">{t("Não importados")}</Text>
            {result.skipped.map((s) => <Text key={s.row} variant="bodySm" tone="muted">{t("Linha {n}", { n: s.row })}: {s.email || "–"} · {t(REASON[s.reason] ?? s.reason)}</Text>)}
          </View>
        )}
        {result.items.length > 0 && (
          <Button variant="secondary" icon={Copy} style={styles.start} onPress={async () => {
            await Clipboard.setStringAsync(result.items.map((i) => `${i.name ?? i.email}: ${i.url}`).join("\n"));
            toast.success(t("Links copiados"));
          }}>{t("Copiar os links")}</Button>
        )}
        <Button block onPress={onClose}>{t("Concluir")}</Button>
      </View>
    );
  }
  return (
    <View style={{ gap: theme.space[4] }}>
      <Button variant="secondary" icon={Upload} style={styles.start} onPress={() => void pick()}>{t("Escolher arquivo CSV")}</Button>
      <Text variant="bodySm" tone="muted">{t("ou cole abaixo (do Excel ou Google Planilhas)")}</Text>
      <Textarea accessibilityLabel={t("Planilha de alunos")} value={text} onChangeText={setText} autoCapitalize="none" autoCorrect={false}
        placeholder={"nome;email;grupos\nAna Souza;ana@email.com;Iniciantes"} style={{ minHeight: theme.space[20] + theme.space[8] }} />
      {rows.length > 0 && (
        <View style={{ borderWidth: 1, borderColor: c.line, borderRadius: theme.radius.md }}>
          {rows.slice(0, 50).map((r, i) => {
            const ok = EMAIL.test(r.email);
            const gs = r.groups.split(/[,|]/).map((g) => g.trim()).filter(Boolean);
            return (
              <View key={i} style={{ gap: theme.space[1], paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], borderTopWidth: i ? 1 : 0, borderTopColor: c.lineSubtle }}>
                <View style={[styles.row, { gap: theme.space[2] }]}>
                  <Text variant="labelSm" numberOfLines={1} style={styles.flex} color={ok ? c.fg : c.danger.text}>{r.name || "–"} · {r.email || "–"}</Text>
                  {!ok && <Badge tone="danger">{t("inválido")}</Badge>}
                </View>
                {gs.length > 0 && (
                  <View style={[styles.wrap, { gap: theme.space[1] }]}>
                    {gs.map((g) => <Badge key={g} tone={known.has(g.toLowerCase()) ? "info" : "neutral"}>{known.has(g.toLowerCase()) ? g : `${g} (${t("não existe")})`}</Badge>)}
                  </View>
                )}
              </View>
            );
          })}
          {rows.length > 50 && <Text variant="caption" tone="muted" style={{ padding: theme.space[3] }}>{t("+ {n} linhas", { n: rows.length - 50 })}</Text>}
        </View>
      )}
      <View style={[styles.row, { gap: theme.space[2] }]}>
        <FileSpreadsheet size={theme.size.iconSm} color={c.fgMuted} aria-hidden />
        <Text variant="bodySm" tone="muted" style={styles.flex}>{rows.length ? t("{v} de {n} linhas válidas", { v: valid.length, n: rows.length }) : t("Colunas: nome, e-mail e grupos (opcional)")}</Text>
      </View>
      <Button block disabled={!valid.length} loading={bulk.isPending} onPress={send}>
        {valid.length ? tn(valid.length, "Convidar {n} aluno", "Convidar {n} alunos") : t("Convidar")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  top: { alignItems: "flex-start" },
  wrap: { flexDirection: "row", flexWrap: "wrap" },
  flex: { flex: 1, minWidth: 0 },
  start: { alignSelf: "flex-start" },
});
