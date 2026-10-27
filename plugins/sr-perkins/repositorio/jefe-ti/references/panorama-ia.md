# Panorama de IA — americana, oriental y abierta

> **Foto fechada: 23 de octubre de 2026.** Este sector cambia cada semana. Antes de afirmar versión, precio, licencia o disponibilidad, verifica en la web (fuente primaria: blog/docs del laboratorio). Usa esta foto para saber *qué buscar* y *cómo comparar*, no como verdad vigente.

## 1. Mapa de laboratorios (oct 2026)

### Laboratorios americanos (cerrados, vía API y nube)
| Laboratorio | Línea vigente | Rasgo distintivo | Dónde se consume |
|---|---|---|---|
| **Anthropic** | Claude Fable 5.1 / Mythos 5.1 (tope, sep 2026), Opus 5.5, Sonnet 5.5, Haiku 5.5 (oct 2026) | Agentes, código, trabajo largo con herramientas; MCP; fuerte en seguridad y cumplimiento | API directa, Amazon Bedrock, Google Vertex AI, Microsoft Foundry |
| **OpenAI** | GPT-6 Astra (tope), GPT-6 Sol / Luna (niveles de costo), línea Codex | Ecosistema ChatGPT, Codex, voz/visión, contexto 1M | API, Azure OpenAI (relevante para tenant M365) |
| **Google DeepMind** | Gemini 4 Argon (sep/oct 2026), Gemini 3.8 Flash, Flash-Lite; Gemma 4 (abierto) | Multimodal nativo, contexto largo, precio/eficiencia en Flash | Vertex AI, AI Studio, Workspace |
| **xAI** | Grok 4.7 (sep 2026), 4.3 con 1M | Datos en tiempo real de X, agentes | API xAI |
| **Meta** | Muse Spark 1.x y Muse Wonder (oct 2026, cerrados); Llama (abiertos, generaciones anteriores) | Giró a modelos cerrados en 2026; Llama sigue siendo base abierta común | Meta Model API, Llama vía Hugging Face |
| **Microsoft** | Copilot (M365), Phi (pequeños abiertos), MAI | Integración con el tenant: Copilot para M365, Copilot Studio para agentes, Foundry para APIs de terceros | M365, Azure |
| **Amazon** | Nova; Bedrock como marketplace | Bedrock agrega Anthropic, Meta, Mistral y otros bajo un contrato AWS | AWS |
| **Mistral (Europa)** | Mistral Large 4, Codestral, modelos abiertos Apache 2.0 | Opción europea para soberanía; abiertos de calidad | API, self-host |

### Laboratorios orientales (China; la mayoría con pesos abiertos)
| Laboratorio | Línea vigente | Licencia | Rasgo distintivo |
|---|---|---|---|
| **DeepSeek** (深度求索) | V4.1 Flash (sep/oct 2026), V4 Pro | MIT | Mejor relación costo/calidad; razonamiento y código; API muy barata (precio pico/valle) |
| **Alibaba — Qwen** | Qwen3.8 Max (pesos texto abiertos ago 2026, licencia propia), Qwen3.8 Flash; familia pequeña Apache 2.0 | Apache 2.0 (pequeños) / propia (Max) | Multilingüe, multimodal, mejor para fine-tuning y despliegue local por tamaños |
| **Moonshot — Kimi** | Kimi K3 (jul 2026, 2.8T MoE, 1M contexto) | Kimi K3 License (umbrales comerciales) | Agentes de larga duración, frontend; el abierto más grande |
| **Zhipu / Z.ai — GLM** | GLM-5.3, GLM-5.3-Flash | MIT (5.2/5.3-Flash) | Código en repositorios, terminal, detección de vulnerabilidades |
| **MiniMax** | M3 / M3.1 Flash | MiniMax Community (condiciones) | Contexto 1M a muy bajo costo, tool-calling |
| **ByteDance** (Doubao/Seed), **Tencent** (Hunyuan Hy4), **Baidu** (ERNIE), **Xiaomi** (MiMo), **StepFun** (Step 5) | Varios | Mixto | Relevantes en consumo chino y pesos abiertos puntuales |
| **Japón/Corea** | Sakana, Rakuten AI, NAVER HyperCLOVA, LG EXAONE | Mixto | Nichos regionales; poco relevantes para LATAM salvo investigación |

## 2. Cómo elegir (árbol de decisión)

1. **¿Los datos incluyen información de pacientes (PHI) o datos personales?**
   - Sí → sólo proveedores con contrato de tratamiento de datos (DPA), región definida, sin entrenamiento con nuestros datos, y preferentemente vía nube ya contratada (Azure OpenAI / Foundry por el tenant M365, Bedrock, Vertex) **o** modelo abierto on-premise. Anonimizar/seudonimizar antes cuando sea posible. Ver §5.
   - No → cualquier API según calidad/costo.
2. **¿Necesita lo mejor en razonamiento/agentes largos?** → Fable/Mythos, GPT-6 Astra, Gemini 4. Caro; úsalo para pasos críticos, no para todo.
3. **¿Volumen alto, tareas acotadas (clasificar, extraer, resumir, chat de soporte)?** → Haiku 5.5, GPT-6 Luna, Gemini Flash-Lite, o abiertos (DeepSeek Flash, Qwen Flash, GLM Flash) en API o local.
4. **¿Debe correr sin internet, en el datacenter, o con soberanía total?** → abiertos: Qwen (tamaños 7B–235B+), DeepSeek V4 Flash, GLM-5.3-Flash, Gemma 4, Llama, Mistral. Servir con **vLLM** (producción, GPU) u **Ollama** (pruebas, escritorio). Dimensionar: ~2 bytes/parámetro en FP16, ~0.6 en Q4; un 70B en Q4 pide ~40–48 GB de VRAM.
5. **¿Fine-tuning?** Casi nunca es la respuesta primera: RAG + prompts + herramientas resuelven el 90 %. Fine-tuning (LoRA) sólo para formato/estilo muy repetitivo o dominio cerrado con datos abundantes.

Criterios de comparación (siempre en la tabla de recomendación): calidad en la tarea (probar con 20–50 casos reales propios, no sólo benchmarks), costo por millón de tokens entrada/salida y **costo por tarea**, latencia, contexto, multimodalidad, tool-calling/estructura (JSON), región y DPA, licencia, lock-in, madurez del SDK.

## 3. Patrones de construcción

- **RAG**: chunking semántico, embeddings (OpenAI, Voyage, Cohere, BGE/Qwen-embedding para local), índice vectorial (pgvector en PostgreSQL es suficiente para la mayoría; Azure AI Search, Qdrant, Milvus si escala), re-ranking, citas obligatorias. Medir: precisión de recuperación, fidelidad, alucinación.
- **Agentes**: herramientas vía **MCP** (Model Context Protocol, estándar de facto 2025–26), límites de pasos y presupuesto, humano en el bucle para acciones irreversibles, registro completo (trazas). Frameworks: SDKs nativos (Anthropic Agent SDK, OpenAI Agents), LangGraph, Semantic Kernel/Copilot Studio en entorno Microsoft, n8n para orquestación ligera.
- **Salida estructurada**: JSON Schema / tool-calling en lugar de parsear texto.
- **Evaluación**: conjunto de pruebas propio versionado; evaluación automática (LLM-as-judge con rúbrica) + muestreo humano; regresión al cambiar modelo o prompt.
- **Guardrails**: filtros de entrada/salida, detección de PHI, límites de tema, bloqueo de instrucciones en documentos (prompt injection), rate limits por usuario.
- **Costos**: caché de prompts, modelos pequeños para enrutamiento, batch API para lotes nocturnos, límites por aplicación con alertas.
- **Observabilidad**: trazas por llamada (modelo, tokens, latencia, costo, usuario, resultado), dashboards de uso.

## 4. IA en el hospital — casos con sentido y su modelo típico

| Caso | Riesgo | Modelo/arquitectura sugerida |
|---|---|---|
| Resumen de expediente / nota de alta borrador | Alto (PHI, seguridad clínica) | Modelo frontera vía nube con DPA o abierto on-prem; revisión médica obligatoria; registro |
| Codificación CIE-10/CPT asistida | Medio | RAG sobre catálogos + modelo medio; validación humana |
| Chatbot de citas/pacientes | Medio (datos personales) | Modelo económico + herramientas al HIS/Odoo; sin acceso a datos clínicos sin autenticación |
| Clasificación de correos/tickets de TI | Bajo | Haiku/Flash/abierto pequeño |
| Transcripción de consulta (ambient scribe) | Alto | Proveedores especializados con DPA o pipeline propio (Whisper/local + LLM); consentimiento |
| Asistente de código para el equipo | Bajo–medio (propiedad intelectual) | Claude Code / Copilot / Codex con política de no subir secretos |
| Análisis de BI en lenguaje natural | Medio | Modelo con tool-calling sobre vistas agregadas, nunca sobre tablas con PHI |

## 5. Datos clínicos e IA — reglas de la casa

1. Clasificar los datos antes de enviarlos: público / interno / personal / sensible (salud). Lo sensible no sale sin DPA + región + no-entrenamiento, o se anonimiza.
2. Preferir servicios dentro de contratos existentes (Azure vía tenant M365, por ejemplo) por auditoría y facturación unificadas.
3. Consentimiento y transparencia con el paciente cuando la IA interviene en su atención; el médico firma, la IA propone.
4. Registro de prompts/respuestas con identificación del usuario para trazabilidad (Ley de Deberes y Derechos de los Pacientes; Decretos 143/144).
5. Cuentas de IA personales (ChatGPT/Claude gratis con correo propio) **no** para datos de la empresa: política escrita y Copilot/licencia corporativa como alternativa.

## 6. Entregables de este dominio

- **Comparativa de modelos**: tabla con criterios de §2, costo por tarea estimado, recomendación, riesgos, siguiente paso (prueba piloto de N casos).
- **Diseño de solución IA**: diagrama (fuentes → ingesta → índice → modelo → herramientas → salida → registro), componentes, costos mensuales estimados, controles de §5.
- **Política de uso de IA**: alcance, clasificación de datos, herramientas permitidas, prohibiciones, responsabilidades, sanciones, revisión.
- **Especificación de evaluación**: casos, rúbrica, umbrales de aceptación.
