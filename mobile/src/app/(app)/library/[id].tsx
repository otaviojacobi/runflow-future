/** W5 · Editar treino da biblioteca. The editor lives in components/builder/TemplateEditor.tsx. */
import { useLocalSearchParams } from "expo-router";
import { TemplateEditor } from "@/components/builder/TemplateEditor";

export default function EditTemplateScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // A new id is a new form.
  return <TemplateEditor key={id} id={String(id ?? "")} />;
}
