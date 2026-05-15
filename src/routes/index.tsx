import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Send, Sparkles, Trash2, WifiOff } from "lucide-react";

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
const MAX_ARTS = 10;

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

// Comprime a arte (data URL) para JPEG ~720px antes de salvar.
// Reduz drasticamente o uso de localStorage em celulares antigos.
async function compressDataUrl(dataUrl: string, maxSize = 720, quality = 0.78): Promise<string> {
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

async function saveArt(dataUrl: string) {
  if (typeof window === "undefined") return;
  try {
    const existing = loadArts();
    if (existing.some((a) => a.dataUrl === dataUrl)) return;
    const compressed = await compressDataUrl(dataUrl);
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

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function Index() {
  const [initial] = useState<UIMessage[]>(loadInitial);
  const [resetKey, setResetKey] = useState(0);
  const [input, setInput] = useState("");
  const [artsCount, setArtsCount] = useState(() => loadArts().length);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Online/offline + install prompt listeners
  useEffect(() => {
    if (typeof window === "undefined") return;
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
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: {
            ...body,
            messages: sanitizeMessagesForApi(messages),
            artesGeradas: loadArts()
              .slice(-1)
              .map((a) => a.dataUrl),
          },
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, error, setMessages } = useChat({
    id: `glorex-chat-${resetKey}`,
    messages: initial,
    transport,
  });

  // Persist messages + capture generated arts
  useEffect(() => {
    if (typeof window === "undefined") return;
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

    // Save any newly generated arts (async, fire-and-forget)
    (async () => {
      let added = false;
      for (const m of messages) {
        for (const part of m.parts) {
          if (part.type === "tool-gerar_arte_glorex") {
            const p = part as unknown as ArtePart;
            if (
              p.state === "output-available" &&
              p.output?.ok &&
              p.output.imageDataUrl
            ) {
              const before = loadArts().length;
              await saveArt(p.output.imageDataUrl);
              const after = loadArts().length;
              if (after > before) added = true;
            }
          }
        }
      }
      if (added) setArtsCount(loadArts().length);
    })();
  }, [messages]);

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

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    if (!online) return;
    setInput("");
    await sendMessage({ text });
  };

  const handleNewChat = () => {
    setMessages([]);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
    setResetKey((k) => k + 1);
  };

  const handleClearArts = () => {
    if (typeof window === "undefined") return;
    const ok = window.confirm(
      "Apagar a memória de estilo? A I.A GX vai gerar a próxima arte sem se basear nas anteriores.",
    );
    if (!ok) return;
    try {
      window.localStorage.removeItem(ARTS_KEY);
    } catch {
      /* ignore */
    }
    setArtsCount(0);
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
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearArts}
                className="text-muted-foreground hover:text-foreground"
                title="Limpa as artes que a I.A GX usa como memória de estilo"
              >
                <Sparkles className="mr-1.5 h-4 w-4" />
                Memória ({artsCount})
              </Button>
            )}
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleNewChat}
                className="text-muted-foreground hover:text-foreground"
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                Nova conversa
              </Button>
            )}
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
      </header>

      <main
        ref={scrollRef}
        className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 py-6"
      >
        {messages.length === 0 ? <EmptyState /> : null}

        <div className="space-y-6">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
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
          <Button
            type="submit"
            disabled={isLoading || !input.trim()}
            size="icon"
            className="h-11 w-11 shrink-0"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
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
      <h2 className="mb-1 text-xl font-semibold text-foreground">
        Olá! Eu sou a I.A GX 👋
      </h2>
      <p className="mb-6 max-w-md text-sm text-muted-foreground">
        Me conte os detalhes da rodada (dia, horários, valores das séries, bola do
        dia e prêmios) e eu monto a arte do Novo Glorex pra você.
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

function MessageBubble({ message }: { message: UIMessage }) {
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
            return <ArteToolPart key={i} part={part as unknown as ArtePart} />;
          }
          return null;
        })}
      </div>
    </div>
  );
}

type ArtePart = {
  type: "tool-gerar_arte_glorex";
  state:
    | "input-streaming"
    | "input-available"
    | "output-available"
    | "output-error";
  input?: unknown;
  output?: {
    ok: boolean;
    imageDataUrl?: string;
    error?: string;
  };
  errorText?: string;
};

function ArteToolPart({ part }: { part: ArtePart }) {
  if (part.state === "input-streaming" || part.state === "input-available") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        Gerando arte com Nano Banana 2...
      </div>
    );
  }

  if (part.state === "output-error") {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        Não consegui gerar a arte. {part.errorText ?? ""}
      </div>
    );
  }

  if (part.output?.ok && part.output.imageDataUrl) {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <img
          src={part.output.imageDataUrl}
          alt="Arte gerada do Novo Glorex"
          loading="lazy"
          decoding="async"
          className="block w-full"
        />
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <span className="text-xs text-muted-foreground">
            Arte gerada por I.A GX
          </span>
          <a
            href={part.output.imageDataUrl}
            download={`glorex-${Date.now()}.png`}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            <Download className="h-3.5 w-3.5" />
            Baixar
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {part.output?.error ?? "Falha ao gerar a arte."}
    </div>
  );
}
