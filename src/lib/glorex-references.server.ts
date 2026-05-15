type Ref = { dataUrl: string; mime: string };

let cached: { logo: Ref; templates: Ref[] } | null = null;

async function fetchAsset(origin: string, file: string, mime: string): Promise<Ref> {
  const res = await fetch(`${origin}/glorex/${file}`);
  if (!res.ok) throw new Error(`Falha ao carregar referência ${file}: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  const base64 = btoa(bin);
  return { dataUrl: `data:${mime};base64,${base64}`, mime };
}

export async function getGlorexReferences(origin: string) {
  if (cached) return cached;
  const [logo, sexta, sabado, quarta, domingo, terca, quinta, sextaV2, tercaPremiada] =
    await Promise.all([
      fetchAsset(origin, "logo-novo-glorex.png", "image/png"),
      fetchAsset(origin, "template-sexta.jpeg", "image/jpeg"),
      fetchAsset(origin, "template-sabado.png", "image/png"),
      fetchAsset(origin, "template-quarta.png", "image/png"),
      fetchAsset(origin, "template-domingo.png", "image/png"),
      fetchAsset(origin, "template-terca.png", "image/png"),
      fetchAsset(origin, "template-quinta.png", "image/png"),
      fetchAsset(origin, "template-sexta-v2.png", "image/png"),
      fetchAsset(origin, "template-terca-premiada.png", "image/png"),
    ]);
  cached = {
    logo,
    templates: [sexta, sabado, quarta, domingo, terca, quinta, sextaV2, tercaPremiada],
  };
  return cached;
}
