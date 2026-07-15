import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";

import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const searchSchema = z.object({
  next: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Entrar — Novo Glorex" },
      { name: "description", content: "Entre para autorizar aplicativos externos." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function safeNext(next: string | undefined): string {
  if (!next) return "/";
  try {
    // Only allow same-origin relative paths.
    const url = new URL(next, window.location.origin);
    if (url.origin !== window.location.origin) return "/";
    return url.pathname + url.search;
  } catch {
    return "/";
  }
}

function AuthPage() {
  const { next } = useSearch({ from: "/auth" });
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) window.location.replace(safeNext(next));
    });
  }, [next]);

  async function handleGoogle() {
    setError(null);
    setBusy(true);
    // Preserve return path across the OAuth round-trip.
    const target = safeNext(next);
    const redirectUri = `${window.location.origin}/auth${target !== "/" ? `?next=${encodeURIComponent(target)}` : ""}`;
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: redirectUri });
    if (result.error) {
      setError(result.error.message ?? "Falha ao entrar com Google");
      setBusy(false);
      return;
    }
    if (result.redirected) return;
    window.location.replace(safeNext(next));
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const target = safeNext(next);
    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth?next=${encodeURIComponent(target)}` },
      });
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
      setError("Confira seu email para confirmar a conta.");
      setBusy(false);
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    window.location.replace(target);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-card p-6 shadow-lg">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-foreground">Novo Glorex</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signin" ? "Entre para continuar" : "Crie sua conta"}
          </p>
        </div>

        <Button type="button" onClick={handleGoogle} disabled={busy} className="w-full" variant="outline">
          Continuar com Google
        </Button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-card px-2 text-muted-foreground">ou</span>
          </div>
        </div>

        <form onSubmit={handleEmail} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {mode === "signin" ? "Entrar" : "Criar conta"}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => {
            setError(null);
            setMode(mode === "signin" ? "signup" : "signin");
          }}
          className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
        >
          {mode === "signin" ? "Não tem conta? Criar" : "Já tem conta? Entrar"}
        </button>
        {!!navigate && null}
      </div>
    </div>
  );
}
