"use client";

/**
 * CC-0016 — Parametrización › «🔧 Reglas generales». Toggles + input
 * numérico configurable para `maxN`.
 */
import * as React from "react";
import { Input } from "@his/ui/components/input";
import { Switch } from "@his/ui/components/switch";
import { trpc } from "@/lib/trpc/react";
import { RULE_META } from "../field-rule-meta";

export function Reglas() {
  const utils = trpc.useUtils();
  const listQ = trpc.imagingRequest.rules.list.useQuery();
  const set = trpc.imagingRequest.rules.set.useMutation({
    onSuccess: () => utils.imagingRequest.rules.list.invalidate(),
  });

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {(listQ.data ?? []).map((r) => {
        const meta = RULE_META[r.ruleKey];
        return (
          <div key={r.ruleKey} className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">{meta.label}</p>
              <p className="text-xs text-muted-foreground">{meta.desc}</p>
              {r.ruleKey === "maxN" && r.enabled ? (
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Máximo:</span>
                  <Input
                    type="number"
                    min={1}
                    max={999}
                    className="h-7 w-20"
                    defaultValue={r.valorNum ?? 10}
                    onBlur={(e) =>
                      set.mutate({ ruleKey: "maxN", enabled: true, valorNum: Number(e.target.value) || 10 })
                    }
                  />
                </div>
              ) : null}
            </div>
            <Switch
              checked={r.enabled}
              onCheckedChange={(c) => set.mutate({ ruleKey: r.ruleKey, enabled: c, valorNum: r.valorNum })}
              aria-label={meta.label}
            />
          </div>
        );
      })}
    </div>
  );
}
