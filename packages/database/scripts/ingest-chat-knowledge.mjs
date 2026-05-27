#!/usr/bin/env node
/**
 * ingest-chat-knowledge.mjs
 *
 * RAG ingest del Avante Asistente:
 *   1. Lee docs/flujos/{CODIGO}.md (33 fichas NTEC) + docs/*.md selectos.
 *   2. Particiona en chunks ~500 palabras (idealmente ~700 tokens) cortando
 *      por encabezados markdown cuando es posible.
 *   3. Llama OpenAI text-embedding-3-small (1536 dim) en batches de 50.
 *   4. UPSERT en public.chat_knowledge_chunk con (source, chunk_index).
 *
 * Idempotente: re-corridas actualizan en lugar de duplicar.
 *
 * Requisitos:
 *   - DIRECT_URL en .env (conexión Supabase directa).
 *   - OPENAI_API_KEY en .env (sk-proj-… o sk-…).
 *
 * Uso:
 *   node --env-file=.env scripts/ingest-chat-knowledge.mjs
 *   npm run -w @his/database db:ingest:chat
 *
 * Para re-ingestar solo un archivo:
 *   node --env-file=.env scripts/ingest-chat-knowledge.mjs docs/flujos/ACT_QX.md
 */

import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");

// ─────────────────────────────────────────────────────────────────────────────
// Configuración
// ─────────────────────────────────────────────────────────────────────────────

const DIRECT_URL = process.env.DIRECT_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!DIRECT_URL) {
  console.error("ERROR: DIRECT_URL no definida.");
  process.exit(2);
}
if (!OPENAI_API_KEY) {
  console.error("ERROR: OPENAI_API_KEY no definida. Obtén una en https://platform.openai.com/api-keys");
  process.exit(2);
}

const EMBEDDING_MODEL = "text-embedding-3-small"; // 1536 dim, $0.02/MT
const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 50;
const CHUNK_WORD_TARGET = 500;
const CHUNK_WORD_OVERLAP = 60;

// Lista curada de docs a ingestar — además de docs/flujos/*.md (todos).
const EXTRA_DOCS = [
  "docs/02_arquitectura_software.md",
  "docs/03_blueprints_modulos.md",
  "docs/04_modelo_datos.md",
  "docs/05_backlog.md",
  "docs/15_production_runbook.md",
  "docs/16_capacitacion_plan.md",
  "docs/17_hipercuidado_runbook.md",
  "docs/31_flujos_operativos_consolidado.md",
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de logging
// ─────────────────────────────────────────────────────────────────────────────

function step(msg) {
  process.stdout.write(`  → ${msg} ... `);
}
function ok(detail = "") {
  console.log(`OK${detail ? " " + detail : ""}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Chunking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Particiona texto markdown en chunks. Estrategia:
 *   1. Divide por encabezados (## , ### , etc.) cuando es posible.
 *   2. Si una sección excede CHUNK_WORD_TARGET, la corta por palabras con overlap.
 *   3. Si una sección es muy corta, la concatena con la siguiente para evitar
 *      chunks de <100 palabras (pobres para embedding).
 */
function chunkMarkdown(content) {
  // Normaliza CR/LF, remueve front-matter, colapsa blanks.
  const normalized = content
    .replace(/\r\n/g, "\n")
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .trim();

  // Split por encabezados markdown (## o ###).
  const sections = [];
  const lines = normalized.split("\n");
  let currentTitle = "Introducción";
  let currentBody = [];
  for (const line of lines) {
    const headingMatch = line.match(/^#{2,4}\s+(.+)$/);
    if (headingMatch) {
      if (currentBody.length > 0) {
        sections.push({ title: currentTitle, body: currentBody.join("\n").trim() });
      }
      currentTitle = headingMatch[1].trim();
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  if (currentBody.length > 0) {
    sections.push({ title: currentTitle, body: currentBody.join("\n").trim() });
  }

  // Subdividir secciones grandes.
  const chunks = [];
  for (const s of sections) {
    const words = s.body.split(/\s+/).filter(Boolean);
    if (words.length <= CHUNK_WORD_TARGET) {
      if (words.length >= 30) {
        chunks.push({ title: s.title, body: s.body });
      }
      // Sections cortas se ignoran (probable solo títulos sin contenido).
      continue;
    }
    // Sliding window con overlap.
    let i = 0;
    let part = 1;
    while (i < words.length) {
      const slice = words.slice(i, i + CHUNK_WORD_TARGET).join(" ");
      chunks.push({ title: `${s.title} (parte ${part})`, body: slice });
      i += CHUNK_WORD_TARGET - CHUNK_WORD_OVERLAP;
      part++;
    }
  }
  return chunks;
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI embeddings
// ─────────────────────────────────────────────────────────────────────────────

async function embedBatch(texts) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI embeddings ${res.status}: ${text}`);
  }
  const json = await res.json();
  return json.data.map((d) => d.embedding);
}

// ─────────────────────────────────────────────────────────────────────────────
// Postgres
// ─────────────────────────────────────────────────────────────────────────────

const cleanUrl = DIRECT_URL
  .replace(/[?&]sslmode=[^&]*/g, "")
  .replace("?&", "?")
  .replace(/[?&]$/, "");

const client = new pg.Client({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
});

async function upsertChunk({ source, title, chunkIndex, content, embedding }) {
  // Postgres acepta vectores como string '[0.1, 0.2, ...]'.
  const embeddingStr = `[${embedding.join(",")}]`;
  await client.query(
    `
    INSERT INTO public.chat_knowledge_chunk
      (source, title, chunk_index, content, embedding, metadata, updated_at)
    VALUES ($1, $2, $3, $4, $5::vector, '{}'::jsonb, now())
    ON CONFLICT (source, chunk_index) DO UPDATE
    SET title = EXCLUDED.title,
        content = EXCLUDED.content,
        embedding = EXCLUDED.embedding,
        updated_at = now()
  `,
    [source, title, chunkIndex, content, embeddingStr],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(70));
  console.log(`Ingest knowledge → public.chat_knowledge_chunk`);
  console.log(`Model: ${EMBEDDING_MODEL} (${EMBEDDING_DIMENSIONS} dim)`);
  console.log("=".repeat(70));

  await client.connect();

  // Filter from CLI args (single-file mode).
  const argFile = process.argv[2];
  const filePaths = [];

  if (argFile) {
    filePaths.push(path.resolve(REPO_ROOT, argFile));
  } else {
    // Todas las fichas NTEC.
    const flujosDir = path.join(REPO_ROOT, "docs/flujos");
    for (const f of fs.readdirSync(flujosDir)) {
      if (f.endsWith(".md")) filePaths.push(path.join(flujosDir, f));
    }
    // Extras curados.
    for (const rel of EXTRA_DOCS) {
      const abs = path.join(REPO_ROOT, rel);
      if (fs.existsSync(abs)) filePaths.push(abs);
    }
  }

  console.log(`Archivos a procesar: ${filePaths.length}\n`);

  let totalChunks = 0;
  let totalUpserts = 0;

  for (const fp of filePaths) {
    const rel = path.relative(REPO_ROOT, fp).replace(/\\/g, "/");
    const content = fs.readFileSync(fp, "utf8");
    const chunks = chunkMarkdown(content);

    if (chunks.length === 0) {
      step(`${rel}`);
      console.log("SIN CHUNKS (archivo vacío o muy corto)");
      continue;
    }

    step(`${rel} (${chunks.length} chunks)`);

    // Embed en batches.
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const texts = batch.map((c) => `${c.title}\n\n${c.body}`);
      const embeddings = await embedBatch(texts);

      for (let j = 0; j < batch.length; j++) {
        await upsertChunk({
          source: rel,
          title: batch[j].title,
          chunkIndex: i + j,
          content: batch[j].body,
          embedding: embeddings[j],
        });
        totalUpserts++;
      }
    }

    totalChunks += chunks.length;
    ok();
  }

  console.log("");
  console.log("=".repeat(70));
  console.log("RESUMEN");
  console.log("=".repeat(70));
  console.log(`Archivos procesados : ${filePaths.length}`);
  console.log(`Chunks generados    : ${totalChunks}`);
  console.log(`Upserts en BD       : ${totalUpserts}`);

  const { rows } = await client.query(
    `SELECT count(*)::int AS total FROM public.chat_knowledge_chunk`,
  );
  console.log(`Total en tabla      : ${rows[0].total}`);
  console.log("");
  console.log("Re-indexa el ivfflat para mejor recall:");
  console.log("  REINDEX INDEX public.idx_chat_knowledge_embedding_cos;");
}

main()
  .catch((e) => {
    console.error("\nFALLÓ:", e.message);
    if (e.stack) console.error(e.stack);
    process.exit(1);
  })
  .finally(() => client.end());
