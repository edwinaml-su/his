# Registro de horas — Edwin Martínez · Proyecto HIS Multipaís

> Documento de soporte para reporte/facturación de horas. **Estimación** derivada
> del historial de Git (no es un registro de marcaje). Generado el 2026-06-02.

## 1. Metodología

Las horas se estiman a partir de los *timestamps* de los **593 commits** del
repositorio (todas las ramas), agrupados en **sesiones de trabajo**:

- Dos commits separados por **≤ 2 horas** se consideran la misma sesión (así el
  tiempo de espera de CI, de los agentes y de revisión queda **contado dentro**
  de la sesión, según el criterio acordado: para el ser humano la espera también
  es trabajo).
- A cada sesión se le suma **30 min** de plomo (trabajo previo al primer commit:
  redacción de instrucciones, análisis, preparación).
- Horas por día = Σ (último − primer commit de cada sesión + 30 min).

Es una estimación **conservadora**: Git no captura el tiempo *posterior* al
último commit (esperar el despliegue final, UAT en el navegador, validación
visual), por lo que el número real es probablemente **algo mayor**.

## 2. Marco temporal

| Indicador | Valor |
|---|---|
| Primer commit | 2026-04-30 |
| Último commit | 2026-06-02 |
| Span natural | 33 días |
| Días con actividad | 26 |
| Commits totales | 593 |
| Sesiones de trabajo | 55 |
| Promedio por día activo | ~4.9 h |

## 3. Resumen ejecutivo

- **Total estimado (método de sesiones, gap 2 h): ~127 h.**
- **Rango razonable según cómo se cuente la espera: ~118 h – ~190 h.**
  - gap 90 min → ~118 h (solo esperas cortas)
  - gap 2 h → ~127 h (esperas medias) ← *cifra de referencia*
  - gap 3 h → ~158 h (esperas largas de CI/agentes)
  - presencia intradía completa (1.er→último commit del día) → ~217 h (cota alta)

## 4. Detalle día por día (método de referencia, gap 2 h)

| Fecha | Commits | Sesiones | Horas |
|---|--:|--:|--:|
| 2026-04-30 | 8 | 1 | 1.4 |
| 2026-05-02 | 5 | 2 | 2.6 |
| 2026-05-04 | 9 | 3 | 5.0 |
| 2026-05-05 | 1 | 1 | 0.5 |
| 2026-05-06 | 4 | 2 | 1.3 |
| 2026-05-07 | 2 | 2 | 1.0 |
| 2026-05-08 | 5 | 1 | 1.1 |
| 2026-05-12 | 17 | 3 | 3.5 |
| 2026-05-13 | 52 | 2 | 7.6 |
| 2026-05-14 | 3 | 1 | 1.9 |
| 2026-05-15 | 10 | 1 | 4.0 |
| 2026-05-16 | 29 | 1 | 11.4 |
| 2026-05-17 | 11 | 4 | 6.4 |
| 2026-05-18 | 24 | 4 | 10.0 |
| 2026-05-19 | 47 | 2 | 4.9 |
| 2026-05-22 | 8 | 1 | 2.7 |
| 2026-05-24 | 43 | 1 | 7.8 |
| 2026-05-25 | 12 | 2 | 4.3 |
| 2026-05-26 | 22 | 3 | 6.5 |
| 2026-05-27 | 17 | 4 | 5.9 |
| 2026-05-28 | 38 | 1 | 8.7 |
| 2026-05-29 | 69 | 1 | 9.6 |
| 2026-05-30 | 98 | 1 | 4.5 |
| 2026-05-31 | 14 | 4 | 2.3 |
| 2026-06-01 | 19 | 6 | 6.3 |
| 2026-06-02 | 26 | 1 | 6.2 |
| **TOTAL** | **593** | **55** | **127.4** |

> Datos en crudo (para hoja de cálculo / facturación): `registro_horas_edwin.csv`.

## 5. Salvedades

1. Es una **estimación** basada en Git, no un marcaje real.
2. **No incluye** el tiempo posterior al último commit de cada sesión
   (despliegue, UAT manual, validación en navegador) → el real puede ser mayor.
3. Buena parte del esfuerzo bruto lo ejecutaron agentes automatizados; el rol de
   Edwin fue **dirigir, esperar y validar** — tiempo que aquí **sí** se contabiliza.
4. Para regenerar: ver el método en §1 sobre `git log --all --pretty=%at`.
