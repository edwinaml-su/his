#!/usr/bin/env python3
"""
render_tablero.py — Fusiona y renderiza el tablero de seguimiento continuo.

Idea: el modelo detecta de Microsoft 365 lo nuevo o cambiado y lo entrega en
`updates.json`. Este script lo fusiona con el estado previo (`board.json`) SIN
duplicar (la clave es el `id`), preserva el estado de cada tarea, archiva las
terminadas con antigüedad y genera un `TABLERO.md` con formato consistente.

Solo usa la biblioteca estándar.

Esquema de una tarea (ver references/plantillas.md):
    id          str  (estable; clave de fusión)         [requerido]
    dominio     tickets | proyectos | programacion | seguridad
    titulo      str                                      [requerido]
    detalle     str
    origen      str
    referencia  str
    prioridad   alta | media | baja
    estado      por_hacer | en_progreso | esperando | hecho
    responsable str
    fecha_limite YYYY-MM-DD
    notas       str
    actualizado YYYY-MM-DD  (lo escribe este script)
    creado      YYYY-MM-DD  (lo escribe este script)

Uso:
    python render_tablero.py --updates updates.json --out-json board.json \
        --out-md TABLERO.md [--current board.json] [--archivar-dias 14]
"""

import argparse
import datetime as _dt
import json
import re
import sys
from pathlib import Path

DOMINIOS = ["tickets", "proyectos", "programacion", "seguridad"]
DOMINIOS_TITULO = {
    "tickets": "Tickets",
    "proyectos": "Proyectos",
    "programacion": "Programación",
    "seguridad": "Seguridad",
}
ESTADOS = ["por_hacer", "en_progreso", "esperando", "hecho"]
ESTADOS_TITULO = {
    "por_hacer": "Por hacer",
    "en_progreso": "En progreso",
    "esperando": "Esperando",
    "hecho": "Hecho",
}
PRIORIDADES = ["alta", "media", "baja"]
PRIORIDAD_MARCA = {"alta": "🔴", "media": "🟠", "baja": "🟢"}

CAMPOS_TEXTO = [
    "titulo", "detalle", "origen", "referencia",
    "responsable", "fecha_limite", "notas",
]


def hoy() -> str:
    return _dt.date.today().isoformat()


def _norm_enum(value, allowed, default):
    if isinstance(value, str) and value.strip().lower() in allowed:
        return value.strip().lower()
    return default


def _parse_fecha(value):
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", value):
        return None
    try:
        return _dt.date.fromisoformat(value)
    except ValueError:
        return None


def normalizar(tarea: dict) -> dict:
    """Devuelve una copia normalizada y validada de una tarea."""
    t = {}
    tid = str(tarea.get("id", "")).strip()
    if not tid:
        # id estable derivado del título + origen para no perder la tarea
        base = (str(tarea.get("titulo", "")) + "-" + str(tarea.get("origen", ""))).lower()
        slug = re.sub(r"[^a-z0-9]+", "-", base).strip("-")[:48] or "tarea"
        tid = "AUTO-" + slug
    t["id"] = tid
    t["dominio"] = _norm_enum(tarea.get("dominio"), DOMINIOS, "tickets")
    t["prioridad"] = _norm_enum(tarea.get("prioridad"), PRIORIDADES, "media")
    t["estado"] = _norm_enum(tarea.get("estado"), ESTADOS, "por_hacer")
    for campo in CAMPOS_TEXTO:
        val = tarea.get(campo, "")
        t[campo] = "" if val is None else str(val).strip()
    if not t["titulo"]:
        t["titulo"] = "(sin título)"
    # fecha_limite solo si es válida
    f = _parse_fecha(t.get("fecha_limite"))
    t["fecha_limite"] = f.isoformat() if f else ""
    return t


def cargar_json(ruta, esperado_tipo):
    p = Path(ruta)
    if not p.exists():
        raise FileNotFoundError(f"No existe: {ruta}")
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ValueError(f"JSON inválido en {ruta}: {e}")
    if esperado_tipo == "board":
        # admite {"tareas": [...], "archivadas": [...]} o una lista simple
        if isinstance(data, list):
            return {"tareas": data, "archivadas": []}
        if isinstance(data, dict):
            data.setdefault("tareas", [])
            data.setdefault("archivadas", [])
            return data
        raise ValueError(f"Formato de board no reconocido en {ruta}")
    # updates: lista de tareas
    if isinstance(data, dict) and "tareas" in data:
        data = data["tareas"]
    if not isinstance(data, list):
        raise ValueError(f"updates debe ser una lista de tareas: {ruta}")
    return data


def fusionar(current: dict, updates: list, archivar_dias: int) -> dict:
    hoy_str = hoy()
    por_id = {}

    # estado previo
    for raw in current.get("tareas", []):
        t = normalizar(raw)
        t.setdefault("creado", raw.get("creado") or hoy_str)
        t["actualizado"] = raw.get("actualizado") or hoy_str
        por_id[t["id"]] = t

    archivadas = list(current.get("archivadas", []))

    # aplicar updates (crear o actualizar por id)
    campos_actualizables = set(CAMPOS_TEXTO) | {"dominio", "prioridad", "estado"}
    for raw in updates:
        rid = str(raw.get("id", "")).strip()
        if rid and rid in por_id:
            # Actualización parcial: solo se sobrescriben los campos que el
            # update realmente trae. Lo demás (título, dominio, fechas…) se
            # preserva tal cual estaba. Esto es lo que mantiene viva la tarea
            # entre corridas aunque el update solo cambie el estado.
            prev = por_id[rid]
            merged = dict(prev)
            for k in campos_actualizables:
                if k in raw and raw[k] is not None and str(raw[k]).strip() != "":
                    merged[k] = raw[k]
            merged["id"] = rid
            merged = normalizar(merged)
            merged["creado"] = prev.get("creado", hoy_str)
            merged["actualizado"] = hoy_str
            por_id[rid] = merged
        else:
            u = normalizar(raw)
            u["creado"] = hoy_str
            u["actualizado"] = hoy_str
            por_id[u["id"]] = u

    # archivar terminadas con antigüedad
    activas = []
    limite = _dt.date.today() - _dt.timedelta(days=archivar_dias)
    for t in por_id.values():
        if t["estado"] == "hecho":
            fa = _parse_fecha(t.get("actualizado")) or _dt.date.today()
            if fa < limite:
                archivadas.append(t)
                continue
        activas.append(t)

    return {"tareas": activas, "archivadas": archivadas, "generado": hoy_str}


def _orden_tarea(t):
    pri = {"alta": 0, "media": 1, "baja": 2}.get(t["prioridad"], 1)
    # las que tienen fecha límite primero, por fecha
    f = _parse_fecha(t.get("fecha_limite"))
    fecha_key = f.toordinal() if f else 10 ** 9
    return (pri, fecha_key, t["titulo"].lower())


def _linea_tarea(t) -> str:
    marca = PRIORIDAD_MARCA.get(t["prioridad"], "")
    partes = [f"- {marca} **{t['titulo']}**"]
    meta = []
    if t.get("referencia"):
        meta.append(t["referencia"])
    if t.get("origen"):
        meta.append(t["origen"])
    if t.get("responsable"):
        meta.append(f"resp: {t['responsable']}")
    if t.get("fecha_limite"):
        meta.append(f"límite: {t['fecha_limite']}")
    if meta:
        partes.append("  \n  " + " · ".join(meta))
    if t.get("detalle"):
        partes.append(f"  \n  {t['detalle']}")
    if t.get("notas"):
        partes.append(f"  \n  _Nota: {t['notas']}_")
    partes.append(f"  \n  `{t['id']}` · act. {t.get('actualizado','')}")
    return "".join(partes)


def render_md(board: dict) -> str:
    tareas = board.get("tareas", [])
    out = []
    out.append("# Tablero de seguimiento")
    out.append("")
    out.append(f"_Generado: {board.get('generado', hoy())}_")
    out.append("")

    # resumen
    total = len(tareas)
    by_estado = {e: 0 for e in ESTADOS}
    vencen = 0
    hoy_d = _dt.date.today()
    for t in tareas:
        by_estado[t["estado"]] = by_estado.get(t["estado"], 0) + 1
        f = _parse_fecha(t.get("fecha_limite"))
        if f and f <= hoy_d and t["estado"] != "hecho":
            vencen += 1
    resumen = (
        f"**{total} tareas activas** — "
        f"Por hacer: {by_estado['por_hacer']} · "
        f"En progreso: {by_estado['en_progreso']} · "
        f"Esperando: {by_estado['esperando']} · "
        f"Hecho: {by_estado['hecho']}"
    )
    out.append("## Resumen")
    out.append("")
    out.append(resumen)
    if vencen:
        out.append("")
        out.append(f"> ⚠️ {vencen} tarea(s) vencida(s) o con límite hoy.")
    out.append("")

    if total == 0:
        out.append("_Tablero vacío. Aún no hay tareas registradas._")
        out.append("")

    # por dominio -> por estado
    for dom in DOMINIOS:
        del_dom = [t for t in tareas if t["dominio"] == dom]
        if not del_dom:
            continue
        out.append(f"## {DOMINIOS_TITULO[dom]}")
        out.append("")
        for est in ESTADOS:
            grupo = sorted(
                [t for t in del_dom if t["estado"] == est], key=_orden_tarea
            )
            if not grupo:
                continue
            out.append(f"### {ESTADOS_TITULO[est]}")
            out.append("")
            for t in grupo:
                out.append(_linea_tarea(t))
                out.append("")

    arch = board.get("archivadas", [])
    if arch:
        out.append("---")
        out.append("")
        out.append(f"_Archivadas (terminadas hace tiempo): {len(arch)}._")
        out.append("")

    return "\n".join(out).rstrip() + "\n"


def main():
    ap = argparse.ArgumentParser(
        description="Fusiona y renderiza el tablero de seguimiento continuo."
    )
    ap.add_argument("--updates", required=True,
                    help="JSON con las tareas nuevas o cambiadas de esta corrida.")
    ap.add_argument("--current",
                    help="board.json previo. Omitir la primera vez.")
    ap.add_argument("--out-json", default="board.json",
                    help="Salida del estado fusionado (por defecto board.json).")
    ap.add_argument("--out-md", default="TABLERO.md",
                    help="Salida legible (por defecto TABLERO.md).")
    ap.add_argument("--archivar-dias", type=int, default=14,
                    help="Días tras los que una tarea 'hecho' se archiva (14).")
    args = ap.parse_args()

    try:
        updates = cargar_json(args.updates, "updates")
        if args.current:
            current = cargar_json(args.current, "board")
        else:
            current = {"tareas": [], "archivadas": []}
    except (FileNotFoundError, ValueError) as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    board = fusionar(current, updates, args.archivar_dias)

    Path(args.out_json).write_text(
        json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    Path(args.out_md).write_text(render_md(board), encoding="utf-8")

    n = len(board["tareas"])
    a = len(board["archivadas"])
    print(f"OK · {n} tareas activas · {a} archivadas")
    print(f"  - {args.out_json}")
    print(f"  - {args.out_md}")


if __name__ == "__main__":
    main()
