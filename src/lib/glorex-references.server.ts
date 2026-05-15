import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import logoUrl from "@/assets/logo-novo-glorex.png?url";
import sextaUrl from "@/assets/template-sexta.jpeg?url";
import sabadoUrl from "@/assets/template-sabado.png?url";

type Ref = { dataUrl: string; mime: string };

const ASSETS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../assets",
);

async function loadAsset(file: string, mime: string): Promise<Ref> {
  const full = path.join(ASSETS_DIR, file);
  const buf = await readFile(full);
  return { dataUrl: `data:${mime};base64,${buf.toString("base64")}`, mime };
}

let cached: { logo: Ref; templates: Ref[] } | null = null;

export async function getGlorexReferences() {
  if (cached) return cached;
  // Touch URL imports so Vite tracks them in the bundle graph (used in dev hashed paths).
  void logoUrl;
  void sextaUrl;
  void sabadoUrl;

  const [logo, sexta, sabado] = await Promise.all([
    loadAsset("logo-novo-glorex.png", "image/png"),
    loadAsset("template-sexta.jpeg", "image/jpeg"),
    loadAsset("template-sabado.png", "image/png"),
  ]);
  cached = { logo, templates: [sexta, sabado] };
  return cached;
}
