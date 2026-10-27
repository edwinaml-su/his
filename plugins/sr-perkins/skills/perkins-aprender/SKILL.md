---
name: perkins-aprender
description: Núcleo de Sr. Perkins — registra, corrige u olvida conocimiento en su base de conocimiento (organización, personas, decisiones, sistemas, indicadores, normativa, marco legal, preferencias, lecciones, documentos). Usar cuando el usuario le diga a Perkins "anota", "aprende que", "recuerda", "eso está mal", "corrige", "olvida", o le entregue un documento para que lo conozca.
argument-hint: "<hecho, corrección, olvido o documento>"
---

# Perkins aprende — registrar, corregir u olvidar

**Base de conocimiento:** `plugins/sr-perkins/conocimiento/` del repo HIS
(editable, versionada). Si no estás en el repo HIS, `${CLAUDE_PLUGIN_ROOT}/conocimiento/`
es solo lectura: redacta las líneas y pide al usuario registrarlas en el repo.

## Procedimiento

1. Lee `00-indice.md` y elige el archivo destino según su tabla
   (organización, personas-roles, decisiones, sistemas-arquitectura,
   indicadores, normativa-interna, marco-legal-aplicado, preferencias-usuario,
   lecciones, `documentos/`).
2. Escribe una línea por hecho con el formato
   `- AAAA-MM-DD [fuente] hecho`.
   Fuentes: `usuario`, `documento: <nombre>`, `verificado: <sitio>`,
   `correccion`, `inferido`.
3. **Corregir:** reemplaza la línea errónea y agrega en `lecciones.md`
   `- AAAA-MM-DD [correccion] <qué estaba mal → qué es correcto>`.
4. **Olvidar:** borra la línea y deja constancia en `decisiones.md`
   (`- AAAA-MM-DD [usuario] se retira de la base: <tema>`), sin repetir el dato.
5. **Documentos:** resumen en `documentos/AAAA-MM-DD-<tema>.md` (máx. ~80
   líneas, con nombre/ruta del original) y enlázalo desde el archivo temático.
6. Antes de escribir, busca duplicados o contradicciones; si contradice algo
   registrado, pregunta cuál vale.
7. Commitea en la rama de trabajo: `docs(perkins): <qué se aprendió>`.
8. Confirma en una línea qué quedó registrado y dónde.

## Prohibido registrar

Datos de pacientes, credenciales, contraseñas, tokens, datos financieros
personales o categorías sensibles de personas. De las personas: solo nombre,
rol, área y canal laboral.
