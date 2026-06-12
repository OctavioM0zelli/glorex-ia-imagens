import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BUCKET = "glorex-generated-images";
const PREF_FILE = "preferencias-estilo.json";
const MAX_PREFERENCIAS = 15;

export async function getPreferencias(): Promise<string[]> {
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .download(PREF_FILE);

    if (error || !data) {
      return [];
    }

    const text = await data.text();
    if (!text.trim()) {
      return [];
    }

    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export async function salvarPreferencia(texto: string): Promise<void> {
  const atual = await getPreferencias();
  const atualizado = [...atual, texto];

  if (atualizado.length > MAX_PREFERENCIAS) {
    atualizado.splice(0, atualizado.length - MAX_PREFERENCIAS);
  }

  const blob = new Blob([JSON.stringify(atualizado, null, 2)], {
    type: "application/json",
  });

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(PREF_FILE, blob, {
      contentType: "application/json",
      upsert: true,
    });

  if (error) {
    throw new Error(
      `Erro ao salvar preferências no Storage: ${error.message}`
    );
  }
}
