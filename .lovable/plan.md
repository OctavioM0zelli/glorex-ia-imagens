## Plano

### 1. Limpar memória anterior sobre "30 artes"
- Remover qualquer referência/memória que diga para aprender com as 30 primeiras artes geradas.
- Substituir pela nova regra: aprender apenas com as **6 primeiras artes enviadas pelo usuário** como referência de estilo, mais os **ajustes que o usuário pedir** ao longo do tempo.

### 2. Adicionar nova regra de cor predominante
Criar/atualizar memória de design com:
- Cada arte deve ter **uma cor predominante** (não precisa ser única, mas deve dominar a maioria dos elementos).
- Ex: se a base for vermelha, a maioria dos elementos visuais (fundos, blocos, destaques) deve usar vermelho.
- **Texto deve ser branco na maior parte das vezes**, para máxima legibilidade sobre a cor predominante.

### 3. Refletir as regras no código
- Em `src/lib/glorex-references.server.ts` (ou onde estiver o prompt-base/refs do Gemini), atualizar a instrução de estilo para incluir:
  - "Defina uma cor predominante para a arte e use-a na maioria dos elementos."
  - "Textos principais em branco sempre que possível, garantindo contraste sobre a cor predominante."
- Garantir que as referências fixas usadas pelo modelo sejam apenas as **6 primeiras artes** (ignorar lógica que puxe 30, se existir).

### 4. Salvar no `mem://`
- `mem://index.md` Core: regra da cor predominante + texto branco + uso apenas das 6 refs.
- `mem://design/cor-predominante.md`: detalhamento.
- `mem://constraints/refs-artes.md`: "Não aprender com mais que as 6 primeiras artes enviadas pelo usuário."

### Detalhes técnicos
- Arquivos a tocar: `src/lib/glorex-references.server.ts` e/ou `src/routes/api/chat.ts` (parte do system prompt da tool de geração).
- Não alterar UI nem fluxo de cooldown.
