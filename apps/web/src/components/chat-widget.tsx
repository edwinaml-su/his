"use client";

/**
 * ChatWidget — copiloto del HIS Multipaís.
 *
 * Widget flotante en la esquina inferior derecha. Click para expandir,
 * conversación streaming con Claude vía /api/chat. Soporta:
 *   - Markdown básico (negritas, listas, enlaces).
 *   - Quick actions: 4 botones con preguntas frecuentes.
 *   - Context-aware: envía pathname y roles al server para mejor diagnóstico.
 *   - Links clickables: navega al hacer click en deep-links como [Pantalla](/ruta).
 *   - Persistencia local: historial guardado en sessionStorage (no cross-tab,
 *     no en BD por privacidad — para tracking server-side, ver Fase 2).
 */
import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { MessageCircle, X, Send, Sparkles, ExternalLink, ThumbsUp, ThumbsDown } from "lucide-react";
import { Button } from "@his/ui/components/button";
import { cn } from "@his/ui/lib/utils";

interface ChatWidgetProps {
  /** Roles del usuario activo — viajan al server para context-aware. */
  roleCodes?: string[];
  /** Nombre de la organización del tenant — solo display. */
  organizationName?: string;
  /** Identidad para que el bot pueda invocar tools tenant-scoped. */
  chatAuth?: { userId: string; organizationId?: string };
}

/** Shape común de mensajes del SDK que usamos (soporta parts[] o content). */
type AnyMessage = {
  id?: string;
  role?: "user" | "assistant" | "system";
  content?: string;
  parts?: Array<MessagePart>;
};

/** Una part del mensaje — texto, tool-call, tool-result, etc. */
type MessagePart = {
  type?: string;
  text?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
};

const QUICK_ACTIONS = [
  { label: "¿Cómo registro un nuevo paciente?", icon: "👤" },
  { label: "¿Cómo programo una cirugía?", icon: "🔪" },
  { label: "¿Cómo solicito un examen de laboratorio?", icon: "🧪" },
  { label: "¿Dónde está el portal del paciente?", icon: "🏥" },
];

const SESSION_KEY = "his-chat-history";
const SESSION_ID_KEY = "his-chat-session-id";

/** Genera (o recupera) un UUID v4 estable por sessionStorage para tracking. */
function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = sessionStorage.getItem(SESSION_ID_KEY);
    if (existing) return existing;
    // Generación robusta — sin lib externa.
    const newId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(SESSION_ID_KEY, newId);
    return newId;
  } catch {
    return "";
  }
}

export function ChatWidget({ roleCodes, organizationName, chatAuth }: ChatWidgetProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [input, setInput] = React.useState("");
  const [sessionId, setSessionId] = React.useState("");
  /** Feedback de la sesión completa: undefined = sin votar, 1 = up, -1 = down. */
  const [sessionFeedback, setSessionFeedback] = React.useState<1 | -1 | undefined>(undefined);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setSessionId(getOrCreateSessionId());
  }, []);

  const { messages, sendMessage, status, error, setMessages } = useChat({
    onError: (err: Error) => {
      // eslint-disable-next-line no-console
      console.error("[ChatWidget]", err);
    },
  });

  // Restaurar historial al montar.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        }
      }
    } catch {
      // Ignorar errores de parse — empezar limpio.
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persistir historial al cambiar.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (messages.length === 0) return;
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(messages));
    } catch {
      // Quota exceeded — silent skip.
    }
  }, [messages]);

  // Auto-scroll al fondo cuando llegan mensajes.
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function handleSend(text: string) {
    const trimmed = text.trim();
    if (!trimmed || status === "submitted" || status === "streaming") return;
    sendMessage(
      { text: trimmed },
      {
        body: {
          context: {
            currentPath: pathname,
            roleCodes,
            organizationName,
            userId: chatAuth?.userId,
            organizationId: chatAuth?.organizationId,
            sessionId,
          },
        },
      },
    );
    setInput("");
  }

  async function handleSessionFeedback(vote: 1 | -1) {
    if (!sessionId) return;
    const previous = sessionFeedback;
    setSessionFeedback(vote); // optimistic
    try {
      const res = await fetch("/api/chat/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, feedback: vote }),
      });
      if (!res.ok) setSessionFeedback(previous);
    } catch {
      setSessionFeedback(previous);
    }
  }

  function handleClearAll() {
    setMessages([]);
    setSessionFeedback(undefined);
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(SESSION_KEY);
      // Genera nuevo sessionId para que el siguiente turno cree nueva sesión.
      sessionStorage.removeItem(SESSION_ID_KEY);
      setSessionId(getOrCreateSessionId());
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    handleSend(input);
  }

  // (handleClearAll está arriba; mantengo este shim por compat.)
  function handleClearHistory() {
    handleClearAll();
  }

  // Click en links del markdown — interceptar para navegación SPA.
  function handleContentClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    const link = target.closest("a") as HTMLAnchorElement | null;
    if (!link) return;
    const href = link.getAttribute("href");
    if (!href) return;
    // Solo intercepta rutas internas absolutas (no externas).
    if (href.startsWith("/") && !href.startsWith("//")) {
      e.preventDefault();
      router.push(href);
      setOpen(false);
    }
  }

  return (
    <>
      {/* Botón flotante */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir asistente HIS"
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:scale-105 transition-transform focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
        >
          <MessageCircle className="h-6 w-6" aria-hidden />
          <span className="absolute -top-1 -right-1 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
          </span>
        </button>
      )}

      {/* Panel del chat */}
      {open && (
        <div
          role="dialog"
          aria-label="Asistente HIS"
          className="fixed bottom-6 right-6 z-50 flex h-[600px] max-h-[calc(100vh-3rem)] w-96 max-w-[calc(100vw-3rem)] flex-col rounded-xl border bg-background shadow-2xl"
        >
          {/* Header */}
          <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className="h-5 w-5 text-primary shrink-0" aria-hidden />
              <div className="min-w-0">
                <h2 className="font-semibold text-sm">Avante Asistente</h2>
                <p className="text-xs text-muted-foreground truncate">
                  Copiloto del HIS
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearHistory}
                  className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                  aria-label="Limpiar historial"
                >
                  Limpiar
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar asistente"
                className="rounded-md p-1 hover:bg-muted"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </header>

          {/* Mensajes */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
            aria-live="polite"
          >
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Hola 👋 Soy tu asistente del HIS. Puedo explicarte procesos,
                  ayudarte a resolver problemas y llevarte directo a las pantallas
                  que necesitas. Empecemos:
                </p>
                <div className="grid grid-cols-1 gap-2">
                  {QUICK_ACTIONS.map((qa) => (
                    <button
                      key={qa.label}
                      type="button"
                      onClick={() => handleSend(qa.label)}
                      className="text-left rounded-md border bg-card px-3 py-2 text-sm hover:bg-muted transition-colors"
                    >
                      <span className="mr-2" aria-hidden>{qa.icon}</span>
                      {qa.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m: AnyMessage & { id: string; role: "user" | "assistant" | "system" }) => (
              <Message
                key={m.id}
                role={m.role}
                content={extractText(m)}
                toolCalls={extractToolCalls(m)}
                onContentClick={handleContentClick}
                onNavigate={(url) => {
                  router.push(url);
                  setOpen(false);
                }}
              />
            ))}

            {(status === "submitted" || status === "streaming") && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-block w-2 h-2 bg-primary rounded-full animate-pulse" />
                {status === "submitted" ? "Pensando…" : "Respondiendo…"}
              </div>
            )}

            {error && (
              <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                {error.message ?? "Error al consultar el asistente."}
              </div>
            )}
          </div>

          {/* Input */}
          <form
            onSubmit={handleSubmit}
            className="border-t px-3 py-2 flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pregúntame sobre el HIS…"
              className="flex-1 rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={status === "submitted" || status === "streaming"}
              aria-label="Mensaje al asistente"
            />
            <Button
              type="submit"
              size="sm"
              disabled={
                !input.trim() || status === "submitted" || status === "streaming"
              }
              aria-label="Enviar mensaje"
            >
              <Send className="h-4 w-4" aria-hidden />
            </Button>
          </form>

          {/* Footer con feedback — solo se renderiza si hay conversación activa */}
          {messages.length > 0 && (
            <div className="flex items-center justify-end gap-1 px-3 pb-2 pt-1" aria-label="Calificar conversación">
              <button
                type="button"
                onClick={() => handleSessionFeedback(1)}
                className={cn(
                  "rounded p-1 hover:bg-muted transition-colors",
                  sessionFeedback === 1 ? "text-green-600" : "text-muted-foreground",
                )}
                aria-label="Útil"
                aria-pressed={sessionFeedback === 1}
                title="La conversación fue útil"
              >
                <ThumbsUp className="h-3 w-3" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => handleSessionFeedback(-1)}
                className={cn(
                  "rounded p-1 hover:bg-muted transition-colors",
                  sessionFeedback === -1 ? "text-red-600" : "text-muted-foreground",
                )}
                aria-label="No útil"
                aria-pressed={sessionFeedback === -1}
                title="La conversación no fue útil"
              >
                <ThumbsDown className="h-3 w-3" aria-hidden />
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-componentes
// ─────────────────────────────────────────────────────────────────────────────

interface ToolCallInfo {
  toolName: string;
  state: string;
  input?: unknown;
  output?: unknown;
}

function Message({
  role,
  content,
  toolCalls,
  onContentClick,
  onNavigate,
}: {
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: ToolCallInfo[];
  onContentClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onNavigate: (url: string) => void;
}) {
  if (role === "system") return null;
  const isUser = role === "user";
  return (
    <div className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
      {/* Tool calls inline antes del texto final */}
      {!isUser && toolCalls && toolCalls.length > 0 && (
        <div className="flex flex-col gap-1 w-full max-w-[90%]">
          {toolCalls.map((tc, i) => (
            <ToolCallChip key={`${tc.toolName}-${i}`} tc={tc} onNavigate={onNavigate} />
          ))}
        </div>
      )}
      {content && (
        <div
          className={cn(
            "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground",
          )}
          onClick={onContentClick}
          dangerouslySetInnerHTML={isUser ? undefined : { __html: renderMarkdown(content) }}
        >
          {isUser ? content : undefined}
        </div>
      )}
    </div>
  );
}

function ToolCallChip({
  tc,
  onNavigate,
}: {
  tc: ToolCallInfo;
  onNavigate: (url: string) => void;
}) {
  const LABELS: Record<string, string> = {
    searchPatient: "Buscando pacientes",
    getMyPatientsAsPhysician: "Consultando tus pacientes",
    suggestNavigation: "Sugerencia de navegación",
    scheduleOutpatientAppointmentDraft: "Preparando cita ambulatoria",
  };
  const label = LABELS[tc.toolName] ?? tc.toolName;
  const inProgress = tc.state === "input-streaming" || tc.state === "input-available" || tc.state === "executing";
  const done = tc.state === "output-available";

  // Caso especial: suggestNavigation muestra botón "Ir ahí".
  if (tc.toolName === "suggestNavigation" && done && tc.output) {
    const out = tc.output as { url?: string; label?: string; reason?: string };
    if (out.url) {
      return (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-xs space-y-1">
          <p className="text-muted-foreground">{out.reason ?? "Sugerencia"}</p>
          <button
            type="button"
            onClick={() => onNavigate(out.url!)}
            className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-2 py-1 text-xs hover:bg-primary/90"
          >
            <ExternalLink className="h-3 w-3" aria-hidden /> {out.label ?? "Ir"}
          </button>
        </div>
      );
    }
  }

  // Fase 5: pending_action — card de confirmación humana para escrituras.
  if (done && tc.output) {
    const out = tc.output as {
      type?: string;
      actionType?: string;
      params?: Record<string, unknown>;
      summary?: string;
      error?: string;
    };
    if (out.type === "pending_action" && out.actionType && out.params && out.summary) {
      return (
        <PendingActionCard
          actionType={out.actionType}
          params={out.params}
          summary={out.summary}
          onNavigate={onNavigate}
        />
      );
    }
  }

  // Caso general: search/patient queries.
  let resultSummary = "";
  if (done && tc.output) {
    const out = tc.output as { count?: number; error?: string; patients?: Array<{ name?: string; mrn?: string }> };
    if (out.error) {
      resultSummary = `⚠️ ${out.error}`;
    } else if (typeof out.count === "number") {
      resultSummary = `${out.count} resultado(s)`;
    }
  }

  return (
    <div className="rounded-md border bg-muted/40 p-2 text-xs flex items-center gap-2">
      <Sparkles className="h-3 w-3 text-primary shrink-0" aria-hidden />
      <span className="font-medium">{label}</span>
      {inProgress && <span className="text-muted-foreground italic">en curso…</span>}
      {done && resultSummary && <span className="text-muted-foreground">— {resultSummary}</span>}
    </div>
  );
}

/**
 * Renderer minimal de markdown para chat — soporta:
 *  - **negritas** y *cursivas*
 *  - listas numeradas y con viñetas
 *  - [texto](url) → <a href> con span ExternalLink si la URL es externa
 *  - `código inline`
 *  - saltos de línea preservados (whitespace-pre-wrap en CSS)
 *
 * NO usa una lib externa para mantener bundle pequeño. Es safe contra XSS
 * básico porque escapa HTML antes y luego inyecta solo tags conocidos.
 */
function renderMarkdown(raw: string): string {
  // 1. Escapar HTML.
  let html = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  // 2. Links [texto](url) — solo http/https/rutas internas.
  html = html.replace(
    /\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)]+)\)/g,
    (_match, text, url) => {
      const isInternal = url.startsWith("/");
      const safeUrl = url.replace(/"/g, "&quot;");
      const target = isInternal ? "" : ' target="_blank" rel="noopener noreferrer"';
      const externalIcon = isInternal ? "" : ' ↗';
      return `<a href="${safeUrl}" class="underline font-medium text-primary hover:opacity-80"${target}>${text}${externalIcon}</a>`;
    },
  );

  // 3. Negritas **texto** y cursivas *texto*.
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");

  // 4. Código inline `texto`.
  html = html.replace(
    /`([^`]+)`/g,
    '<code class="rounded bg-background/50 px-1 text-xs font-mono">$1</code>',
  );

  // 5. Listas numeradas: `1. item` → <ol>. Procesamos en grupos.
  html = html.replace(
    /(?:^|\n)((?:\d+\.\s.+(?:\n|$))+)/g,
    (block) => {
      const items = block
        .trim()
        .split("\n")
        .map((line) => line.replace(/^\d+\.\s/, "").trim())
        .filter(Boolean)
        .map((item) => `<li>${item}</li>`)
        .join("");
      return `<ol class="list-decimal list-inside space-y-1 my-1">${items}</ol>`;
    },
  );

  // 6. Listas con viñetas: `- item` o `* item`.
  html = html.replace(
    /(?:^|\n)((?:[-*]\s.+(?:\n|$))+)/g,
    (block) => {
      const items = block
        .trim()
        .split("\n")
        .map((line) => line.replace(/^[-*]\s/, "").trim())
        .filter(Boolean)
        .map((item) => `<li>${item}</li>`)
        .join("");
      return `<ul class="list-disc list-inside space-y-1 my-1">${items}</ul>`;
    },
  );

  return html;
}

/** Extrae el texto de un mensaje del SDK (soporta parts[] o content). */
function extractText(m: AnyMessage): string {
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.parts)) {
    return m.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("");
  }
  return "";
}

/**
 * Extrae las tool calls del mensaje (Fase 3 agente). El SDK las representa
 * como parts con `type: "tool-{toolName}"`. Devuelve metadata para que el
 * ChatWidget las renderice como chips con estado y resultados.
 */
function extractToolCalls(m: AnyMessage): ToolCallInfo[] {
  if (!Array.isArray(m.parts)) return [];
  const calls: ToolCallInfo[] = [];
  for (const p of m.parts) {
    if (!p.type || !p.type.startsWith("tool-")) continue;
    const toolName = p.toolName ?? p.type.replace(/^tool-/, "");
    calls.push({
      toolName,
      state: p.state ?? "unknown",
      input: p.input,
      output: p.output,
    });
  }
  return calls;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 5: Pending action card (confirmación humana para tools de escritura)
// ─────────────────────────────────────────────────────────────────────────────

function PendingActionCard({
  actionType,
  params,
  summary,
  onNavigate,
}: {
  actionType: string;
  params: Record<string, unknown>;
  summary: string;
  onNavigate: (url: string) => void;
}) {
  const [status, setStatus] = React.useState<"pending" | "executing" | "done" | "error">("pending");
  const [resultMsg, setResultMsg] = React.useState<string>("");
  const [navigateTo, setNavigateTo] = React.useState<string | null>(null);

  async function handleConfirm() {
    setStatus("executing");
    try {
      const res = await fetch("/api/chat/execute-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionType, params }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        message?: string;
        navigateTo?: string;
      };
      if (data.ok) {
        setStatus("done");
        setResultMsg(data.message ?? "Acción ejecutada.");
        if (data.navigateTo) setNavigateTo(data.navigateTo);
      } else {
        setStatus("error");
        setResultMsg(data.message ?? "Error al ejecutar.");
      }
    } catch (err) {
      setStatus("error");
      setResultMsg(err instanceof Error ? err.message : String(err));
    }
  }

  function handleCancel() {
    setStatus("error");
    setResultMsg("Cancelado por el usuario.");
  }

  return (
    <div className="rounded-md border-2 border-amber-300 bg-amber-50 p-3 text-xs space-y-2">
      <div className="flex items-start gap-2">
        <Sparkles className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" aria-hidden />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-amber-900">Confirma esta acción</p>
          <p
            className="text-amber-900 mt-1"
            // El summary viene del server y contiene **markdown** simple.
            dangerouslySetInnerHTML={{ __html: renderMarkdown(summary) }}
          />
        </div>
      </div>

      {status === "pending" && (
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border border-amber-400 bg-white px-3 py-1 text-xs hover:bg-amber-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="rounded-md bg-amber-600 text-white px-3 py-1 text-xs hover:bg-amber-700"
          >
            Confirmar
          </button>
        </div>
      )}

      {status === "executing" && (
        <p className="text-amber-900 italic">Ejecutando...</p>
      )}

      {status === "done" && (
        <div className="space-y-2">
          <p className="text-green-800 font-medium">✓ {resultMsg}</p>
          {navigateTo && (
            <button
              type="button"
              onClick={() => onNavigate(navigateTo)}
              className="inline-flex items-center gap-1 rounded-md bg-green-600 text-white px-2 py-1 text-xs hover:bg-green-700"
            >
              <ExternalLink className="h-3 w-3" aria-hidden /> Ver resultado
            </button>
          )}
        </div>
      )}

      {status === "error" && (
        <p className="text-red-700 font-medium">⚠️ {resultMsg}</p>
      )}
    </div>
  );
}
