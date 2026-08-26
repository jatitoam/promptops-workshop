/**
 * RAG "sin base de datos vectorial": el índice completo (texto + vector por
 * chunk) vive en `data/policy-index.json`, se carga una vez en memoria, y la
 * búsqueda es coseno + top-k en un array. Nada de infraestructura extra.
 *
 * Objetivo pedagógico del taller (bloque 3): esto se muestra en pantalla
 * como prueba de que un "vector store" cabe en unas pocas líneas legibles.
 */

import { readFileSync, existsSync } from "node:fs";
import { embed } from "ai";
import { google } from "@ai-sdk/google";

const INDEX_PATH = "data/policy-index.json";
const EMBEDDING_MODEL = "gemini-embedding-001";
const OUTPUT_DIMENSIONALITY = 768;

interface IndexedChunk {
  text: string;
  source: string;
  vector: number[];
}

interface PolicyIndex {
  model: string;
  dimensions: number;
  generatedAt: string;
  chunks: IndexedChunk[];
}

export interface RetrievedChunk {
  text: string;
  similarity: number;
  source: string;
}

// Carga perezosa y cacheada: el índice se lee del disco una sola vez.
let cachedIndex: PolicyIndex | undefined;

function loadIndex(): PolicyIndex {
  if (cachedIndex) return cachedIndex;

  if (!existsSync(INDEX_PATH)) {
    throw new Error(
      `No existe \`${INDEX_PATH}\` → corre \`npm run seed:index\` para generarlo.`,
    );
  }

  const index = JSON.parse(readFileSync(INDEX_PATH, "utf-8")) as PolicyIndex;
  if (!index.chunks?.length) {
    throw new Error(
      `\`${INDEX_PATH}\` existe pero no contiene chunks → corre \`npm run seed:index\` de nuevo.`,
    );
  }

  cachedIndex = index;
  return index;
}

// Similitud coseno entre dos vectores de igual dimensión.
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Recupera los `k` chunks de política más similares a `query`, ordenados
 * de mayor a menor similitud coseno.
 */
export async function retrieve(query: string, k = 4): Promise<RetrievedChunk[]> {
  const index = loadIndex();

  // El timeout no es paranoia: la API de Gemini en capa gratuita se cuelga de
  // forma intermitente sin devolver error (medido: 2 de cada 6 peticiones).
  // Sin límite, el bloque 3 se congela sin explicación. Ver `GOTCHAS.md` G-16.
  const { embedding } = await embed({
    model: google.textEmbeddingModel(EMBEDDING_MODEL),
    value: query,
    providerOptions: {
      google: {
        outputDimensionality: OUTPUT_DIMENSIONALITY,
        taskType: "RETRIEVAL_QUERY",
      },
    },
    abortSignal: AbortSignal.timeout(20_000),
    maxRetries: 2,
  });

  if (embedding.length !== index.dimensions) {
    throw new Error(
      `La consulta se embebió con ${embedding.length} dimensiones pero el índice tiene ` +
        `${index.dimensions} (modelo del índice: \`${index.model}\`). La similitud no es ` +
        "comparable → regenera el índice con `npm run seed:index` o revisa `outputDimensionality`.",
    );
  }

  return index.chunks
    .map((chunk) => ({
      text: chunk.text,
      source: chunk.source,
      similarity: Math.round(cosineSimilarity(embedding, chunk.vector) * 10_000) / 10_000,
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
}
