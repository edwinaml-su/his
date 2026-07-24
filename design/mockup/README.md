# design/mockup/ — Fuente de verdad visual

Esta carpeta recibe el **mockup HTML/CSS entregado** que sirve como única
fuente de verdad visual del proyecto (ver `CLAUDE.md § Fidelidad de diseño`).

## Qué va aquí

```
design/mockup/
  index.html          # páginas del mockup (una por pantalla)
  <pantalla>.html
  styles.css          # hojas de estilo del mockup
  assets/             # imágenes, íconos, logos del mockup
```

## Flujo al depositar un mockup nuevo o actualizado

1. Copiar aquí los `.html`, `.css` y `assets/` tal cual fueron entregados
   (sin "limpiarlos" ni reformatearlos — son la referencia exacta).
2. Pedir en la siguiente sesión de Claude Code:
   > "lee el mockup en `design/mockup/` y llena `docs/DESIGN-SPEC.md` con los tokens exactos"
3. Los tokens se materializan en `apps/web/tailwind.config.ts` y
   `packages/ui/src/styles/globals.css` en el mismo commit que actualiza
   `docs/DESIGN-SPEC.md`.
4. Solo después se maquetan/ajustan los componentes React.

**Estado actual:** ⬜ pendiente de recibir el mockup (carpeta creada 2026-07-24).
