/**
 * El turno completo del chatbot de soporte de BanCentral GT.
 *
 * Puerto del `answer_user()` de referencia (Python, ver
 * `promptops-demo/demo/chatbot/app.py`) a TypeScript + Gemini. Mismo orden
 * de pasos: RAG → cuenta (mock MCP) → prompt compilado → generación.
 *
 * Todavía SIN instrumentación de Langfuse (spans) — eso es la tarea 2.2.
 */

import { generateText } from "ai";
import { google } from "@ai-sdk/google";

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
  // 1. RAG — opcional según el bloque del taller.
  const policyChunks = useRag ? await retrieve(userMsg, ragK) : [];

  // 2. Mock MCP — contexto de cuenta.
  const account = lookupAccount(userId);

  // 3. Prompt compilado (Langfuse con fallback local).
  const { system, userMessage, origin } = await getPrompt(promptLabel, {
    policy_chunks: formatPolicyChunks(policyChunks),
    account_json: JSON.stringify(account),
    user_msg: userMsg,
  });

  // 4. Generación.
  let reply: string;
  try {
    const { text } = await generateText({
      model: google(GENERATION_MODEL),
      system,
      prompt: userMessage,
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS_EFECTIVO,
      providerOptions: GOOGLE_PROVIDER_OPTIONS,
    });
    reply = text;
  } catch (err) {
    throw toActionableError(err);
  }

  return {
    reply,
    policyChunks,
    account,
    promptLabel,
    promptOrigin: origin,
  };
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
    const { text } = await generateText({
      model: google(GENERATION_MODEL),
      prompt: userMsg,
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS_EFECTIVO,
      providerOptions: GOOGLE_PROVIDER_OPTIONS,
    });
    return { reply: text };
  } catch (err) {
    throw toActionableError(err);
  }
}
