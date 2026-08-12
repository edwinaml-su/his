# Prompt para recrear el Login AxisMed en Claude (web) — HTML puro

Copia TODO el bloque de abajo y pégalo en una conversación nueva de Claude.ai.
Adjunta también `assets/cruz-avante.png` si quieres que use el isotipo real.
El resultado será **un solo archivo `.html`** que abre con doble clic, sin servidor,
sin internet y sin dependencias (nada de React, Tailwind ni CDNs).

---

## PROMPT (copiar desde aquí)

Crea **un único archivo HTML autocontenido** (`axismed-login.html`) con la pantalla de arranque de **AxisMed by Avante**, sistema de información hospitalaria. Sin frameworks, sin CDNs, sin archivos externos: HTML + CSS + JavaScript vanilla en el mismo archivo. Debe abrir con doble clic desde el disco y funcionar offline. Usa SVG inline para todo el dibujo y los iconos.

### Reglas técnicas
- Sin librerías. La animación se hace con CSS `@keyframes` + `requestAnimationFrame` donde haga falta.
- Tipografía: **Sora**; incluye el `@font-face` embebido o usa la cadena `font-family: 'Sora', 'Segoe UI', system-ui, sans-serif` (fallback aceptable si no hay internet).
- Todo el texto es **bilingüe ES/EN** con un diccionario en JS y un selector ES|EN que cambia los textos al instante.
- Accesible: labels reales, `aria-label` en botones de icono, foco visible, targets mínimos de 44px de alto en botones.
- Comentarios mínimos, código limpio y ordenado.

### Paleta (usar exactamente estos valores)
| Uso | Color |
|---|---|
| Azul marino | `#232349` |
| Azul medio | `#1D4F9C` |
| Azul brillante | `#0C74C2` |
| Rojo acento | `#D31E26` |
| Texto oscuro | `#16204A` |
| Texto secundario | `#44506F` / `#55617F` |
| Gris azulado | `#7A88AC` |
| Borde de inputs | `#D7DFEC` |
| Divisores | `#E3E9F2` |
| Fondo de pantalla | `#DCE8F5` |
| Éxito | texto `#1E7A2E`, fondo `#EFF7EF`, borde `#BFDFC2` |

Radios: tarjeta 16px, inputs y botones 10px, modal 14px, pill de idioma 999px.
Sombra de tarjeta: `0 18px 48px rgba(22,60,58,0.24)`.
Botón primario: `linear-gradient(135deg,#1D4F9C,#0C74C2)`, texto blanco; hover `filter: brightness(1.1)`.
Foco de inputs: borde `#1D4F9C` + `box-shadow: 0 0 0 3px rgba(29,79,156,0.15)`.

### Estructura de la pantalla
Una sola pantalla de `100vh`, fondo `#DCE8F5`, con dos capas superpuestas:
1. **Animación de carga** (escenario 1280×720 escalado a la ventana, centrado, radio 18px).
2. **Tarjeta de login** (oculta hasta que la animación termina; entra con fade 0.9s + `translateY(24px→0)`).

### Animación de carga — 3 escenas, 11.9 s en total, se reproduce UNA vez y congela el último frame

**Escena 1 — Circuito (2.4 s)**
- Fondo: gradiente radial claro derivado de `#DCE8F5` + retícula de 80px muy tenue + viñeta suave.
- 8 trazas ortogonales tipo placa de circuito dentro de un `<svg width="1280" height="720">`. **Usa exactamente estas coordenadas** — cada traza es una `<polyline>` cuyos segmentos son solo horizontales o verticales (nunca diagonales), nace fuera del lienzo y termina junto al centro (640,360):

```js
const TRAZAS = [
  [[-30,150],  [290,150],  [290,330],  [560,330]],
  [[-30,560],  [230,560],  [230,395],  [560,395]],
  [[1310,170], [1010,170], [1010,325], [720,325]],
  [[1310,545], [1055,545], [1055,392], [720,392]],
  [[210,-30],  [210,235],  [612,235],  [612,285]],
  [[1075,750], [1075,480], [668,480],  [668,435]],
  [[455,750],  [455,595],  [598,595],  [598,435]],
  [[875,-30],  [875,145],  [682,145],  [682,285]],
];
```

  Reparto: 2 entran por la izquierda, 2 por la derecha, 2 desde arriba y 2 desde abajo — las 8 llegan a los cuatro lados del nodo central. Cada traza tiene exactamente 3 segmentos (2 codos).
- Estilo de la traza: `stroke="#16204A"` mezclado al 50% con el fondo (≈`#8B94AE` sobre `#DCE8F5`), `stroke-width="2.5"`, `fill="none"`.
- **Dibujado:** cada polilínea se revela con `stroke-dasharray = longitud total` y `stroke-dashoffset` de `longitud → 0`, con easeInOutCubic y retraso escalonado de `i * 0.045` (la traza 0 primero). Calcula la longitud real sumando los 3 segmentos (o con `getTotalLength()`).
- **Pads:** círculo relleno de r=3.5 (`#16204A` al 62% sobre el fondo) en **cada codo** (los 2 puntos intermedios de cada traza), y un anillo sin relleno de r=5, `stroke-width="2"`, en el **punto de origen** de cada traza. Ambos aparecen con la misma opacidad progresiva del trazo.
- **Pulsos:** un punto luminoso por traza (círculo r=4 `#1D4F9C` + halo r=9 del mismo color al 30% de opacidad) que viaja **a lo largo de la polilínea** (interpolando por longitud acumulada, no en línea recta) desde el origen hasta el centro, con easeInQuad y arranque escalonado (`i * 0.06`); todos convergen al final. El pulso se desvanece al aparecer y al llegar.
- Nodo central: círculo blanco de 26px con núcleo rojo `#D31E26` (62.5% del diámetro) y glow creciente.
- Cámara: zoom de 1.12 a 1.0.
- HUD inferior: etiqueta "INICIANDO SISTEMA · SYSTEM LOADING" (11px, tracking 0.18em) + porcentaje + barra de 400×3px que va de 0 a 38%.

**Escena 2 — Cruz (4 s)**
- Onda expansiva: anillo desde el centro, radio 0→560px, se desvanece.
- El circuito **permanece dibujado** (mismas trazas y coordenadas) pero baja a opacidad 0.18, y así se mantiene durante las escenas 2 y 3. Nunca se borra ni se redibuja.
- La cruz (300×300) se **ensambla desde afuera**: 12 bloques en grilla 4×4 llegan a su posición desde 120px de distancia, escala 0.55→1, con glow azul mientras entran. Primero los bloques interiores, después los brazos (retraso según distancia al centro).
  Posiciones (columna, fila, color) en la grilla 4×4:
  `(1,0) brillante · (2,0) marino · (0,1) marino · (1,1) medio · (2,1) medio · (3,1) brillante · (0,2) brillante · (1,2) medio · (2,2) medio · (3,2) marino · (1,3) marino · (2,3) brillante`
- Dos líneas blancas (4.5% del tamaño) crecen desde el centro (`scaleX`/`scaleY`) formando la retícula del logo: una vertical y una horizontal, centradas.
- El nodo central escala de 26px a 48px con easeOutBack.
- HUD: "CARGANDO MÓDULOS · LOADING MODULES", de 38% a 76%.

**Escena 3 — Marca (5.5 s)**
1. La cruz se desliza a la izquierda (−230px), sube (−118px) y escala a 0.8 (easeInOutCubic), con un halo luminoso que la acompaña.
2. Aparece el wordmark **AxisMed** (Sora 700, 100px; "Axis" en `#16204A` y "Med" en `#0C74C2`) revelado con `clip-path` de izquierda a derecha; debajo **BY AVANTE** (21px, tracking 0.42em, `#44506F`) precedido por una barra roja de 46×3px que crece.
3. La barra de carga llega a 100% ("LISTO · READY") y se desvanece.
4. **Pausa de 2 segundos** con el logo completo en pantalla.
5. Todo el conjunto (cruz + texto) escala a 0.35 y se acopla **centrado en la parte superior**, dejando espacio libre debajo.
6. Al terminar, 700 ms después aparece la tarjeta de login (la animación queda visible arriba como parte de la pantalla).

### Tarjeta de login (blanca, 430px de ancho, padding 18px/28px, centrada, a 23vh del borde superior)
**Cabecera:** título "Sistema de Información Hospitalaria" / "Hospital Information System" (15px, peso 600) a la izquierda y pill segmentada **ES | EN** a la derecha (activo: fondo `#1D4F9C` y texto blanco; inactivo: texto `#5B6B92` sobre `#EDF1F8`).

**Paso 1 — Autenticación** (columna, gap 11px):
- Campo **Usuario** (placeholder `usuario.avante` / `avante.user`).
- Campo **Contraseña** con **icono de ojo** dentro del campo, a la derecha: alterna `type="password"`/`text` y cambia a ojo tachado cuando está visible; `title`/`aria-label` bilingües ("Ver contraseña" / "Ocultar contraseña").
- Fila: checkbox **Recordarme** (izquierda) y enlace **¿Olvidó su contraseña?** (derecha, 13px, `#1D4F9C`).
- Botón primario **Ingresar al sistema** / **Enter the system**.
- Divisor con el texto **o ingrese con** / **or sign in with**.
- Botón secundario **Ingreso biométrico** / **Biometric sign-in**: borde 1.5px `#1D4F9C`, texto azul, fondo blanco, hover `#F0F5FC`, con **icono SVG de huella dactilar** (arcos concéntricos).

**Validación y feedback:**
- Si al pulsar "Ingresar al sistema" falta usuario o contraseña: mensaje rojo `#D31E26` centrado "Ingrese usuario y contraseña" / "Enter username and password".
- Si están completos: el botón muestra "✓ Acceso concedido" 900 ms y avanza al Paso 2.
- El botón biométrico muestra "✓ Huella verificada" 1.1 s y avanza al Paso 2 **sin exigir campos**.

**Modal de dispositivo seguro:** al marcar "Recordarme" se abre un modal (overlay `rgba(10,20,40,0.45)`, tarjeta blanca de 380px, radio 14px):
- Título: "Confirmar dispositivo seguro" / "Confirm trusted device".
- Texto: "Al activar «Recordarme», sus credenciales se recordarán en este equipo. ¿Confirma que este es un dispositivo seguro y de uso personal?"
- Botones: **Cancelar** (secundario, desmarca el checkbox) y **Sí, es seguro** (primario, lo deja marcado).

**Paso 2 — Selección de sede** (reemplaza el formulario; solo aparece tras un acceso efectivo):
- Banner verde de éxito: "✓ Acceso concedido — seleccione su sede" / "Access granted — select your site".
- Select **Sede** / **Site**, placeholder "Seleccione la sede" / "Select a site", con estas 4 opciones exactas:
  1. `AVANTE Masferrer - Hospital Especializado`
  2. `AVANTE Beethoven - Centro Medico Especializado`
  3. `AVANTE Surf City - Unidad Médica Satelital`
  4. `AVANTE Colonia Médica - Hospital Especializado`
- Botón primario **Ingresar a la sede** / **Enter site**: deshabilitado y al 50% de opacidad hasta elegir una sede; al pulsarlo muestra "✓ Ingresando…".
- Enlace de texto **← Volver al inicio de sesión** / **← Back to sign in** que regresa al Paso 1 y limpia la sede.

**Pie:** "© 2026 Avante · AxisMed" (11px, `#7A88AC`, centrado).

### Estado a manejar en JS
`lang` ('es'|'en'), `step` ('auth'|'sede'), `showLogin`, `user`, `pass`, `showPass`, `remember`, `secModal`, `sede`, `error`, y los mensajes temporales de confirmación. Cambiar de idioma no debe perder lo escrito ni el paso actual.

### Detalles finales
- La animación arranca sola al cargar y no se repite al volver a la pestaña.
- Añade un botón discreto **"Reiniciar animación"** en una esquina para poder demostrarla varias veces (útil en presentaciones).
- Todo debe verse completo sin scroll en una pantalla de 1366×768.
- Entrégame el archivo listo para descargar.

## FIN DEL PROMPT

---

### Notas de uso
- Si Claude web entrega el HTML en un artifact, usa el botón de descarga y ábrelo con doble clic.
- Si algo del ritmo no te convence, pídele ajustes por escena: *"la escena 2 debe durar 3 s"*, *"el logo debe quedarse 3 s"*, etc.
- Para añadir pantallas posteriores (dashboard, selección de módulo), pídeselas en un segundo turno indicando que reutilice la misma paleta y tipografía.
