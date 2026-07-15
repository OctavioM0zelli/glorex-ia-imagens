import { auth, defineMcp } from "@lovable.dev/mcp-js";

import gerarArteTool from "./tools/gerar-arte";

// The OAuth issuer MUST be the direct Supabase host. On publish, SUPABASE_URL
// is rewritten to the .lovable.cloud proxy, which mcp-js rejects. The project
// ref is the only value that survives publish unchanged.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "novo-glorex-mcp",
  title: "Novo Glorex — Gerador de Artes",
  version: "0.1.0",
  instructions:
    "Ferramentas do Novo Glorex Presencial. Use `gerar_arte_glorex` passando o texto cru da programação do dia (horários, prêmios, dia, bola do dia) para gerar o flyer promocional vertical.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [gerarArteTool],
});
