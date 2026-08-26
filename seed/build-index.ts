#!/usr/bin/env tsx
/**
 * Genera `data/policy-index.json` a partir de `policy-docs/*.md`.
 *
 * Corresponde a la tarea 1.1 del CHECKLIST de construcción del taller
 * ("RAG sin base de datos vectorial"). Solo lo corre el mantenedor del
 * taller — el índice generado se commitea al repo y los participantes
 * nunca ejecutan este script.
 *
 * Pasos: leer los .md → chunkear por párrafo → embeber cada chunk con
 * Gemini (768 dimensiones) → escribir el índice como JSON plano.
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { embedMany } from "ai";
import { google } from "@ai-sdk/google";

loadDotenv({ quiet: true });

const POLICY_DOCS_DIR = "policy-docs";
const OUTPUT_PATH = "data/policy-index.json";
const EMBEDDING_MODEL = "gemini-embedding-001";
const OUTPUT_DIMENSIONALITY = 768;
const MIN_PARAGRAPH_LENGTH = 80;
const DECIMALES_VECTOR = 6;

interface Chunk {
  text: string;
  source: string;
}

interface IndexedChunk extends Chunk {
  vector: number[];
}

interface PolicyIndex {
  model: string;
  dimensions: number;
  generatedAt: string;
  chunks: IndexedChunk[];
}

/**
 * Chunkea un documento Markdown por párrafo: separa por líneas en blanco,
 * descarta encabezados (líneas que empiezan con `#`) y descarta párrafos
 * de menos de MIN_PARAGRAPH_LENGTH caracteres (demasiado cortos para
 * aportar contexto útil a la búsqueda).
 */
function chunkMarkdown(source: string, raw: string): Chunk[] {
  return raw
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.startsWith("#"))
    .filter((p) => p.length >= MIN_PARAGRAPH_LENGTH)
    .map((text) => ({ text, source }));
}

async function main(): Promise<void> {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) {
    console.error(
      "❌ Falta GOOGLE_GENERATIVE_AI_API_KEY en `.env` → no se puede generar el índice.",
    );
    process.exit(1);
  }

  const files = readdirSync(POLICY_DOCS_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();

  if (files.length === 0) {
    console.error(`❌ No se encontraron archivos .md en \`${POLICY_DOCS_DIR}\`.`);
    process.exit(1);
  }

  const chunks: Chunk[] = [];
  for (const file of files) {
    const raw = readFileSync(join(POLICY_DOCS_DIR, file), "utf-8");
    chunks.push(...chunkMarkdown(file, raw));
  }

  if (chunks.length === 0) {
    console.error("❌ El chunkeo produjo 0 párrafos válidos → revisa policy-docs/.");
    process.exit(1);
  }

  console.log(
    `Chunkeando ${files.length} documentos → ${chunks.length} párrafos. Generando embeddings con \`${EMBEDDING_MODEL}\`...`,
  );

  const { embeddings } = await embedMany({
    model: google.textEmbeddingModel(EMBEDDING_MODEL),
    values: chunks.map((c) => c.text),
    providerOptions: {
      google: {
        outputDimensionality: OUTPUT_DIMENSIONALITY,
        taskType: "RETRIEVAL_DOCUMENT",
      },
    },
  });

  if (embeddings.length !== chunks.length) {
    console.error(
      `❌ Se esperaban ${chunks.length} vectores y se recibieron ${embeddings.length}.`,
    );
    process.exit(1);
  }

  const badVector = embeddings.find((v) => v.length !== OUTPUT_DIMENSIONALITY);
  if (badVector) {
    console.error(
      `❌ Se esperaban vectores de ${OUTPUT_DIMENSIONALITY} dimensiones, pero se recibió uno de ` +
        `${badVector.length}. Revisa que \`outputDimensionality\` se esté aplicando en la llamada a embedMany().`,
    );
    process.exit(1);
  }

  const index: PolicyIndex = {
    model: EMBEDDING_MODEL,
    dimensions: OUTPUT_DIMENSIONALITY,
    generatedAt: new Date().toISOString(),
    // Los vectores se redondean a 6 decimales. Medido: no altera el orden del
    // ranking (desviación máxima de similitud 8,5e-7, y las similitudes se
    // muestran con 4 decimales), y recorta el archivo commiteado casi a la
    // mitad. Ver `GOTCHAS.md` G-18.
    chunks: chunks.map((c, i) => ({
      ...c,
      vector: embeddings[i].map((v) => Number(v.toFixed(DECIMALES_VECTOR))),
    })),
  };

  // Sin indentar, a propósito: con `null, 2` cada uno de los ~24.500 floats
  // ocupaba su propia línea y el archivo eran 24.774 líneas que ensuciaban
  // todos los diffs. Es un artefacto generado, no se lee a mano.
  writeFileSync(OUTPUT_PATH, JSON.stringify(index));
  const sizeKb = (statSync(OUTPUT_PATH).size / 1024).toFixed(1);

  console.log(
    `✅ Índice generado: ${files.length} documentos, ${chunks.length} chunks, ` +
      `${OUTPUT_DIMENSIONALITY} dimensiones, ${sizeKb} KB → \`${OUTPUT_PATH}\`.`,
  );
}

main().catch((err) => {
  console.error(`❌ Error inesperado generando el índice: ${(err as Error).message}`);
  process.exit(1);
});
