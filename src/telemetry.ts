/**
 * Instrumentación con Langfuse (tarea 2.2) — bloque 5 del taller.
 *
 * Este módulo es el único responsable de saber que Langfuse existe. `rag.ts`
 * y `tools.ts` se quedan puros a propósito: los spans hijos se crean *desde*
 * `agent.ts`, envolviendo las llamadas a `retrieve()` y `lookupAccount()`.
 * Ver el brief de la tarea 2.2 para el razonamiento completo.
 *
 * Árbol resultante en Langfuse:
 *
 *   support_chat                 (span raíz, ver `traceSupportChat` en agent.ts)
 *   ├── rag_retrieve             (similitudes de los chunks)
 *   ├── mcp_account_lookup       (required_verification)
 *   └── <generación>             (la crea sola la integración de Vercel AI SDK)
 *
 * Arranque elegido: `NodeSDK` de `@opentelemetry/sdk-node`, tal como lo
 * documenta el propio docstring del `.d.ts` de `@langfuse/vercel-ai-sdk`
 * (ver el ejemplo `instrumentation.ts` ahí). Es la única dependencia nueva
 * autorizada por el brief — no estaba instalada, así que se agregó
 * (`@opentelemetry/sdk-node@0.221.0`). Se evaluó la alternativa de registrar
 * el `LangfuseSpanProcessor` a mano en un `TracerProvider` sin `NodeSDK`,
 * pero el paquete `@opentelemetry/sdk-trace-node` tampoco estaba instalado
 * y `NodeSDK` ya hace exactamente eso (crear el provider, registrarlo
 * globalmente, engancharle el processor) con una sola dependencia declarada
 * y documentada oficialmente para este caso de uso (script de Node, no
 * Next.js). Menos superficie nueva, mismo resultado.
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { registerTelemetry } from "ai";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";

let sdk: NodeSDK | undefined;
let spanProcessor: LangfuseSpanProcessor | undefined;
let initialized = false;

/**
 * Prende la instrumentación de Langfuse. Idempotente: llamarla más de una
 * vez no vuelve a registrar nada.
 *
 * **Inocua sin credenciales.** Si faltan `LANGFUSE_PUBLIC_KEY` o
 * `LANGFUSE_SECRET_KEY`, no arranca nada — ni excepción ni ruido — y
 * `answerUser()` sigue funcionando exactamente igual que sin `--trace`
 * (spans no-op: los métodos existen pero no exportan nada). Los bloques 1 a
 * 3 del taller dependen de que esto no reviente si alguien llama a
 * `initTelemetry()` antes de tener el `.env` de Langfuse completo.
 *
 * Debe llamarse **después** de `loadEnv()` (que normaliza `LANGFUSE_HOST` →
 * `LANGFUSE_BASE_URL`) y **antes** de la primera llamada a `answerUser()`.
 */
export function initTelemetry(): boolean {
  if (initialized) return true;
  initialized = true;

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();

  if (!publicKey || !secretKey) {
    console.warn(
      "⚠️  Faltan LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY en `.env` → --trace corre sin " +
        "instrumentación (no se crea ninguna traza). Copia las keys de tu proyecto de " +
        "Langfuse Cloud (Settings → API Keys) para activarla.",
    );
    return false;
  }

  spanProcessor = new LangfuseSpanProcessor();
  sdk = new NodeSDK({ spanProcessors: [spanProcessor] });
  sdk.start();
  registerTelemetry(new LangfuseVercelAiSdkIntegration());

  return true;
}

/**
 * Vacía el processor de spans antes de que el proceso termine.
 *
 * **Obligatorio.** Un script de Node que sale sin flush pierde la traza en
 * silencio — el `NodeSDK.shutdown()` internamente hace flush, pero un
 * script CLI de un solo turno (como `chat.ts`) no espera a un `SIGTERM`
 * para dispararlo, así que hay que llamarlo explícitamente antes de salir,
 * también en el camino de error.
 */
export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) return;
  try {
    await spanProcessor?.forceFlush();
    await sdk.shutdown();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`⚠️  No se pudo cerrar limpiamente la instrumentación de Langfuse: ${message}`);
  }
}
