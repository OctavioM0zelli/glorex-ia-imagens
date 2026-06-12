## Objetivo

Fazer 3 edições cirúrgicas no template literal de `buildGlorexImagePrompt` em `src/lib/glorex-briefing.ts`, sem reescrever o prompt inteiro nem tocar em mais nada.

## Edições

### Edição 1 — Expandir "LIBERDADE" (linhas 65-73)
Substituir a lista atual "A IA tem LIBERDADE APENAS para:" (com 4 itens sobre fonte, peso, decoração e posição do logo) pela nova versão "A IA tem LIBERDADE para enriquecer a arte das seguintes formas, SEM alterar nenhuma informação sagrada:" com 6 itens: escolha tipográfica, aumentar tamanho de texto, banners/letreiros neon e placas, elementos de cassino (fichas, caça-níquel, cartas, roleta), molduras/setas/selos de destaque, e reposicionar/redimensionar a logo livremente dentro da zona de cabeçalho.

### Edição 2 — Nova seção "PEDIDOS DE ESTILO DENTRO DO BRIEFING"
Inserir imediatamente após o bloco "INFORMAÇÕES SAGRADAS — NUNCA ALTERAR" (após a linha 73, antes do bloco "PALETA E TEMA DESTA GERAÇÃO" na linha 75). Instrui a IA a tratar pedidos de estilo no briefing como instrução visual (não renderizar a frase como texto), e em dúvida aplicar ao elemento de maior valor monetário ou título principal.

### Edição 3 — Nova seção "AUTONOMIA CRIATIVA — ENRIQUECIMENTO"
Inserir imediatamente antes do bloco "REGRAS CRÍTICAS" (antes da linha 177/179). Instrui a IA a evitar arte enxuta/minimalista, adicionando proativamente decorações nas margens, banner extra, texturas de fundo e camadas de profundidade — objetivo: arte densa, rica e premium.

## Não tocar
- Bloco "BRIEFING — FONTE ÚNICA DA VERDADE"
- Bloco "PALETA E TEMA DESTA GERAÇÃO"
- Estrutura das 7 zonas
- Conteúdo do bloco "REGRAS CRÍTICAS" (apenas inserir a Edição 3 antes dele)
- `selectPaleta`, schema `GlorexBriefingSchema`, e qualquer outro arquivo

## Verificação
Reler o trecho editado para confirmar que apenas os 3 pontos foram alterados e que o template literal continua sintaticamente válido (crases e `${...}` intactos).