#!/usr/bin/env python3
"""pm_toolkit — calculadora de la PMO de Avante.

Subcomandos:
  cpm   --csv actividades.csv [--inicio AAAA-MM-DD] [--xlsx salida.xlsx] [--montecarlo N]
        CSV: id,actividad,duracion,predecesoras,responsable[,optimista,pesimista]
  evm   --bac B --pv PV --ev EV --ac AC
  wsjf  --csv items.csv      CSV: item,valor,tiempo,riesgo,tamano
  rice  --csv items.csv      CSV: item,alcance,impacto,confianza,esfuerzo
  ahp   --criterios c.csv --proyectos p.csv
        c.csv: matriz de comparación por pares (encabezado = criterios, filas = criterios)
        p.csv: proyecto,<criterio1>,<criterio2>,...   (puntajes 1-5)
  org   --csv posiciones.csv --vista corporativo|funcional|operativo
        CSV: id,puesto,persona,entidad,gerencia,sede,reporta_a,reporte_funcional_a,rol_operativo

Salida en Markdown/Mermaid por stdout; --json para datos crudos.
Solo depende de la biblioteca estándar; --xlsx requiere openpyxl.
"""
import argparse, csv, json, math, random, sys
from datetime import date, timedelta

# ---------------------------------------------------------------- utilidades
def leer_csv(ruta):
    with open(ruta, newline="", encoding="utf-8-sig") as f:
        return [{k.strip(): (v or "").strip() for k, v in r.items()} for r in csv.DictReader(f)]

def fmt(v):
    return int(v) if isinstance(v, float) and v.is_integer() else v

def num(x, default=0.0):
    try:
        return float(str(x).replace(",", "."))
    except (TypeError, ValueError):
        return default

def tabla(cols, filas):
    out = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for r in filas:
        out.append("| " + " | ".join(str(c) for c in r) + " |")
    return "\n".join(out)

def dias_habiles(inicio, n):
    d, k = inicio, 0
    while k < n:
        d += timedelta(days=1)
        if d.weekday() < 5:
            k += 1
    return d

# ---------------------------------------------------------------- CPM
def cpm(acts):
    """acts: lista de dicts con id, duracion, predecesoras (lista). Devuelve dict id->calc."""
    ids = [a["id"] for a in acts]
    by = {a["id"]: a for a in acts}
    for a in acts:
        for p in a["pred"]:
            if p not in by:
                sys.exit(f"Predecesora desconocida '{p}' en {a['id']}")
    # orden topológico
    orden, visto, temp = [], set(), set()
    def visita(i):
        if i in visto: return
        if i in temp: sys.exit(f"Ciclo de dependencias en {i}")
        temp.add(i)
        for p in by[i]["pred"]: visita(p)
        temp.discard(i); visto.add(i); orden.append(i)
    for i in ids: visita(i)
    es, ef = {}, {}
    for i in orden:
        es[i] = max([ef[p] for p in by[i]["pred"]], default=0)
        ef[i] = es[i] + by[i]["dur"]
    fin = max(ef.values())
    suc = {i: [] for i in ids}
    for i in ids:
        for p in by[i]["pred"]: suc[p].append(i)
    ls, lf = {}, {}
    for i in reversed(orden):
        lf[i] = min([ls[s] for s in suc[i]], default=fin)
        ls[i] = lf[i] - by[i]["dur"]
    res = {}
    for i in ids:
        h = ls[i] - es[i]
        res[i] = dict(es=es[i], ef=ef[i], ls=ls[i], lf=lf[i], holgura=h, critica=(h == 0))
    return res, fin

def cmd_cpm(a):
    filas = leer_csv(a.csv)
    acts = []
    for r in filas:
        pred = [p.strip() for p in r.get("predecesoras", "").replace(";", ",").split(",") if p.strip()]
        acts.append(dict(id=r["id"], nombre=r.get("actividad", r["id"]), dur=num(r["duracion"]),
                         pred=pred, resp=r.get("responsable", ""),
                         o=num(r.get("optimista"), None) if r.get("optimista") else None,
                         p=num(r.get("pesimista"), None) if r.get("pesimista") else None))
    res, fin = cpm(acts)
    inicio = date.fromisoformat(a.inicio) if a.inicio else None
    cols = ["ID", "Actividad", "Dur", "Pred", "ES", "EF", "LS", "LF", "Holgura", "Crítica", "Responsable"]
    filas_out = []
    for x in acts:
        c = res[x["id"]]
        filas_out.append([x["id"], x["nombre"], int(x["dur"]), ",".join(x["pred"]) or "—",
                          fmt(c["es"]), fmt(c["ef"]), fmt(c["ls"]), fmt(c["lf"]), fmt(c["holgura"]), "**SÍ**" if c["critica"] else "", x["resp"]])
    criticas = [x["id"] for x in acts if res[x["id"]]["critica"]]
    out = [f"## Ruta crítica", f"Duración total: **{int(fin)} días** · Ruta crítica: {' → '.join(criticas)}"]
    if inicio:
        out.append(f"Inicio {inicio.isoformat()} → fin previsto **{dias_habiles(inicio, int(fin)).isoformat()}** (días hábiles L–V)")
    out.append(tabla(cols, filas_out))
    # Gantt Mermaid
    g = ["```mermaid", "gantt", "  dateFormat YYYY-MM-DD" if inicio else "  dateFormat X", "  title Cronograma",
         "  axisFormat %d/%m" if inicio else "  axisFormat %s"]
    for x in acts:
        c = res[x["id"]]
        tag = "crit, " if c["critica"] else ""
        if inicio:
            s = dias_habiles(inicio, c["es"]) if c["es"] else inicio
            g.append(f"  {x['nombre']} :{tag}{x['id']}, {s.isoformat()}, {int(x['dur'])}d")
        else:
            g.append(f"  {x['nombre']} :{tag}{x['id']}, {int(c['es'])}, {int(x['dur'])}d")
    g.append("```")
    out.append("\n".join(g))
    if a.montecarlo:
        fines = []
        for _ in range(a.montecarlo):
            sim = []
            for x in acts:
                o = x["o"] if x["o"] is not None else x["dur"] * 0.9
                p = x["p"] if x["p"] is not None else x["dur"] * 1.4
                sim.append(dict(x, dur=random.triangular(o, p, x["dur"])))
            fines.append(cpm(sim)[1])
        fines.sort()
        q = lambda k: fines[min(len(fines) - 1, int(k * len(fines)))]
        out.append(f"## Monte Carlo ({a.montecarlo} corridas)\nP50 **{q(.5):.0f} d** · P80 **{q(.8):.0f} d** · P90 **{q(.9):.0f} d** "
                   f"(determinista {int(fin)} d). Comprometer externamente P80; gestionar internamente a P50.")
    if a.xlsx:
        try:
            from openpyxl import Workbook
            from openpyxl.chart import BarChart, Reference
        except ImportError:
            sys.exit("openpyxl no instalado: pip install openpyxl")
        wb = Workbook(); ws = wb.active; ws.title = "Cronograma"
        ws.append([c.replace("**", "") for c in cols])
        for f in filas_out: ws.append([str(c).replace("**", "") for c in f])
        ws2 = wb.create_sheet("Gantt"); ws2.append(["Actividad", "Inicio (ES)", "Duración"])
        for x in acts: ws2.append([x["nombre"], res[x["id"]]["es"], x["dur"]])
        ch = BarChart(); ch.type = "bar"; ch.grouping = "stacked"; ch.overlap = 100; ch.title = "Gantt"
        ch.add_data(Reference(ws2, min_col=2, min_row=1, max_col=3, max_row=len(acts) + 1), titles_from_data=True)
        ch.set_categories(Reference(ws2, min_col=1, min_row=2, max_row=len(acts) + 1))
        ch.series[0].graphicalProperties.noFill = True; ch.y_axis.scaling.orientation = "maxMin"
        ch.height, ch.width = 10, 24; ws2.add_chart(ch, "E2"); wb.save(a.xlsx)
        out.append(f"Excel generado: {a.xlsx}")
    if a.json: print(json.dumps(dict(fin=fin, actividades=res), ensure_ascii=False, indent=2))
    else: print("\n\n".join(out))

# ---------------------------------------------------------------- EVM
def cmd_evm(a):
    bac, pv, ev, ac = a.bac, a.pv, a.ev, a.ac
    cpi = ev / ac if ac else float("nan"); spi = ev / pv if pv else float("nan")
    eac1 = bac / cpi if cpi else float("nan"); eac2 = ac + (bac - ev)
    eac3 = ac + (bac - ev) / (cpi * spi) if cpi and spi else float("nan")
    tcpi = (bac - ev) / (bac - ac) if bac != ac else float("nan")
    d = dict(CPI=cpi, SPI=spi, CV=ev - ac, SV=ev - pv, EAC_cpi=eac1, EAC_puntual=eac2, EAC_cpi_spi=eac3,
             ETC_cpi=eac1 - ac, VAC_cpi=bac - eac1, TCPI=tcpi, avance_pct=100 * ev / bac)
    if a.json: print(json.dumps(d, indent=2)); return
    rag = "🟢" if cpi >= .95 and spi >= .95 else ("🟡" if cpi >= .85 and spi >= .85 else "🔴")
    print(f"## EVM {rag}\n" + tabla(["Indicador", "Valor", "Lectura"], [
        ["CPI", f"{cpi:.2f}", "cada $1 gastado rinde $%.2f" % cpi],
        ["SPI", f"{spi:.2f}", "avanzamos al %.0f %% del ritmo planificado" % (spi * 100)],
        ["CV / SV", f"{ev-ac:,.0f} / {ev-pv:,.0f}", "negativo = sobrecosto / atraso"],
        ["EAC (BAC/CPI)", f"{eac1:,.0f}", "si la desviación es sistémica"],
        ["EAC (AC+BAC−EV)", f"{eac2:,.0f}", "si fue puntual"],
        ["EAC (CPI×SPI)", f"{eac3:,.0f}", "si tiempo y costo se arrastran"],
        ["VAC", f"{bac-eac1:,.0f}", "negativo = sobre presupuesto"],
        ["TCPI", f"{tcpi:.2f}", "eficiencia necesaria para cerrar en BAC"],
        ["Avance", f"{100*ev/bac:.1f} %", "valor ganado sobre BAC"]]))

# ---------------------------------------------------------------- WSJF / RICE
def cmd_wsjf(a):
    rows = []
    for r in leer_csv(a.csv):
        cod = num(r["valor"]) + num(r["tiempo"]) + num(r["riesgo"]); tam = num(r["tamano"]) or 1
        rows.append([r["item"], num(r["valor"]), num(r["tiempo"]), num(r["riesgo"]), cod, tam, cod / tam])
    rows.sort(key=lambda x: -x[-1])
    print("## WSJF (mayor primero)\n" + tabla(["#", "Ítem", "Valor", "Tiempo", "Riesgo/Op", "CoD", "Tamaño", "WSJF"],
          [[i + 1] + [r[0]] + [f"{v:g}" for v in r[1:-1]] + [f"{r[-1]:.2f}"] for i, r in enumerate(rows)]))

def cmd_rice(a):
    rows = []
    for r in leer_csv(a.csv):
        conf = num(r["confianza"]); conf = conf / 100 if conf > 1 else conf
        esf = num(r["esfuerzo"]) or 1
        rows.append([r["item"], num(r["alcance"]), num(r["impacto"]), conf, esf,
                     num(r["alcance"]) * num(r["impacto"]) * conf / esf])
    rows.sort(key=lambda x: -x[-1])
    print("## RICE (mayor primero)\n" + tabla(["#", "Ítem", "Alcance", "Impacto", "Confianza", "Esfuerzo", "RICE"],
          [[i + 1, r[0], f"{r[1]:g}", f"{r[2]:g}", f"{r[3]:.0%}", f"{r[4]:g}", f"{r[5]:.1f}"] for i, r in enumerate(rows)]))

# ---------------------------------------------------------------- AHP
RI = {1: 0, 2: 0, 3: .58, 4: .9, 5: 1.12, 6: 1.24, 7: 1.32, 8: 1.41, 9: 1.45, 10: 1.49}

def cmd_ahp(a):
    with open(a.criterios, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    crit = [c.strip() for c in rows[0][1:]]; n = len(crit)
    M = [[num(v, 1) for v in r[1:]] for r in rows[1:]]
    # pesos por media geométrica normalizada
    gm = [math.prod(M[i]) ** (1 / n) for i in range(n)]; w = [g / sum(gm) for g in gm]
    lam = sum(sum(M[i][j] * w[j] for j in range(n)) / w[i] for i in range(n)) / n
    ci = (lam - n) / (n - 1) if n > 1 else 0; cr = ci / RI.get(n, 1.49) if n > 2 else 0
    out = ["## AHP — pesos de criterios", tabla(["Criterio", "Peso"], [[c, f"{x:.3f}"] for c, x in zip(crit, w)]),
           f"λmax {lam:.3f} · CI {ci:.3f} · **CR {cr:.3f}** " + ("✔ consistente" if cr < .1 else "✘ revisar juicios (CR ≥ 0.10)")]
    if a.proyectos:
        ps = leer_csv(a.proyectos); res = []
        for p in ps:
            s = sum(w[i] * num(p.get(c, 0)) for i, c in enumerate(crit))
            res.append([p["proyecto"]] + [p.get(c, "") for c in crit] + [f"{s:.3f}"])
        res.sort(key=lambda r: -float(r[-1]))
        out += ["## Proyectos ordenados", tabla(["#", "Proyecto"] + crit + ["Puntaje"], [[i + 1] + r for i, r in enumerate(res)])]
    print("\n\n".join(out))

# ---------------------------------------------------------------- Organigramas
def cmd_org(a):
    pos = leer_csv(a.csv); by = {p["id"]: p for p in pos}
    lab = lambda p: f'{p["id"]}["{p["puesto"]}' + (f'<br/>{p["persona"]}' if p.get("persona") and p["persona"] != "(nombre)" else "") + '"]'
    g = ["```mermaid", "flowchart " + ("LR" if a.vista == "operativo" else "TB")]
    if a.vista == "corporativo":
        # solo primer y segundo nivel + entidades
        niveles = {}
        for p in pos:
            d, cur = 0, p
            while cur.get("reporta_a") and cur["reporta_a"] in by: d += 1; cur = by[cur["reporta_a"]]
            niveles[p["id"]] = d
        ents = sorted({p["entidad"] for p in pos if p.get("entidad")})
        for p in pos:
            if niveles[p["id"]] <= 1:
                g.append("  " + lab(p))
                if p.get("reporta_a") in by: g.append(f'  {p["reporta_a"]} --> {p["id"]}')
                elif p.get("reporta_a"): g.append(f'  {p["reporta_a"]}[{p["reporta_a"]}] --> {p["id"]}')
        for e in ents:
            if e and e != pos[0].get("entidad"):
                g.append(f'  E_{abs(hash(e))%10000}[("{e}")]');
                raiz = next((p["id"] for p in pos if niveles[p["id"]] == 0), None)
                if raiz: g.append(f'  {raiz} -.control.-> E_{abs(hash(e))%10000}')
    elif a.vista == "funcional":
        for p in pos:
            g.append("  " + lab(p))
            if p.get("reporta_a") in by: g.append(f'  {p["reporta_a"]} --> {p["id"]}')
            elif p.get("reporta_a"): g.append(f'  {p["reporta_a"]}[{p["reporta_a"]}] --> {p["id"]}')
            if p.get("reporte_funcional_a") in by: g.append(f'  {p["id"]} -.funcional.-> {p["reporte_funcional_a"]}')
        # tramo de control
        tc = {}
        for p in pos: tc[p.get("reporta_a")] = tc.get(p.get("reporta_a"), 0) + 1
        alertas = [f"{by[k]['puesto']}: {v} reportes directos" for k, v in tc.items() if k in by and v > 9]
        if alertas: g.append("  %% Alerta tramo de control: " + "; ".join(alertas))
    else:  # operativo: agrupar por sede, mostrar rol operativo
        sedes = {}
        for p in pos: sedes.setdefault(p.get("sede") or "Sin sede", []).append(p)
        for s, ps in sedes.items():
            g.append(f'  subgraph S_{abs(hash(s))%10000}["{s}"]')
            for p in ps:
                rol = p.get("rol_operativo") or p["puesto"]
                g.append(f'    {p["id"]}["{p["puesto"]}<br/><i>{rol}</i>"]')
            g.append("  end")
        for p in pos:
            if p.get("reporta_a") in by: g.append(f'  {p["reporta_a"]} --> {p["id"]}')
            if p.get("reporte_funcional_a") in by: g.append(f'  {p["id"]} -.coordina.-> {p["reporte_funcional_a"]}')
    g.append("```")
    # validaciones
    errores = []
    for p in pos:
        if p.get("reporta_a") and p["reporta_a"] not in by and p["reporta_a"] != "JUNTA":
            errores.append(f'{p["id"]} reporta a "{p["reporta_a"]}" que no existe en la tabla')
    print(f"## Organigrama {a.vista}\n" + "\n".join(g))
    if errores: print("\n**Validación:**\n- " + "\n- ".join(errores))

# ---------------------------------------------------------------- CLI
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    c = sp.add_parser("cpm"); c.add_argument("--csv", required=True); c.add_argument("--inicio"); c.add_argument("--xlsx")
    c.add_argument("--montecarlo", type=int, default=0); c.add_argument("--json", action="store_true"); c.set_defaults(f=cmd_cpm)
    e = sp.add_parser("evm")
    for k in ("bac", "pv", "ev", "ac"): e.add_argument(f"--{k}", type=float, required=True)
    e.add_argument("--json", action="store_true"); e.set_defaults(f=cmd_evm)
    w = sp.add_parser("wsjf"); w.add_argument("--csv", required=True); w.set_defaults(f=cmd_wsjf)
    r = sp.add_parser("rice"); r.add_argument("--csv", required=True); r.set_defaults(f=cmd_rice)
    h = sp.add_parser("ahp"); h.add_argument("--criterios", required=True); h.add_argument("--proyectos"); h.set_defaults(f=cmd_ahp)
    o = sp.add_parser("org"); o.add_argument("--csv", required=True)
    o.add_argument("--vista", choices=["corporativo", "funcional", "operativo"], default="funcional"); o.set_defaults(f=cmd_org)
    a = ap.parse_args(); a.f(a)

if __name__ == "__main__":
    main()
