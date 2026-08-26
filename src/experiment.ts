/**
 * Experimento de 3 variantes — tarea 2.6, bloque 8 del taller.
 *
 * Corre las 3 variantes de prompt (v1-terse, v2-empathetic, v3-compliant)
 * contra el dataset `support_failure_seeds` (12 casos) y deja las 3 corridas
 * como entradas comparables en Langfuse (Datasets → support_failure_seeds →
 * Runs). El juez (`support_quality_judge`, tarea 2.4) las puntúa de forma
 * asíncrona después — este script solo genera las trazas.
 *
 * Puerto del `run_experiment.py` de referencia
 * (`promptops-demo/demo/experiment/run_experiment.py`) al SDK de Langfuse
 * JS v5, que expone `dataset.runExperiment()` en vez del `run_experiment()`
 * de nivel de cliente que usa la versión Python.
 *
 * Uso:
 *   npm run experiment                                    # las 3 variantes, los 12 casos
 *   npm run experiment -- --limit 2                        # los primeros 2 casos de cada variante
 *   npm run experiment -- --variant v2-empathetic           # solo esa variante, los 12 casos
 *   npm run experiment -- --variant v2-empathetic --limit 1 # una sola llamada
 */

import { loadEnv } from "./env.ts";
loadEnv();

import { LangfuseClient } from "@langfuse/client";

import { initTelemetry, shutdownTelemetry } from "./telemetry.ts";
import { answerUser } from "./agent.ts";
import type { PromptLabel } from "./prompts.ts";

const DATASET_NAME = "support_failure_seeds";
const ALL_VARIANTS: PromptLabel[] = ["v1-terse", "v2-empathetic", "v3-compliant"];

/**
 * Pausa entre casos, en ms. Configurable con `EXPERIMENT_PACE_MS` en el
 * `.env` — existe porque el juez en Groq tiene 8.000 tokens/minuto y cada
 * evaluación gasta ~2,3k, es decir ~3 evaluaciones por minuto. Si las 36
 * trazas llegan de golpe, el juez se estrangula. 15 s de pausa deja margen
 * cómodo (4 casos/minuto) sin alargar demasiado la demo.
 */
const PACE_MS = Number(process.env.EXPERIMENT_PACE_MS?.trim() || 15_000);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Args {
  limit?: number;
  variant?: PromptLabel;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--limit") {
      const raw = argv[++i];
      const n = Number(raw);
      if (!raw || !Number.isFinite(n) || n <= 0) {
        throw new Error(`--limit necesita un número entero positivo, recibí: ${raw ?? "(nada)"}`);
      }
      args.limit = Math.floor(n);
    } else if (arg === "--variant") {
      const raw = argv[++i];
      if (!ALL_VARIANTS.includes(raw as PromptLabel)) {
        throw new Error(
          `--variant desconocida: "${raw ?? "(nada)"}" → usa una de: ${ALL_VARIANTS.join(", ")}`,
        );
      }
      args.variant = raw as PromptLabel;
    } else {
      throw new Error(`Argumento no reconocido: "${arg}" → usa --limit <n> y/o --variant <etiqueta>.`);
    }
  }
  return args;
}

/** Traduce errores comunes de la API de Langfuse/dataset a mensajes accionables. */
function toActionableError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (!process.env.LANGFUSE_PUBLIC_KEY?.trim() || !process.env.LANGFUSE_SECRET_KEY?.trim()) {
    return new Error(
      "Faltan LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY en `.env` → el experimento necesita " +
        "instrumentación activa para que el juez tenga algo que puntuar. Copia las keys de tu " +
        "proyecto de Langfuse Cloud (Settings → API Keys).",
    );
  }
  if (lower.includes("404") || lower.includes("not found")) {
    return new Error(
      `No se encontró el dataset "${DATASET_NAME}" en Langfuse → corre primero ` +
        "`npm run seed:dataset` (bloque 3 del taller).",
    );
  }
  if (lower.includes("401") || lower.includes("403") || lower.includes("invalid credentials")) {
    return new Error(
      "Langfuse rechazó las credenciales (401/403) → revisa LANGFUSE_PUBLIC_KEY, " +
        "LANGFUSE_SECRET_KEY y LANGFUSE_BASE_URL en tu `.env`.",
    );
  }
  if (lower.includes("429") || lower.includes("quota") || lower.includes("rate limit")) {
    return new Error(
      `Se excedió una cuota o límite de tasa (429) → para, no reintentes en bucle. Detalle: ${message}`,
    );
  }
  return new Error(`Falló el experimento: ${message}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const variants = args.variant ? [args.variant] : ALL_VARIANTS;

  const tracing = initTelemetry();
  if (!tracing) {
    console.warn(
      "⚠️  El experimento corre SIN instrumentación activa: el juez no verá ninguna traza que " +
        "puntuar. Completa LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY en `.env` antes de una " +
        "corrida real.",
    );
  }

  const langfuse = new LangfuseClient();

  try {
    const dataset = await langfuse.dataset.get(DATASET_NAME);
    if (dataset.items.length === 0) {
      throw new Error(
        `El dataset "${DATASET_NAME}" no tiene items → corre \`npm run seed:dataset\` primero.`,
      );
    }

    const total = dataset.items.length;
    const items = args.limit ? dataset.items.slice(0, args.limit) : dataset.items;
    const today = new Date().toISOString().slice(0, 10);

    console.log(
      `Corriendo ${variants.length} variante(s) contra "${DATASET_NAME}" ` +
        `(${items.length} de ${total} casos cada una)\n`,
    );

    for (const variant of variants) {
      console.log(`▶ Corriendo variante: ${variant}`);

      // `dataset.runExperiment()` (el atajo de la tarea) no acepta recortar
      // `data`: siempre corre el dataset completo. Por eso usamos
      // `langfuse.experiment.run()` directamente, que sí acepta un
      // subconjunto de `DatasetItem[]` — sigue vinculando la corrida al
      // dataset (mismo `datasetRunId`/link en la UI) porque los items siguen
      // siendo los objetos reales del dataset, solo que menos de ellos.
      let caseNumber = 0;
      const result = await langfuse.experiment.run({
        name: `support-bot-${variant}-${today}`,
        description: `Corrida del taller para ${variant} el ${today}`,
        maxConcurrency: 1,
        data: items,
        task: async ({ input }) => {
          caseNumber++;
          const n = caseNumber;
          const userMsg = (input as { user_msg: string }).user_msg;

          // Pausa antes de cada caso (menos el primero) para no ahogar al
          // juez en Groq. maxConcurrency: 1 hace que esto equivalga a una
          // pausa secuencial entre casos.
          if (n > 1) await sleep(PACE_MS);

          try {
            const { reply } = await answerUser({ userMsg, promptLabel: variant });
            console.log(`  [${variant}] caso ${n}/${items.length} → respondió (${reply.length} chars)`);
            return reply;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`  [${variant}] caso ${n}/${items.length} → FALLÓ: ${message}`);
            throw err;
          }
        },
      });

      console.log(await result.format());
      console.log();
    }

    console.log("─".repeat(60));
    console.log("Todas las corridas terminaron. Abre Langfuse:");
    console.log(`  → Datasets → ${DATASET_NAME} → pestaña Runs`);
    console.log(
      "Los puntajes del juez tardan entre 30 y 60 segundos en aparecer (más si son muchas trazas).",
    );
  } catch (err) {
    throw toActionableError(err);
  } finally {
    await shutdownTelemetry();
  }
}

main().catch((err) => {
  console.error(`\n✖ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
