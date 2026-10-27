# Registro de skills de Sr. Perkins

Este archivo decide **qué sabe hacer Perkins hoy**. El orquestador lo lee al inicio de cada sesión y carga únicamente las skills de la sección "Activas" desde `repositorio/<nombre>/` del plugin. Cambiar este archivo basta para poner o retirar una skill; no hay que reinstalar el plugin.

## Núcleo (siempre cargado, no se retira)

- sr-perkins — persona, orquestación de lentes, base de conocimiento, lente de arquitectura/CTO.
- perkins-aprender — registrar, corregir u olvidar conocimiento.
- perkins-skills — poner, retirar, listar skills; cambiar de perfil; agregar skills al repositorio.

## Activas

Perfil vigente: **todo** (repositorio completo)

- gerente-medico-bi-gestion — desde 2026-10-19 — lente Médica-gerencial
- abogado-notario-el-salvador — desde 2026-10-19 — lente Legal
- jefe-ti — desde 2026-10-27 — lente Tecnológica
- medico-internista-integral — desde 2026-10-27 — lente Clínica
- medico-internista-evaluador-his — desde 2026-10-27 — lente Clínico-tecnológica
- mercadeo-millennial-avante — desde 2026-10-27 — lente Mercadeo
- gerente-comercial-avante — desde 2026-10-27 — lente Comercial
- asistente-ejecutiva-tatiana — desde 2026-10-27 — lente Ejecutiva
- organizador-trabajo-m365 — desde 2026-10-27 — lente Ejecutiva
- gerente-proyectos-avante — desde 2026-10-27 — lente Proyectos
- gerente-operaciones-avante — desde 2026-10-27 — lente Operaciones

## Perfiles

Formato: `nombre: skill1, skill2`. El perfil "direccion" es el que Perkins asume si nadie indica otro.

- direccion: gerente-medico-bi-gestion, abogado-notario-el-salvador
- ti: jefe-ti
- comercial-mercadeo: gerente-comercial-avante, mercadeo-millennial-avante
- clinico: medico-internista-integral, gerente-medico-bi-gestion
- his: medico-internista-evaluador-his, jefe-ti
- gabinete: asistente-ejecutiva-tatiana, organizador-trabajo-m365
- proyectos: gerente-proyectos-avante, jefe-ti
- operaciones: gerente-operaciones-avante, jefe-ti
- todo: gerente-medico-bi-gestion, abogado-notario-el-salvador, jefe-ti, medico-internista-integral, medico-internista-evaluador-his, mercadeo-millennial-avante, gerente-comercial-avante, asistente-ejecutiva-tatiana, organizador-trabajo-m365, gerente-proyectos-avante, gerente-operaciones-avante

## Disponibles en el repositorio (inactivas)

Ver `repositorio/catalogo.md` del plugin para la descripción completa.

- (ninguna: todo el repositorio está activo)

## Historial de cambios

- 2026-10-19 [usuario] creación del plugin con gerente-medico-bi-gestion y abogado-notario-el-salvador integradas.
- 2026-10-23 [usuario] Perkins pasa a ser repositorio de skills intercambiables: las dos skills originales se vuelven módulos activables y entran siete más al repositorio (jefe-ti, internista integral, internista evaluador HIS, mercadeo, comercial, Tatiana, organizador M365).
- 2026-10-23 [usuario] entra gerente-proyectos-avante (PMO) al repositorio; perfil `proyectos`.
- 2026-10-24 [usuario] entra gerente-operaciones-avante (Gerente de Operaciones, lidera la cadena de suministro con GS1 y gestiona con 4DX) al repositorio; perfil `operaciones`.
- 2026-10-27 [usuario] se activa todo el repositorio (11 skills); nuevo perfil `todo`.
