/**
 * Tarea 2.5 del taller: sube los 12 casos de prueba a Langfuse como dataset.
 *
 * Mapea `data/dataset.json` al dataset `support_failure_seeds` en Langfuse.
 * Idempotente: correrlo dos veces no duplica ni falla.
 */

import { LangfuseClient } from "@langfuse/client";
import { loadEnv } from "../src/env.ts";
import * as fs from "fs";
import * as path from "path";

const DATASET_NAME = "support_failure_seeds";
const DATA_FILE = path.join(process.cwd(), "data", "dataset.json");

interface DatasetItem {
  input: {
    user_msg: string;
  };
  expected_output: string;
  metadata: {
    failure_mode: string | null;
    tags: string[];
    source_trace_id: string;
  };
}

async function main() {
  // 1. Cargar variables de entorno
  loadEnv();

  // Verificar que tenemos las credenciales necesarias
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();
  const baseUrl = process.env.LANGFUSE_BASE_URL?.trim();

  if (!publicKey || !secretKey || !baseUrl) {
    console.error(
      "❌ Error: Faltan credenciales de Langfuse. Configura en .env:\n" +
        "   - LANGFUSE_PUBLIC_KEY\n" +
        "   - LANGFUSE_SECRET_KEY\n" +
        "   - LANGFUSE_BASE_URL\n\n" +
        "   Obtenlas en tu proyecto de Langfuse → Settings → API Keys.",
    );
    process.exit(1);
  }

  // 2. Leer el dataset JSON
  let items: DatasetItem[];
  try {
    const rawData = fs.readFileSync(DATA_FILE, "utf-8");
    items = JSON.parse(rawData);
  } catch (error) {
    console.error(`❌ Error al leer ${DATA_FILE}:`, error);
    process.exit(1);
  }

  if (!Array.isArray(items) || items.length === 0) {
    console.error(
      `❌ Error: ${DATA_FILE} debe ser un array con al menos 1 item.`,
    );
    process.exit(1);
  }

  // 3. Crear cliente de Langfuse
  const langfuse = new LangfuseClient();

  try {
    // 4. Intentar crear el dataset (ignorar error si ya existe)
    try {
      await langfuse.api.datasets.create({
        name: DATASET_NAME,
        description:
          "12 casos de prueba para el bot de soporte de BanCentral. Uso: instrucción del taller, evaluación de variantes, y regresión.",
      });
      // `datasets.create` se comporta como upsert: devuelve 200 aunque el
      // dataset ya exista. Por eso el mensaje dice "listo" y no "creado" —
      // decir "creado" en la segunda corrida sería mentir en pantalla.
      console.log(`✓ Dataset '${DATASET_NAME}' listo.\n`);
    } catch (error: unknown) {
      const err = error as {
        status?: number;
        statusCode?: number;
        message?: string;
      };
      // Si es un error 409 (conflict) o el mensaje menciona que ya existe,
      // ignorar. En caso contrario, lanzar.
      const statusCode = err.status || err.statusCode;
      const isConflict = statusCode === 409 || err.message?.includes("exists");

      if (!isConflict) {
        throw error;
      }
      console.log(`✓ Dataset '${DATASET_NAME}' ya existe. Verificando items...\n`);
    }

    // 5. Agregar items (upsert: usar ID explícito para idempotencia)
    let uploadedCount = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      // Generar ID único basado en source_trace_id (que es único en el dataset)
      const itemId = `item-${item.metadata.source_trace_id}`;

      try {
        await langfuse.dataset.createItem({
          datasetName: DATASET_NAME,
          id: itemId,
          input: item.input,
          expectedOutput: item.expected_output,
          metadata: item.metadata,
        });
        uploadedCount++;
      } catch (error: unknown) {
        const err = error as { status?: number; statusCode?: number };
        const statusCode = err.status || err.statusCode;

        // Si el item ya existe (409), continuar sin contar como nuevo
        if (statusCode === 409) {
          continue;
        }

        // Otro error: lanzar
        throw error;
      }
    }

    // 6. Leer el dataset de vuelta para verificar
    const dataset = await langfuse.dataset.get(DATASET_NAME);
    const totalItems = dataset.items?.length ?? 0;

    // 7. Imprimir reporte en español
    console.log("📊 Reporte:");
    console.log(`   Dataset: ${DATASET_NAME}`);
    console.log(`   Items procesados en esta corrida: ${uploadedCount}`);
    console.log(`   Total de items en el dataset: ${totalItems}`);

    if (totalItems !== 12) {
      console.warn(
        `\n⚠️  Advertencia: se esperaban 12 items, pero hay ${totalItems}.`,
      );
    } else {
      console.log("\n✓ Todos los 12 casos cargados exitosamente.");
    }

    console.log(`\n🔗 Verifica en: ${baseUrl}/datasets/${DATASET_NAME}`);

    // Shutdown obligatorio
    await langfuse.shutdown();
  } catch (error: unknown) {
    console.error(
      "\n❌ Error al procesar el dataset:",
      error instanceof Error ? error.message : String(error),
    );
    await langfuse.shutdown().catch(() => {
      /* ignorar errores en shutdown */
    });
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error no capturado:", error);
  process.exit(1);
});
