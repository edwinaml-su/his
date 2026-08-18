# Handoff: AxisMed — Loading video + Login (Sistema de Información Hospitalaria)

## Overview
Mockup de la pantalla de arranque de **AxisMed by Avante**: un video de carga animado (la cruz AVANTE "nace" de una placa de circuito, se ensambla, presenta la marca y se acopla arriba) que al terminar da paso a un **login bilingüe (ES/EN)** de dos pasos: autenticación (usuario+contraseña o biométrico) y selección de sede. Pensado como presentación a nivel C y como splash de entrada al HIS.

## Sobre los archivos de diseño
Los archivos de este paquete son **referencias de diseño creadas en HTML** — prototipos que muestran el aspecto y comportamiento deseado, NO código de producción para copiar tal cual. La tarea es **recrear estos diseños en el entorno del codebase destino** (React, Vue, Angular, etc.) usando sus patrones y librerías existentes; si aún no existe un entorno, elegir el framework más apropiado (se recomienda React) e implementarlos ahí. `AxisMed Loading.dc.html` usa un runtime propietario (`support.js`) y un motor de animación (`animations-v2.jsx`) que NO deben portarse: reimplementar la animación con la herramienta nativa del stack (Framer Motion, GSAP, CSS keyframes + rAF, Lottie, etc.).

## Fidelidad
**Alta fidelidad (hifi)**: colores, tipografía, espaciados, tiempos de animación y microinteracciones son finales. Recrear píxel-a-píxel.

## Design Tokens
- Colores de marca (tomados del isotipo `cruz-avante.png`):
  - Azul marino `#232349` · Azul medio `#1D4F9C` · Azul brillante `#0C74C2` · Rojo `#D31E26`
  - Texto oscuro `#16204A` · Texto secundario `#44506F` / `#55617F` · Gris azulado `#7A88AC`
  - Bordes de inputs `#D7DFEC` · Divisores `#E3E9F2` · Fondo de página/video `#DCE8F5` (tweakable)
  - Éxito `#1E7A2E` sobre `#EFF7EF` (borde `#BFDFC2`)
- Tipografía: **Sora** (Google Fonts), pesos 300/400/600/700.
- Radios: tarjetas 16px, inputs/botones 10px, modal 14px, pill de idioma 999px.
- Sombra de tarjeta: `0 18px 48px rgba(22,60,58,0.24)`.
- Botón primario: gradiente `linear-gradient(135deg,#1D4F9C,#0C74C2)`, texto blanco.

## Pantalla única (100vh, fondo #DCE8F5)
Dos capas absolutas superpuestas:
1. **Video** (16:9, 1280×720 lógico, centrado, radio 18px, sombra) — se reproduce al cargar.
2. **Login** (overlay, oculto hasta que el video termina; aparece con fade + translateY 24px→0, 0.9s ease).

## Video de carga — 3 escenas (total 11.9 s, se reproduce 1 vez y congela el último frame)
El fondo del video es configurable (12 opciones, oscuras y claras); todos los colores de escena derivan del fondo elegido (tema claro/oscuro automático por luminancia > 0.55).

### Escena 1 — "Circuito" (2.4 s)
- Fondo con gradiente radial derivado del color base + retícula de 80px muy tenue + viñeta.
- 8 trazas ortogonales tipo PCB (stroke 2.5px) se dibujan desde los bordes hacia el centro (stagger 0.045, easeInOutCubic), con pads circulares en los codos.
- Pulsos luminosos recorren las trazas y convergen al centro (easeInQuad, llegan todos al final).
- Nodo central: círculo blanco 26px con núcleo rojo (62.5%), glow creciente.
- Cámara: zoom 1.12 → 1.0.
- HUD inferior: barra de progreso 400×3px ("INICIANDO SISTEMA · SYSTEM LOADING", 0→38%).

### Escena 2 — "Cruz" (4 s)
- Anillo de onda expansiva desde el centro (0→560px, fade out).
- El circuito se atenúa a opacidad 0.18.
- La cruz (300×300) se ensambla: 12 bloques en grilla 4×4 (ver geometría abajo) convergen desde afuera hacia su posición (offset 120px, scale 0.55→1, glow azul mientras entran; interior primero, brazos después).
- Líneas blancas (4.5% del tamaño) crecen del centro (scaleX/scaleY) formando la retícula del logo.
- El nodo central escala de 26px a 48px (easeOutBack).
- HUD: "CARGANDO MÓDULOS · LOADING MODULES", 38→76%.

Geometría de la cruz (columna,fila,color) sobre grilla 4×4:
`(1,0,brillante) (2,0,marino) (0,1,marino) (1,1,medio) (2,1,medio) (3,1,brillante) (0,2,brillante) (1,2,medio) (2,2,medio) (3,2,marino) (1,3,marino) (2,3,brillante)` + línea blanca vertical y horizontal centradas + círculo blanco (16% del ancho) con punto rojo (10%).

### Escena 3 — "Marca" (5.5 s)
1. La cruz se desliza a la izquierda (-230px), sube (-118px) y escala a 0.8 (easeInOutCubic, halo luminoso la acompaña).
2. Wordmark **"AxisMed"** (Sora 700, 100px; "Axis" en color de título, "Med" en `#2E9BE6`/`#0C74C2` según tema) se revela con clip-path de izquierda a derecha; debajo "BY AVANTE" (21px, tracking 0.42em) con barra roja de 46×3px.
3. La barra de carga llega a 100% ("LISTO · READY") y se desvanece.
4. **Hold de 2 s** con el lockup completo.
5. Todo el lockup escala a 0.35 y se acopla centrado arriba (translate 405,-25 con origin 0 0), dejando espacio al login.
- Al llegar a p≥0.985 se dispara el evento de fin → aparece el login 700 ms después. Si el usuario rebobina, el login se oculta.

## Login (tarjeta blanca 430px, padding 18/28, centrada, top 23vh)
- **Header**: título "Sistema de Información Hospitalaria" / "Hospital Information System" (15px, 600) + pill segmentada ES|EN (activa: fondo `#1D4F9C`, texto blanco; inactiva: texto `#5B6B92` sobre `#EDF1F8`).
- **Paso 1 — Autenticación** (gap 11px):
  - Usuario (input, placeholder `usuario.avante` / `avante.user`).
  - Contraseña con **ojo** dentro del campo (SVG ojo/ojo tachado, alterna type password/text, tooltip bilingüe).
  - Fila: checkbox **Recordarme** + enlace "¿Olvidó su contraseña?" (13px, `#1D4F9C`).
  - Botón primario "Ingresar al sistema" / "Enter the system" (validación: si falta usuario o contraseña, mensaje rojo `#D31E26` "Ingrese usuario y contraseña"; si es válido, muestra "✓ Acceso concedido" 900 ms y pasa al Paso 2).
  - Divisor "o ingrese con" / "or sign in with".
  - Botón secundario **"Ingreso biométrico"** (borde 1.5px `#1D4F9C`, icono de huella SVG; muestra "✓ Huella verificada" 1.1 s y pasa al Paso 2 sin exigir campos).
- **Recordarme → modal de dispositivo seguro**: al marcar el checkbox se abre un modal (overlay `rgba(10,20,40,0.45)`, tarjeta 380px): "Confirmar dispositivo seguro" + texto explicativo; **Cancelar** (lo desmarca) / **Sí, es seguro** (lo marca).
- **Paso 2 — Selección de sede** (solo tras acceso efectivo):
  - Banner verde de éxito "Acceso concedido — seleccione su sede".
  - Select "Sede" / "Site" con placeholder "Seleccione la sede" y opciones:
    1. AVANTE Masferrer - Hospital Especializado
    2. AVANTE Beethoven - Centro Medico Especializado
    3. AVANTE Surf City - Unidad Médica Satelital
    4. AVANTE Colonia Médica - Hospital Especializado
  - Botón "Ingresar a la sede" (deshabilitado/50% opacidad hasta elegir; al hacer clic muestra "✓ Ingresando…").
  - Enlace "← Volver al inicio de sesión".
- Footer: "© 2026 Avante · AxisMed" (11px).

## Estado (state management)
`lang ('es'|'en')`, `step ('auth'|'sede')`, `showLogin`, `userVal`, `passVal`, `showPass`, `remember`, `secModal`, `sede`, `err`, flashes temporales (`flash`, `bioOk`, `sedeOk`). El fin del video dispara `showLogin=true`; rebobinar lo revierte. Todos los textos salen de un diccionario ES/EN.

## Interacciones y animaciones clave
- Video: reproducción única desde t=0 en cada carga (resetear cualquier posición persistida), congela el último frame.
- Login: fade-in 0.9s ease + slide 24px al terminar el video.
- Easings: easeInOutCubic (movimientos), easeOutBack (pop del nodo), easeOutCubic (bloques).
- Estados hover: botones primarios `brightness(1.1)`, biométrico fondo `#F0F5FC`, ojo cambia a `#1D4F9C`.
- Focus de inputs: borde `#1D4F9C` + ring `0 0 0 3px rgba(29,79,156,0.15)`.

## Assets
- `assets/cruz-avante.png` — isotipo oficial de la cruz AVANTE (PNG 7953×7953 con transparencia). En la implementación real la cruz del video se dibuja por código (12 bloques) para poder animarla; el PNG sirve de referencia de color/proporción.

## Archivos incluidos
- **`AxisMed Login (offline).html`** — ✅ mockup autocontenido: ábrelo con doble clic en cualquier navegador, funciona sin servidor ni internet. Úsalo para verificar el diseño.
- `AxisMed Loading.dc.html` — fuente de la pantalla (template + lógica del login). ⚠ No abre directo desde `file://` (el navegador bloquea los fetch por CORS); requiere un servidor local (`npx serve` o `python -m http.server` en esta carpeta).
- `axismed-scenes.jsx` — escenas de la animación (geometría de la cruz, trazas del circuito, tiempos y easings exactos).
- `assets/cruz-avante.png` — isotipo.
- (`animations-v2.jsx`, `tweaks-panel.jsx`, `support.js` — runtime del entorno de prototipado; solo referencia, no portar.)
