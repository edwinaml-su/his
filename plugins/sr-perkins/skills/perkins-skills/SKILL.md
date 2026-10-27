---
name: perkins-skills
description: Núcleo de Sr. Perkins — administra sus lentes de especialistas intercambiables: listar activas y disponibles, poner o retirar una skill, cambiar de perfil (direccion, ti, comercial-mercadeo, clinico, his, gabinete, proyectos, operaciones, todo), crear perfiles y agregar skills nuevas al repositorio. Usar cuando el usuario diga "qué skills tiene Perkins", "ponle a Perkins…", "quítale…", "perfil…", "agrega esta skill a Perkins".
argument-hint: "listar | poner <skill> | retirar <skill> | perfil <nombre> | agregar <skill>"
---

# Perkins — administración de lentes (skills)

**Archivos:**
- Registro: `conocimiento/registro-skills.md` (decide qué lentes están activos).
- Repositorio: `${CLAUDE_PLUGIN_ROOT}/repositorio/<nombre>/` + `repositorio/catalogo.md`.
- En el repo HIS, edita las copias versionadas en `plugins/sr-perkins/`.

Cambiar el registro basta para poner o retirar una skill; **no** hay que
reinstalar el plugin. El núcleo (`sr-perkins`, `perkins-aprender`,
`perkins-skills`) no se retira.

## Operaciones

| Pedido | Qué hacer |
| :--- | :--- |
| **listar** | Muestra perfil vigente, activas (con fecha y lente) y disponibles inactivas del catálogo. |
| **poner `<skill>`** | Verifica que exista `repositorio/<skill>/SKILL.md`. Muévela de "Disponibles" a "Activas" con `- <skill> — desde AAAA-MM-DD — lente <Lente>`. |
| **retirar `<skill>`** | Quítala de "Activas" y pásala a "Disponibles". No borres su carpeta. |
| **perfil `<nombre>`** | Reemplaza "Activas" por las skills del perfil y actualiza "Perfil vigente". |
| **crear perfil** | Agrega `- <nombre>: skill1, skill2` en "Perfiles". |
| **agregar `<skill>`** | Copia la skill (SKILL.md + references/ + scripts) a `repositorio/<skill>/`, agrégala a `catalogo.md` y, si el usuario lo pide, actívala. Revisa antes que no traiga credenciales ni datos de pacientes. |

Después de cada cambio:
1. Agrega una línea al "Historial de cambios" del registro:
   `- AAAA-MM-DD [usuario] <cambio>`.
2. Commitea: `chore(perkins): <cambio de lentes>`.
3. Confirma en una línea el estado resultante (perfil + activas).
