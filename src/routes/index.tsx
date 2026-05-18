import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Download,
  Gauge,
  ImageOff,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  SearchX,
  Send,
  Square,
  ServerCrash,
  ShieldAlert,
  Sparkles,
  TimerOff,
  Trash2,
  WifiOff,
  type LucideIcon,
} from "lucide-react";

import logo from "@/assets/logo-novo-glorex.png";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "I.A GX — Construtor de Artes Novo Glorex" },
      {
        name: "description",
        content:
          "Chat com I.A GX para gerar artes promocionais do Novo Glorex Presencial automaticamente.",
      },
    ],
  }),
});

const STORAGE_KEY = "glorex-chat-messages";
const ARTS_KEY = "glorex-generated-arts";
// Memória de estilo: até 30 artes anteriores como referência base.
// A I.A não envia todas — amostra algumas a cada geração para variar.
const MAX_ARTS = 30;
// Quantas artes mandar como referência por requisição (mantém payload leve).
const ARTS_SAMPLE_PER_REQUEST = 3;
const MAX_ART_REFERENCE_BYTES = 850_000;

type StoredArt = { id: string; dataUrl: string; createdAt: number };

function sanitizeMessagesForApi(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (part.type !== "tool-gerar_arte_glorex") return part;
      const artePart = part as unknown as ArtePart;
      if (!artePart.output?.imageDataUrl) return part;
      return {
        ...part,
        output: {
          ...artePart.output,
          imageDataUrl: "",
          imagemGerada: true,
        },
      };
    }),
  })) as UIMessage[];
}

function loadInitial(): UIMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadArts(): StoredArt[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ARTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Comprime a arte (data URL) para JPEG leve antes de salvar/enviar.
// Reduz drasticamente o uso de localStorage em celulares antigos.
async function compressDataUrl(dataUrl: string, maxSize = 540, quality = 0.68): Promise<string> {
  if (typeof window === "undefined") return dataUrl;
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = dataUrl;
    await img.decode();
    const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return dataUrl;
  }
}

// Redimensiona a arte para EXATAMENTE 1080x1920 (object-fit: cover, centralizado).
async function resizeDataUrlToExact(
  dataUrl: string,
  targetW = 1080,
  targetH = 1920,
): Promise<string> {
  if (typeof window === "undefined") return dataUrl;
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = dataUrl;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    // cover: escala para preencher o canvas, recortando o excesso
    const scale = Math.max(targetW / img.width, targetH / img.height);
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const dx = (targetW - drawW) / 2;
    const dy = (targetH - drawH) / 2;
    ctx.drawImage(img, dx, dy, drawW, drawH);
    return canvas.toDataURL("image/png");
  } catch {
    return dataUrl;
  }
}

async function saveArt(dataUrl: string) {
  if (typeof window === "undefined") return;
  try {
    const existing = loadArts();
    if (existing.some((a) => a.dataUrl === dataUrl)) return;
    let compressed = await compressDataUrl(dataUrl);
    if (compressed.length > MAX_ART_REFERENCE_BYTES) {
      compressed = await compressDataUrl(dataUrl, 420, 0.58);
    }
    if (compressed.length > MAX_ART_REFERENCE_BYTES) return;
    const next = [
      ...existing,
      { id: crypto.randomUUID(), dataUrl: compressed, createdAt: Date.now() },
    ].slice(-MAX_ARTS);
    window.localStorage.setItem(ARTS_KEY, JSON.stringify(next));
  } catch (err) {
    // Quota exceeded ou modo privado: limpa e tenta uma vez sem histórico
    console.warn("Falha ao salvar arte:", err);
    try {
      window.localStorage.removeItem(ARTS_KEY);
    } catch {
      /* ignore */
    }
  }
}

// Remove uma arte salva cujo dataUrl comece com o prefixo informado
// (usamos prefixo porque a versão salva é comprimida e difere da exibida).
function removeArtByPrefix(prefix: string) {
  if (typeof window === "undefined") return;
  try {
    const existing = loadArts();
    const next = existing.filter((a) => !a.dataUrl.startsWith(prefix));
    window.localStorage.setItem(ARTS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function Index() {
  // Hidratação: começa vazio em SSR e no primeiro render do cliente,
  // depois carrega do localStorage em useEffect para evitar mismatch.
  const [initial, setInitial] = useState<UIMessage[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [input, setInput] = useState("");
  const [artsCount, setArtsCount] = useState(0);
  const [online, setOnline] = useState(true);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const processedArtSignatures = useRef<Set<string>>(new Set());

  // Carrega histórico e artes depois da hidratação
  useEffect(() => {
    setInitial(loadInitial());
    setArtsCount(loadArts().length);
    setHydrated(true);
  }, []);

  // Online/offline + install prompt listeners
  useEffect(() => {
    if (typeof window === "undefined") return;
    setOnline(navigator.onLine);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const onBip = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("beforeinstallprompt", onBip);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("beforeinstallprompt", onBip);
    };
  }, []);

  const handleInstall = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice.catch(() => {});
    setInstallEvent(null);
  };

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages, body }) => {
          // Estratégia de amostragem: sempre inclui a arte mais recente
          // + N-1 sorteadas aleatoriamente das demais. Mantém variedade
          // sem inflar o payload.
          const all = loadArts();
          const recent = all.slice(-1);
          const pool = all.slice(0, -1);
          const shuffled = [...pool].sort(() => Math.random() - 0.5);
          const sample = [...recent, ...shuffled.slice(0, Math.max(0, ARTS_SAMPLE_PER_REQUEST - 1))]
            .map((a) => a.dataUrl)
            .filter((dataUrl) => dataUrl.length <= MAX_ART_REFERENCE_BYTES);

          return {
            body: {
              ...body,
              messages: sanitizeMessagesForApi(messages),
              artesGeradas: sample,
            },
          };
        },
      }),
    [],
  );

  const { messages, sendMessage, status, error, setMessages, stop } = useChat({
    id: `glorex-chat-${resetKey}-${hydrated ? "h" : "s"}`,
    messages: initial,
    transport,
  });

  // Persist messages + capture generated arts
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!hydrated) return; // não sobrescreve antes do load inicial
    if (messages.length === 0) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch (err) {
      console.warn("Falha ao salvar histórico:", err);
    }

    // Resize newly generated arts to 1080x1920, save them, and update the message.
    (async () => {
      const tasks: Array<{ sig: string; url: string }> = [];
      for (const m of messages) {
        for (const part of m.parts) {
          if (part.type !== "tool-gerar_arte_glorex") continue;
          const p = part as unknown as ArtePart;
          const url = p.output?.imageDataUrl;
          if (p.state !== "output-available" || !p.output?.ok || !url) continue;
          const sig = url.slice(0, 80);
          if (processedArtSignatures.current.has(sig)) continue;
          processedArtSignatures.current.add(sig);
          tasks.push({ sig, url });
        }
      }
      if (tasks.length === 0) return;
      let added = false;
      const resized = new Map<string, string>();
      for (const t of tasks) {
        const out = await resizeDataUrlToExact(t.url, 1080, 1920);
        resized.set(t.sig, out);
        // Marca a versão final como processada também (evita reprocessar
        // depois que setMessages atualizar a mensagem)
        processedArtSignatures.current.add(out.slice(0, 80));
        const before = loadArts().length;
        await saveArt(out);
        const after = loadArts().length;
        if (after > before) added = true;
      }
      setMessages((prev) =>
        prev.map((m) => ({
          ...m,
          parts: m.parts.map((part) => {
            if (part.type !== "tool-gerar_arte_glorex") return part;
            const p = part as unknown as ArtePart;
            const url = p.output?.imageDataUrl;
            if (!url) return part;
            const newUrl = resized.get(url.slice(0, 80));
            if (!newUrl || newUrl === url) return part;
            return {
              ...part,
              output: { ...p.output!, imageDataUrl: newUrl },
            } as typeof part;
          }),
        })),
      );
      if (added) setArtsCount(loadArts().length);
    })();
  }, [messages, hydrated, setMessages]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, status]);

  // Keep textarea focused
  useEffect(() => {
    if (status === "ready") inputRef.current?.focus();
  }, [status]);

  const isLoading = status === "submitted" || status === "streaming";
  // Existe uma chamada da tool de gerar arte ainda sem output final?
  const hasArtInFlight = useMemo(
    () =>
      messages.some((m) =>
        m.parts.some((p) => {
          if (p.type !== "tool-gerar_arte_glorex") return false;
          const pp = p as unknown as ArtePart;
          return pp.state === "input-streaming" || pp.state === "input-available";
        }),
      ),
    [messages],
  );
  const isBusy = isLoading || hasArtInFlight;
  const visibleMessages = hydrated ? messages : [];

  // Cooldown após 429 (cota / rate limit) para não desperdiçar novas tentativas.
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (cooldownUntil <= now) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [cooldownUntil, now]);
  const cooldownSecs = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const inCooldown = cooldownSecs > 0;

  useEffect(() => {
    if (!error) return;
    if (/429|too many|limite de requisi|rate/i.test(error.message || "")) {
      setCooldownUntil(Date.now() + 60_000);
    }
  }, [error]);

  useEffect(() => {
    for (const m of messages) {
      for (const p of m.parts) {
        if (p.type !== "tool-gerar_arte_glorex") continue;
        const pp = p as unknown as ArtePart;
        if (pp.output?.category === "quota") {
          setCooldownUntil((prev) => Math.max(prev, Date.now() + 60_000));
          return;
        }
      }
    }
  }, [messages]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || isBusy) return;
    if (!online) return;
    if (inCooldown) return;
    setInput("");
    await sendMessage({ text });
  };

  const handleStop = () => {
    try {
      stop();
    } catch {
      /* ignore */
    }
    // Marca qualquer tool-call ainda pendente como cancelada, pra UI
    // refletir na hora mesmo se o servidor demorar um tick.
    setMessages((prev) =>
      prev.map((m) => ({
        ...m,
        parts: m.parts.map((part) => {
          if (part.type !== "tool-gerar_arte_glorex") return part;
          const pp = part as unknown as ArtePart;
          if (pp.state === "output-available" || pp.state === "output-error") return part;
          return {
            ...part,
            state: "output-available",
            output: {
              ok: false,
              category: "aborted",
              error: "Geração cancelada pelo usuário.",
            },
          } as typeof part;
        }),
      })),
    );
  };

  const handleNewChat = () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Iniciar nova conversa? Isso vai apagar todas as imagens geradas e interromper qualquer geração em andamento.",
      )
    ) {
      return;
    }
    if (isBusy) {
      try {
        stop();
      } catch {
        /* ignore */
      }
    }
    setMessages([]);
    setInitial([]);
    setInput("");
    setCooldownUntil(0);
    processedArtSignatures.current.clear();
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
        window.localStorage.removeItem(ARTS_KEY);
      } catch {
        /* ignore */
      }
    }
    setArtsCount(0);
    setResetKey((k) => k + 1);
  };


  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border bg-card/60 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <img
              src={logo}
              alt="Novo Glorex"
              width={48}
              height={48}
              decoding="async"
              className="h-12 w-12 object-contain"
            />
            <div>
              <h1 className="text-lg font-bold text-foreground">
                I.A <span className="text-primary">GX</span>
              </h1>
              <p className="text-xs text-muted-foreground">
                Construtor de Artes — Novo Glorex Presencial
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {installEvent && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleInstall}
                title="Instalar I.A GX no celular"
              >
                Instalar
              </Button>
            )}
            {artsCount > 0 && (
              <span
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground"
                title="Artes que a I.A GX usa como memória de estilo (não pode ser apagada)"
              >
                <Sparkles className="h-4 w-4 text-primary" />
                Memória ({artsCount})
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleNewChat}
              className="text-muted-foreground hover:text-foreground"
              title="Limpa a conversa atual sem apagar a memória de estilo da I.A"
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Nova conversa
            </Button>
          </div>
        </div>
        {!online && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center justify-center gap-2 bg-destructive/10 px-4 py-1.5 text-xs font-medium text-destructive"
          >
            <WifiOff className="h-3.5 w-3.5" />
            Sem conexão — a geração de artes está pausada até voltar a internet.
          </div>
        )}
        {inCooldown && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center justify-center gap-2 bg-amber-500/10 px-4 py-1.5 text-xs font-medium text-amber-600 dark:text-amber-400"
          >
            <Gauge className="h-3.5 w-3.5" />
            Limite de requisições atingido — aguarde {cooldownSecs}s antes de tentar de novo.
          </div>
        )}
      </header>

      <main ref={scrollRef} className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 py-6">
        {visibleMessages.length === 0 ? <EmptyState /> : null}

        <div className="space-y-6">
          {visibleMessages.map((m, idx) => (
            <MessageBubble
              key={m.id}
              message={m}
              canRegenerate={!isLoading && online && !inCooldown}
              onRegenerate={() => {
                if (inCooldown) return;
                // Acha a última mensagem do user antes desta mensagem com arte
                let briefing = "";
                for (let i = idx - 1; i >= 0; i--) {
                  const prev = visibleMessages[i];
                  if (prev.role !== "user") continue;
                  const txt = prev.parts
                    .map((p) => (p.type === "text" ? (p as { text: string }).text : ""))
                    .join(" ")
                    .trim();
                  if (txt) {
                    briefing = txt;
                    break;
                  }
                }
                const prompt = briefing
                  ? `Gere novamente a arte, com uma NOVA variação de paleta de fundo e layout (diferente da anterior). Briefing: ${briefing}`
                  : "Gere novamente a última arte, com uma NOVA variação de paleta de fundo e layout (diferente da anterior).";
                sendMessage({ text: prompt });
              }}
              onDeleteArt={(dataUrl) => {
                removeArtByPrefix(dataUrl.slice(0, 80));
                setArtsCount(loadArts().length);
                setMessages((prev) =>
                  prev
                    .map((msg) =>
                      msg.id === m.id
                        ? {
                            ...msg,
                            parts: msg.parts.filter((p) => {
                              if (p.type !== "tool-gerar_arte_glorex") return true;
                              const pp = p as unknown as ArtePart;
                              return pp.output?.imageDataUrl !== dataUrl;
                            }),
                          }
                        : msg,
                    )
                    .filter((msg) => msg.parts.length > 0),
                );
              }}
            />
          ))}

          {status === "submitted" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              I.A GX está pensando...
            </div>
          )}

          {error && (
            <div
              role="alert"
              aria-live="polite"
              className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error.message || "Algo deu errado. Tente novamente."}
            </div>
          )}
        </div>
      </main>

      <footer className="sticky bottom-0 border-t border-border bg-card/80 backdrop-blur">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex w-full max-w-3xl items-end gap-2 px-4 py-3"
        >
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Descreva a arte: dia, abertura, jogadas, bola do dia, prêmios..."
            rows={2}
            className="min-h-[56px] flex-1 resize-none"
            autoFocus
          />
          {isBusy ? (
            <Button
              type="button"
              onClick={handleStop}
              size="icon"
              variant="destructive"
              className="h-11 w-11 shrink-0"
              title="Parar geração"
            >
              <Square className="h-4 w-4 fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={!input.trim() || !online || inCooldown}
              size="icon"
              className="h-11 w-11 shrink-0"
              title={
                !online
                  ? "Sem conexão"
                  : inCooldown
                    ? `Aguarde ${cooldownSecs}s (limite atingido)`
                    : undefined
              }
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </form>
      </footer>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/15">
        <Sparkles className="h-7 w-7 text-primary" />
      </div>
      <h2 className="mb-1 text-xl font-semibold text-foreground">Olá! Eu sou a I.A GX 👋</h2>
      <p className="mb-6 max-w-md text-sm text-muted-foreground">
        Me conte os detalhes da rodada (dia, horários, valores das séries, bola do dia e prêmios) e
        eu monto a arte do Novo Glorex pra você.
      </p>
      <div className="grid w-full max-w-md gap-2 text-left text-sm">
        <ExampleCard text="Sexta, dia 15. Abertura 18:30. 19h série de 500 a 4 reais. 20:30 kit churrasco e airfryer. 21:30 jogada de 3.000. Bola do dia 15, prêmio bingo 1.900." />
        <ExampleCard text="Sábado, abertura 17h. 17:30 série de 500 a 3 reais. 20h jogada de 1.500. 21h jogada de 2.000 + caixa de picanha. Bola do dia 09, bingo 1.400." />
      </div>
    </div>
  );
}

function ExampleCard({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-muted-foreground">
      {text}
    </div>
  );
}

function MessageBubble({
  message,
  onDeleteArt,
  onRegenerate,
  canRegenerate,
}: {
  message: UIMessage;
  onDeleteArt?: (dataUrl: string) => void;
  onRegenerate?: () => void;
  canRegenerate?: boolean;
}) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] space-y-3 ${
          isUser
            ? "rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-primary-foreground"
            : "text-foreground"
        }`}
      >
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return (
              <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed">
                {part.text}
              </p>
            );
          }
          if (part.type === "tool-gerar_arte_glorex") {
            return (
              <ArteToolPart
                key={i}
                part={part as unknown as ArtePart}
                onDelete={onDeleteArt}
                onRegenerate={onRegenerate}
                canRegenerate={canRegenerate}
              />
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

type ArtePart = {
  type: "tool-gerar_arte_glorex";
  state: "input-streaming" | "input-available" | "output-available" | "output-error";
  input?: unknown;
  output?: {
    ok: boolean;
    imageDataUrl?: string;
    error?: string;
    category?: string;
    httpStatus?: number;
    googleStatus?: string;
    googleCode?: string | number;
    requestId?: string;
  };
  errorText?: string;
};

const CATEGORY_META: Record<string, { label: string; icon: LucideIcon }> = {
  references: { label: "Falha ao carregar referências da marca", icon: ImageOff },
  quota: { label: "Cota do Google atingida", icon: Gauge },
  auth: { label: "Chave do Google inválida", icon: KeyRound },
  permission: { label: "Sem permissão para o modelo", icon: Lock },
  model_not_found: { label: "Modelo não encontrado", icon: SearchX },
  bad_request: { label: "Requisição rejeitada", icon: AlertTriangle },
  upstream: { label: "Serviço do Google instável", icon: ServerCrash },
  safety: { label: "Bloqueio de segurança", icon: ShieldAlert },
  timeout: { label: "Tempo esgotado", icon: TimerOff },
  network: { label: "Falha de rede", icon: WifiOff },
  aborted: { label: "Geração cancelada", icon: Square },
  unknown: { label: "Erro desconhecido", icon: AlertTriangle },
};

function ErrorCard({
  category,
  message,
  httpStatus,
  googleStatus,
  googleCode,
  requestId,
}: {
  category?: string;
  message?: string;
  httpStatus?: number;
  googleStatus?: string;
  googleCode?: string | number;
  requestId?: string;
}) {
  const meta = CATEGORY_META[category ?? "unknown"] ?? CATEGORY_META.unknown;
  const Icon = meta.icon;
  const tech: string[] = [];
  if (httpStatus) tech.push(`HTTP ${httpStatus}`);
  if (googleStatus) tech.push(googleStatus);
  if (googleCode) tech.push(`code ${googleCode}`);
  if (requestId) tech.push(`id ${requestId}`);
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
      <div className="flex items-center gap-2 font-semibold">
        <Icon className="h-4 w-4 shrink-0" />
        <span>{meta.label}</span>
      </div>
      {message && <div className="mt-1.5 text-sm opacity-90">{message}</div>}
      {tech.length > 0 && (
        <div className="mt-2 break-all font-mono text-[11px] opacity-70">{tech.join(" · ")}</div>
      )}
    </div>
  );
}

function ArteToolPart({
  part,
  onDelete,
  onRegenerate,
  canRegenerate,
}: {
  part: ArtePart;
  onDelete?: (dataUrl: string) => void;
  onRegenerate?: () => void;
  canRegenerate?: boolean;
}) {
  if (part.state === "input-streaming" || part.state === "input-available") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        Gerando imagem com I.A GX (1080×1920)... pode levar até 2 min.
      </div>
    );
  }

  if (part.state === "output-error") {
    return (
      <ErrorCard
        category="unknown"
        message={part.errorText ?? "A ferramenta lançou uma exceção inesperada."}
      />
    );
  }

  if (part.output?.ok && part.output.imageDataUrl) {
    const url = part.output.imageDataUrl;
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <img
          src={url}
          alt="Arte gerada do Novo Glorex"
          loading="lazy"
          decoding="async"
          className="block w-full"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">Arte gerada por I.A GX</span>
          <div className="flex w-full items-center justify-end gap-1.5 sm:w-auto">
            {onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                disabled={!canRegenerate}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-2 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 sm:py-1.5"
                title="Gerar novamente com nova variação"
                aria-label="Gerar novamente"
              >
                <RefreshCw className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                <span className="hidden sm:inline">Gerar novamente</span>
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={() => {
                  if (confirm("Apagar esta arte? Ela também será removida da memória de referência da I.A.")) {
                    onDelete(url);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-2.5 py-2 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 sm:py-1.5"
                title="Apagar esta arte"
                aria-label="Apagar esta arte"
              >
                <Trash2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                <span className="hidden sm:inline">Apagar</span>
              </button>
            )}
            <a
              href={url}
              download={`glorex-${Date.now()}.png`}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90"
            >
              <Download className="h-4 w-4" />
              Baixar
            </a>
          </div>
        </div>
      </div>
    );
  }
  const out = part.output;
  return (
    <ErrorCard
      category={out?.category}
      message={out?.error ?? "Erro desconhecido."}
      httpStatus={out?.httpStatus}
      googleStatus={out?.googleStatus}
      googleCode={out?.googleCode}
      requestId={out?.requestId}
    />
  );
}
