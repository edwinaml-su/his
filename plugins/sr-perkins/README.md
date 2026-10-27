# Sr. Perkins

Superagente ejecutivo de Inversiones Avante, por encima de @Orq. Orquesta
lentes de especialistas intercambiables, recuerda lo aprendido en su base de
conocimiento y entrega mandatos técnicos a @Orq (`/director`).

## Instalar (Claude Code)

```
/plugin install sr-perkins --marketplace edwinaml-su/his
```

En versiones anteriores: `/plugin marketplace add edwinaml-su/his` y luego
`/plugin install sr-perkins@avante`.

## Estructura

| Ruta | Qué es |
| :--- | :--- |
| `skills/sr-perkins/` | Núcleo: persona, orquestación de lentes, lente Arquitectura/CTO, mandatos a @Orq |
| `skills/perkins-aprender/` | Núcleo: registrar, corregir u olvidar conocimiento |
| `skills/perkins-skills/` | Núcleo: poner/retirar lentes, perfiles, agregar skills |
| `repositorio/` | Las 11 skills de lentes (no se cargan solas; las activa el registro) |
| `conocimiento/` | Base de conocimiento; `registro-skills.md` decide qué lentes están activos |

Las actualizaciones de la base de conocimiento y del registro se hacen sobre
esta carpeta en el repo HIS y se commitean. Nunca datos de pacientes ni
credenciales.
