"use client";

/**
 * /feedback — encuesta NPS simple.
 *
 * El usuario califica del 0 al 10 la probabilidad de recomendar el HIS
 * y opcionalmente deja un comentario. Alimenta el KPI gob_satisfaccion.
 *
 * Diseño Net Promoter Score estándar:
 *   - 0-6: detractor (rojo)
 *   - 7-8: pasivo (ámbar)
 *   - 9-10: promotor (verde)
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Label } from "@his/ui/components/label";
import { cn } from "@his/ui/lib/utils";

export default function FeedbackPage() {
  const [score, setScore] = React.useState<number | null>(null);
  const [comment, setComment] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (score == null) {
      setError("Selecciona un puntaje");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch("/api/nps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, comment: comment.trim() || null }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setError(data?.error ?? "Error al enviar");
      } else {
        setDone(true);
      }
    } catch {
      setError("Sin conexión");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <main className="mx-auto max-w-md p-6">
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-2xl">✓</p>
            <p className="mt-2 font-medium">¡Gracias por tu retroalimentación!</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Tu opinión ayuda a mejorar el HIS para todos los equipos.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>¿Recomendarías el HIS Avante?</CardTitle>
          <CardDescription>
            En una escala de 0 a 10, ¿qué tan probable es que recomiendes esta
            plataforma a un colega? Tu feedback alimenta el indicador NPS del
            comité directivo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Escala 0-10 */}
            <div>
              <div className="grid grid-cols-11 gap-1">
                {Array.from({ length: 11 }, (_, i) => i).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setScore(n)}
                    className={cn(
                      "flex aspect-square items-center justify-center rounded border text-sm font-medium transition-colors",
                      score === n
                        ? n <= 6
                          ? "border-destructive bg-destructive text-destructive-foreground"
                          : n <= 8
                          ? "border-amber-500 bg-amber-500 text-white"
                          : "border-emerald-500 bg-emerald-500 text-white"
                        : "hover:bg-muted",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                <span>Nada probable</span>
                <span>Muy probable</span>
              </div>
            </div>

            {/* Comentario */}
            <div className="space-y-1.5">
              <Label htmlFor="comment">Comentario (opcional)</Label>
              <textarea
                id="comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={4}
                maxLength={1000}
                className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="¿Qué te gustaría destacar o mejorar?"
              />
              <p className="text-xs text-muted-foreground">{comment.length}/1000</p>
            </div>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            <Button type="submit" disabled={submitting || score == null} className="w-full">
              {submitting ? "Enviando…" : "Enviar respuesta"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
