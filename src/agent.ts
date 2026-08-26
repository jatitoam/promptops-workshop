/**
 * El turno completo del chatbot de soporte de BanCentral GT.
 *
 * Puerto del `answer_user()` de referencia (Python, ver
 * `promptops-demo/demo/chatbot/app.py`) a TypeScript + Gemini. Mismo orden
 * de pasos: RAG → cuenta (mock MCP) → prompt compilado → generación.
 *
 * Instrumentación de Langfuse (tarea 2.2): el turno completo corre dentro de
 * un span raíz `support_chat`, con `rag_retrieve` y `mcp_account_lookup`
 * como spans hijos creados aquí mismo — `rag.ts` y `tools.ts` se quedan
 * puros, sin saber que Langfuse existe. Sin instrumentación activa (sin
 * `--trace`, o sin credenciales de Langfuse) estas llamadas son no-op sobre
 * el tracer global de OpenTelemetry: `answerUser()` funciona exactamente
 * igual. Ver `telemetry.ts`.
 */

import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { startActiveObservation } from "@langfuse/tracing";

import { retrieve, type RetrievedChunk } from "./rag.ts";
import { lookupAccount, type AccountLookupResult } from "./tools.ts";
import { getPrompt, type PromptLabel, type PromptOrigin } from "./prompts.ts";

/**
 * Modelo generador. Se puede sobrescribir con `GENERATION_MODEL` en el `.env`.
 *
 * La variable existe por una razón concreta: la capa gratuita de Gemini limita
 * las peticiones **por día y por modelo**, así que si alguien agota su cupo a
 * mitad del taller, cambiar de modelo le devuelve un cupo entero sin tocar el
 * código. El respaldo probado es `gemini-3.1-flash-lite`. Ver `GOTCHAS.md` G-10.
 */
const GENERATION_MODEL = process.env.GENERATION_MODEL?.trim() || "gemini-3.5-flash-lite";
const TEMPERATURE = 0.3;
const MAX_OUTPUT_TOKENS = 512;

/**
 * Los modelos de Gemini gastan razonamiento interno (*thinking tokens*) del
 * mismo presupuesto que `maxOutputTokens`. Con `maxOutputTokens: 512` —el
 * equivalente directo del `max_tokens: 512` del demo Python— a `gemini-3.5-flash`
 * le quedaban ~20 tokens para la respuesta real y la cortaba a media oración.
 *
 * `thinkingBudget: 0` lo desactiva y devuelve los 512 tokens al texto... pero
 * **no todos los modelos lo aceptan**: `gemini-3.5-flash-lite` responde
 * `400 INVALID_ARGUMENT` con `thinkingBudget: 0` (admite `-1` u omitirlo).
 * Por eso la opción es por modelo y no global: el respaldo tiene que seguir
 * funcionando si alguien cambia `GENERATION_MODEL` a mitad del taller.
 * Ver `GOTCHAS.md` G-11.
 */
const MODELOS_SIN_THINKING_DESACTIVABLE = ["gemini-3.5-flash-lite"];

function providerOptionsPara(model: string) {
  if (MODELOS_SIN_THINKING_DESACTIVABLE.includes(model)) return undefined;
  return { google: { thinkingConfig: { thinkingBudget: 0 } } } as const;
}

const GOOGLE_PROVIDER_OPTIONS = providerOptionsPara(GENERATION_MODEL);

/**
 * Sin poder apagar el razonamiento hay que dejar margen para que el modelo
 * piense Y responda; con el razonamiento apagado, 512 son todos de respuesta.
 */
const MAX_OUTPUT_TOKENS_EFECTIVO = GOOGLE_PROVIDER_OPTIONS ? MAX_OUTPUT_TOKENS : MAX_OUTPUT_TOKENS * 4;

/**
 * Tiempo máximo por llamada al modelo, y reintentos.
 *
 * No es paranoia: medido el 2026-08-26, la API de Gemini en capa gratuita
 * **se queda colgada de forma intermitente** — 2 de cada 6 peticiones idénticas
 * no respondieron nunca (>12 s, abortadas), mientras el resto volvía en menos
 * de un segundo. No devuelve error: simplemente no contesta.
 *
 * Sin límite de tiempo, la CLI se cuelga indefinidamente, y en un salón eso se
 * lee como "se me trabó" sin ninguna pista de por qué. Con límite, se convierte
 * en un reintento automático y, si insiste, un mensaje claro en español.
 * Ver `GOTCHAS.md` G-16.
 */
const TIMEOUT_MODELO_MS = 15_000;
const INTENTOS = 3;

/**
 * Reintenta una llamada al modelo dándole a CADA intento su propio límite de
 * tiempo.
 *
 * Ojo con el detalle que hace inútil la vía obvia: pasar un solo
 * `abortSignal: AbortSignal.timeout(...)` junto con `maxRetries` del AI SDK
 * **no funciona** — esa señal aborta la operación entera, reintentos incluidos,
 * así que el SDK nunca llega a reintentar. Medido: el mensaje decía "se
 * reintentó 2 veces" y el reloj marcaba un solo timeout. Por eso el bucle es
 * nuestro y la señal se crea de nuevo en cada intento.
 */
async function conReintentos<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  let ultimoError: unknown;
  for (let intento = 1; intento <= INTENTOS; intento++) {
    try {
      return await fn(AbortSignal.timeout(TIMEOUT_MODELO_MS));
    } catch (err) {
      ultimoError = err;
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      const esTimeout = msg.includes("abort") || msg.includes("timeout") || msg.includes("timed out");
      // Solo se reintenta un cuelgue. Una key inválida o un 404 de modelo no
      // mejoran repitiendo: fallan rápido y con su mensaje propio.
      if (!esTimeout || intento === INTENTOS) throw err;
      console.error(
        `(aviso) la API no respondió en ${TIMEOUT_MODELO_MS / 1000} s — reintento ${intento} de ${INTENTOS - 1}…`,
      );
    }
  }
  throw ultimoError;
}

export interface AnswerUserOptions {
  /** Mensaje del cliente. */
  userMsg: string;
  /** Variante de prompt a usar. Por defecto la más estricta (v3-compliant). */
  promptLabel?: PromptLabel;
  /** Identificador estable para el mock MCP de cuentas. */
  userId?: string;
  /**
   * Si es `false`, no se corre RAG y `policyChunks` va vacío. Los bloques 1
   * y 2 del taller corren el bot sin RAG. Por defecto `true`.
   */
  useRag?: boolean;
  /** Cuántos chunks pedir a `retrieve()` cuando `useRag` está activo. */
  ragK?: number;
}

export interface AnswerUserResult {
  /** La respuesta del bot. */
  reply: string;
  /** Los chunks de política recuperados (vacío si `useRag` estaba apagado). */
  policyChunks: RetrievedChunk[];
  /** El resultado de `lookupAccount()` usado para este turno. */
  account: AccountLookupResult;
  /** La etiqueta de prompt que se usó. */
  promptLabel: PromptLabel;
  /** De dónde salió el prompt: "langfuse" o "local". */
  promptOrigin: PromptOrigin;
}

/** Formatea los chunks recuperados igual que el Python de referencia. */
function formatPolicyChunks(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c) => `[source: ${c.source} | similarity: ${c.similarity}]\n${c.text}`)
    .join("\n\n");
}

/** Traduce errores comunes de la llamada al modelo a mensajes en español, accionables. */
function toActionableError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) {
    return new Error(
      "Falta `GOOGLE_GENERATIVE_AI_API_KEY` en `.env` → cópiala de `.env.example` y " +
        "genera una key en https://aistudio.google.com/apikey.",
    );
  }
  if (lower.includes("api key not valid") || lower.includes("401") || lower.includes("403")) {
    return new Error(
      "La API key de Gemini fue rechazada (401/403) → revisa `GOOGLE_GENERATIVE_AI_API_KEY` " +
        "en `.env` o regenérala en https://aistudio.google.com/apikey.",
    );
  }
  if (lower.includes("429") || lower.includes("quota") || lower.includes("rate limit")) {
    return new Error(
      `Se excedió la cuota o el límite de tasa de Gemini (429) → espera unos segundos y ` +
        `reintenta. Detalle original: ${message}`,
    );
  }
  if (lower.includes("404") || lower.includes("not found") || lower.includes("not available")) {
    return new Error(
      `El modelo \`${GENERATION_MODEL}\` no está disponible para esta key (404) → repórtalo ` +
        `al instructor, puede ser un problema de la cuenta de Google AI Studio. Detalle: ${message}`,
    );
  }
  if (
    lower.includes("abort") ||
    lower.includes("timeout") ||
    lower.includes("timed out")
  ) {
    return new Error(
      `La API de Gemini no respondió en ninguno de los ${INTENTOS} intentos ` +
        `(${TIMEOUT_MODELO_MS / 1000} s cada uno). No es tu configuración: la capa gratuita se ` +
        "cuelga de vez en cuando sin devolver error. Vuelve a correr el mismo comando.",
    );
  }
  return new Error(`Falló la generación con Gemini: ${message}`);
}

/**
 * Corre el turno completo del chatbot: RAG (opcional) → cuenta → prompt →
 * generación con Gemini. `temperature: 0.3`, `maxOutputTokens: 512` —
 * equivalentes al `max_tokens: 512` del demo Python.
 */
export async function answerUser({
  userMsg,
  promptLabel = "v3-compliant",
  userId = "U-DEMO-001",
  useRag = true,
  ragK = 4,
}: AnswerUserOptions): Promise<AnswerUserResult> {
  return startActiveObservation("support_chat", async (rootSpan) => {
    // ⚠️ La forma de este `input` es CONTRATO, no un detalle.
    //
    // El evaluador del juez (tarea 2.4) se mapea con un jsonPath sobre este
    // campo, y un jsonPath mal puesto no da error: hace que **todo apruebe en
    // silencio**, que es el fallo más caro del taller. Medido contra una traza
    // real: Langfuse guarda este objeto **tal cual**, sin envoltorio — en la
    // versión Python el decorador `@observe` lo envolvía y obligaba a usar
    // `$.kwargs.user_msg`; aquí no. El jsonPath correcto es `$.user_msg`.
    //
    // Las claves van en snake_case a propósito, para que coincidan con las de
    // `data/dataset.json` (`input.user_msg`): así el mismo evaluador sirve
    // tanto para el chat en vivo como para las corridas del experimento, y
    // quien compare un caso del dataset con su traza ve el mismo vocabulario.
    // Ver `GOTCHAS.md` G-15.
    rootSpan.update({ input: { user_msg: userMsg, prompt_label: promptLabel } });

    try {
      // 1. RAG — opcional según el bloque del taller.
      //
      // Nota: se usa `startActiveObservation` (no `rootSpan.startObservation`)
      // porque `retrieve()` hace su propia llamada instrumentada (`embed()`
      // vía la integración de Vercel AI SDK), que se cuelga del span
      // *activo* en el contexto de OpenTelemetry — `startObservation` crea
      // el span pero no lo activa, así que el embedding quedaría como
      // hermano de `rag_retrieve` bajo `support_chat` en vez de anidado
      // dentro. `startActiveObservation` sí empuja el contexto.
      let policyChunks: RetrievedChunk[] = [];
      if (useRag) {
        policyChunks = await startActiveObservation(
          "rag_retrieve",
          async (ragSpan) => {
            ragSpan.update({ input: { query: userMsg, k: ragK } });
            const chunks = await retrieve(userMsg, ragK);
            ragSpan.update({ output: chunks });
            return chunks;
          },
        );
      }

      // 2. Mock MCP — contexto de cuenta.
      const account = await startActiveObservation(
        "mcp_account_lookup",
        (acctSpan) => {
          acctSpan.update({ input: { userId } });
          const result = lookupAccount(userId);
          acctSpan.update({ output: result });
          return result;
        },
      );

      // 3. Prompt compilado (Langfuse con fallback local).
      const { system, userMessage, origin } = await getPrompt(promptLabel, {
        policy_chunks: formatPolicyChunks(policyChunks),
        account_json: JSON.stringify(account),
        user_msg: userMsg,
      });

      // 4. Generación. Trazada como observación tipo `generation` por la
      // integración de Vercel AI SDK registrada en `initTelemetry()` — no
      // hace falta pasar `telemetry` aquí, queda activa por defecto en
      // cuanto hay una integración registrada globalmente.
      let reply: string;
      try {
        const { text } = await conReintentos((abortSignal) =>
          generateText({
            model: google(GENERATION_MODEL),
            system,
            prompt: userMessage,
            temperature: TEMPERATURE,
            maxOutputTokens: MAX_OUTPUT_TOKENS_EFECTIVO,
            providerOptions: GOOGLE_PROVIDER_OPTIONS,
            abortSignal,
            maxRetries: 0,
          }),
        );
        reply = text;
      } catch (err) {
        throw toActionableError(err);
      }

      rootSpan.update({ output: reply });

      return {
        reply,
        policyChunks,
        account,
        promptLabel,
        promptOrigin: origin,
      };
    } catch (err) {
      rootSpan.update({
        level: "ERROR",
        statusMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  });
}

export interface AskRawOptions {
  /** Mensaje del cliente, enviado crudo al modelo. */
  userMsg: string;
}

export interface AskRawResult {
  reply: string;
}

/**
 * Modo "desnudo": sin system prompt, sin RAG, sin cuenta — el bloque 1 del
 * taller le hace una pregunta al modelo crudo para mostrar el punto de
 * partida antes de cualquier ingeniería de prompt.
 */
export async function askRaw({ userMsg }: AskRawOptions): Promise<AskRawResult> {
  try {
    const { text } = await conReintentos((abortSignal) =>
      generateText({
        model: google(GENERATION_MODEL),
        prompt: userMsg,
        temperature: TEMPERATURE,
        maxOutputTokens: MAX_OUTPUT_TOKENS_EFECTIVO,
        providerOptions: GOOGLE_PROVIDER_OPTIONS,
        abortSignal,
        maxRetries: 0,
      }),
    );
    return { reply: text };
  } catch (err) {
    throw toActionableError(err);
  }
}
