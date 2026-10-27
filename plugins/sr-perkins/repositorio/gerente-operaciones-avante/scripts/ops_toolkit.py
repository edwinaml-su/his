#!/usr/bin/env python3
"""ops_toolkit — cálculos del Gerente de Operaciones de Avante.

Subcomandos (todos leen CSV con encabezado y escriben Markdown a stdout, o CSV con --out):

  abcxyz    --csv consumo.csv      columnas: item, sede, valor_anual, demanda_semanal (lista separada por ;)
  reorden   --csv demanda.csv      columnas: item, sede, demanda_diaria, desv_demanda, lead_time, desv_lead_time,
                                   [critico (S/N)], [inventario_actual], [costo_pedido], [costo_unitario], [tasa_mantenimiento]
  scorecard --csv proveedores.csv  columnas: proveedor, fill_rate, puntualidad, calidad, precio, servicio (0–100; servicio 1–5 admitido)
  oee       --csv quirofano.csv    columnas: recurso, horas_programadas, horas_usadas, casos_planificados, casos_reales, casos_sin_evento
  dotacion  --csv demanda_turno.csv columnas: servicio, turno, horas_turno, pacientes, hcpd, [ausentismo], [ratio_enf], [ratio_aux]
  4dx       --csv compromisos.csv  columnas: equipo, semana, persona, compromiso, lead, hecho (S/N)

Ejemplo: python3 ops_toolkit.py reorden --csv demanda.csv --z 1.65
"""
import argparse
import csv
import math
import statistics
import sys


def read_csv(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def num(row, key, default=0.0):
    v = row.get(key, "")
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return default


def emit(rows, headers, out=None):
    if out:
        with open(out, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=headers)
            w.writeheader()
            w.writerows(rows)
        print(f"escrito {out} ({len(rows)} filas)")
        return
    print("| " + " | ".join(headers) + " |")
    print("|" + "---|" * len(headers))
    for r in rows:
        print("| " + " | ".join(str(r.get(h, "")) for h in headers) + " |")


# ---------- ABC / XYZ ----------
def cmd_abcxyz(a):
    rows = read_csv(a.csv)
    total = sum(num(r, "valor_anual") for r in rows) or 1.0
    rows.sort(key=lambda r: -num(r, "valor_anual"))
    acum, out = 0.0, []
    for r in rows:
        acum += num(r, "valor_anual")
        pct = acum / total
        abc = "A" if pct <= 0.80 else "B" if pct <= 0.95 else "C"
        serie = [float(x) for x in str(r.get("demanda_semanal", "")).split(";") if x.strip()]
        if len(serie) >= 2 and statistics.mean(serie) > 0:
            cv = statistics.pstdev(serie) / statistics.mean(serie)
        else:
            cv = float("nan")
        xyz = "X" if cv < 0.5 else "Y" if cv < 1.0 else "Z" if not math.isnan(cv) else "?"
        out.append({"item": r["item"], "sede": r.get("sede", ""), "valor_anual": round(num(r, "valor_anual"), 2),
                    "pct_acum": f"{pct:.1%}", "ABC": abc, "CV": "n/d" if math.isnan(cv) else round(cv, 2), "XYZ": xyz,
                    "clase": abc + xyz})
    emit(out, ["item", "sede", "valor_anual", "pct_acum", "ABC", "CV", "XYZ", "clase"], a.out)


# ---------- Punto de reorden ----------
def cmd_reorden(a):
    rows = read_csv(a.csv)
    out = []
    for r in rows:
        d, sd = num(r, "demanda_diaria"), num(r, "desv_demanda")
        L, sL = num(r, "lead_time"), num(r, "desv_lead_time")
        crit = str(r.get("critico", "N")).strip().upper() in ("S", "SI", "SÍ", "Y", "K", "1")
        z = 2.33 if crit else a.z
        ss = z * math.sqrt(L * sd ** 2 + (d ** 2) * sL ** 2)
        if crit:
            ss = max(ss, 2 * d * L)  # política K: ≥ 2× lead time
        rop = d * L + ss
        inv = num(r, "inventario_actual", float("nan"))
        doi = inv / d if d > 0 and not math.isnan(inv) else float("nan")
        S, c, h = num(r, "costo_pedido"), num(r, "costo_unitario"), num(r, "tasa_mantenimiento", 0.25)
        eoq = math.sqrt(2 * d * 365 * S / (c * h)) if S > 0 and c > 0 else float("nan")
        estado = "—"
        if not math.isnan(inv):
            estado = "QUIEBRE" if inv <= 0 else "PEDIR" if inv <= rop else "OK"
        out.append({"item": r["item"], "sede": r.get("sede", ""), "critico": "K" if crit else "",
                    "SS": round(ss, 1), "ROP": round(rop, 1), "EOQ": "n/d" if math.isnan(eoq) else round(eoq, 0),
                    "inventario": "n/d" if math.isnan(inv) else inv, "DOI": "n/d" if math.isnan(doi) else round(doi, 1),
                    "estado": estado})
    emit(out, ["item", "sede", "critico", "SS", "ROP", "EOQ", "inventario", "DOI", "estado"], a.out)


# ---------- Scorecard de proveedores ----------
PESOS = {"fill_rate": 0.30, "puntualidad": 0.20, "calidad": 0.20, "precio": 0.15, "servicio": 0.15}


def cmd_scorecard(a):
    rows = read_csv(a.csv)
    out = []
    for r in rows:
        vals = {}
        for k in PESOS:
            v = num(r, k)
            if k == "servicio" and v <= 5:
                v = v / 5 * 100
            if v <= 1.0 and k != "servicio":
                v *= 100
            vals[k] = v
        score = sum(vals[k] * PESOS[k] for k in PESOS)
        cat = "Preferente" if score >= 85 else "Observado" if score >= 70 else "Sustituir / 2.º proveedor"
        out.append({"proveedor": r["proveedor"], **{k: round(vals[k], 1) for k in PESOS}, "puntaje": round(score, 1),
                    "categoria": cat})
    out.sort(key=lambda x: -x["puntaje"])
    emit(out, ["proveedor", *PESOS.keys(), "puntaje", "categoria"], a.out)


# ---------- OEE adaptado ----------
def cmd_oee(a):
    rows = read_csv(a.csv)
    out = []
    for r in rows:
        hp, hu = num(r, "horas_programadas"), num(r, "horas_usadas")
        cp, cr, cs = num(r, "casos_planificados"), num(r, "casos_reales"), num(r, "casos_sin_evento")
        disp = hu / hp if hp else 0
        rend = cr / cp if cp else 0
        cal = cs / cr if cr else 0
        oee = disp * rend * cal
        out.append({"recurso": r["recurso"], "disponibilidad": f"{disp:.1%}", "rendimiento": f"{rend:.1%}",
                    "calidad": f"{cal:.1%}", "OEE": f"{oee:.1%}",
                    "lectura": "OK" if oee >= 0.65 else "revisar " + min(
                        [("disponibilidad", disp), ("rendimiento", rend), ("calidad", cal)], key=lambda t: t[1])[0]})
    emit(out, ["recurso", "disponibilidad", "rendimiento", "calidad", "OEE", "lectura"], a.out)


# ---------- Dotación por turno ----------
def cmd_dotacion(a):
    rows = read_csv(a.csv)
    out = []
    for r in rows:
        ht = num(r, "horas_turno", 8)
        pac, hcpd = num(r, "pacientes"), num(r, "hcpd")
        aus = num(r, "ausentismo", 1.20)
        horas = pac * hcpd * (ht / 24)
        fte = horas / ht * aus
        ratio_enf = num(r, "ratio_enf", 0.6)
        ratio_aux = num(r, "ratio_aux", 1 - ratio_enf)
        enf = math.ceil(fte * ratio_enf)
        aux = math.ceil(fte * ratio_aux)
        out.append({"servicio": r["servicio"], "turno": r.get("turno", ""), "pacientes": pac, "HCPD": hcpd,
                    "horas_requeridas": round(horas, 1), "FTE_turno": round(fte, 2), "enfermeras": enf,
                    "auxiliares": aux, "total": enf + aux})
    emit(out, ["servicio", "turno", "pacientes", "HCPD", "horas_requeridas", "FTE_turno", "enfermeras", "auxiliares",
               "total"], a.out)


# ---------- 4DX ----------
def cmd_4dx(a):
    rows = read_csv(a.csv)
    equipos = {}
    for r in rows:
        e = equipos.setdefault(r["equipo"], {"compromisos": 0, "hechos": 0, "semanas": set(), "lead": {}})
        e["compromisos"] += 1
        hecho = str(r.get("hecho", "N")).strip().upper() in ("S", "SI", "SÍ", "Y", "1")
        e["hechos"] += hecho
        e["semanas"].add(r.get("semana", ""))
        l = e["lead"].setdefault(r.get("lead", "?"), [0, 0])
        l[0] += 1
        l[1] += hecho
    out = []
    for eq, e in equipos.items():
        cumpl = e["hechos"] / e["compromisos"] if e["compromisos"] else 0
        leads = "; ".join(f"{k}: {v[1]}/{v[0]}" for k, v in e["lead"].items())
        out.append({"equipo": eq, "semanas": len(e["semanas"]), "compromisos": e["compromisos"],
                    "cumplidos": e["hechos"], "cumplimiento": f"{cumpl:.0%}", "por_lead": leads,
                    "lectura": "cadencia sana" if cumpl >= 0.8 else "revisar compromisos (demasiados o no propios)"})
    emit(out, ["equipo", "semanas", "compromisos", "cumplidos", "cumplimiento", "por_lead", "lectura"], a.out)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name, fn in [("abcxyz", cmd_abcxyz), ("reorden", cmd_reorden), ("scorecard", cmd_scorecard),
                     ("oee", cmd_oee), ("dotacion", cmd_dotacion), ("4dx", cmd_4dx)]:
        sp = sub.add_parser(name)
        sp.add_argument("--csv", required=True)
        sp.add_argument("--out")
        if name == "reorden":
            sp.add_argument("--z", type=float, default=1.65, help="nivel de servicio (1.65=95 %%, 2.33=99 %%)")
        sp.set_defaults(fn=fn)
    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
