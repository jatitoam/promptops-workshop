/**
 * Carga de prompts con fallback a disco.
 *
 * El taller corre en dos fases: en los bloques 2 y 3 el participante todavía
 * no tiene un proyecto de Langfuse (lo crea en el bloque 4), así que el
 * chatbot tiene que funcionar en frío. `getPrompt()` intenta primero
 * Langfuse (prompt "support-bot", por etiqueta) y, si falla por cualquier
 * motivo —sin credenciales, prompt inexistente, red caída—, cae al `.txt`
 * local correspondiente sin ruido ni traza de excepción.
 */

import { readFileSync } from "node:fs";
import { LangfuseClient } from "@langfuse/client";

export type PromptLabel = "v1-terse" | "v2-empathetic" | "v3-compliant" | "production";
export type PromptOrigin = "langfuse" | "local";

export interface CompiledPrompt {
  /** System prompt ya resuelto. */
  system: string;
  /** Mensaje de usuario ya compilado (placeholders sustituidos). */
  userMessage: string;
  /** De dónde salió el prompt: Langfuse o el fallback local en disco. */
  origin: PromptOrigin;
}

interface PromptVars {
  policy_chunks: string;
  account_json: string;
  user_msg: string;
}

// `production` en modo local equivale a `v3-compliant` — no hay un
// "production.txt" separado en el repo.
const LOCAL_FILE_BY_LABEL: Record<PromptLabel, string> = {
  "v1-terse": "prompts/v1-terse.txt",
  "v2-empathetic": "prompts/v2-empathetic.txt",
  "v3-compliant": "prompts/v3-compliant.txt",
  production: "prompts/v3-compliant.txt",
};

const USER_TEMPLATE_PATH = "prompts/_user-template.txt";
const LANGFUSE_PROMPT_NAME = "support-bot";

/**
 * ¿Tiene sentido siquiera intentar Langfuse?
 *
 * En los bloques 1 a 3 el participante todavía NO tiene proyecto de Langfuse
 * — lo crea en el bloque 4. Sin esta comprobación, cada turno del chatbot
 * dispararía una llamada condenada al fracaso y el SDK escupiría un stack
 * trace de ~40 líneas en rojo antes de que nuestro `catch` pudiera hacer
 * nada. En un salón replicando paso a paso, eso se lee como "lo rompí".
 */
function langfuseConfigurado(): boolean {
  return Boolean(
    process.env.LANGFUSE_PUBLIC_KEY?.trim() && process.env.LANGFUSE_SECRET_KEY?.trim(),
  );
}

/**
 * Recuerda que Langfuse ya falló en este proceso, para no repetir el intento
 * (ni su ruido) en cada turno. Se reinicia al reiniciar el proceso, que es
 * justo lo que hace el participante después de pegar sus keys.
 */
let langfuseDescartado = false;

/** Sustituye {{policy_chunks}}, {{account_json}} y {{user_msg}} en una plantilla. */
function fillTemplate(template: string, vars: PromptVars): string {
  return template
    .replaceAll("{{policy_chunks}}", vars.policy_chunks)
    .replaceAll("{{account_json}}", vars.account_json)
    .replaceAll("{{user_msg}}", vars.user_msg);
}

function loadLocalPrompt(label: PromptLabel, vars: PromptVars): CompiledPrompt {
  const systemTemplate = readFileSync(LOCAL_FILE_BY_LABEL[label], "utf-8");
  const userTemplate = readFileSync(USER_TEMPLATE_PATH, "utf-8");
  return {
    system: fillTemplate(systemTemplate, vars),
    userMessage: fillTemplate(userTemplate, vars),
    origin: "local",
  };
}

/**
 * Intenta traer el prompt "support-bot" de Langfuse por etiqueta (`label`)
 * como prompt de tipo chat, y lo compila con las variables dadas.
 *
 * Langfuse guarda los chat prompts como una lista plana de mensajes
 * role/content. El SDK de Anthropic (y nuestro flujo) separan el system
 * prompt de los mensajes, así que particionamos igual que `_compile_prompt()`
 * en el `app.py` de referencia.
 */
async function loadLangfusePrompt(
  label: PromptLabel,
  vars: PromptVars,
): Promise<CompiledPrompt> {
  const prompt = await new LangfuseClient().prompt.get(LANGFUSE_PROMPT_NAME, {
    label,
    type: "chat",
  });

  const compiled = prompt.compile({
    policy_chunks: vars.policy_chunks,
    account_json: vars.account_json,
    user_msg: vars.user_msg,
  });

  const systemParts: string[] = [];
  const userParts: string[] = [];
  for (const msg of compiled) {
    // Los placeholders sin resolver no tienen `role`/`content` de texto —
    // no deberían aparecer aquí porque no usamos placeholders, pero los
    // saltamos por seguridad de tipos.
    if (!("role" in msg) || typeof msg.content !== "string") continue;
    if (msg.role === "system") {
      systemParts.push(msg.content);
    } else {
      userParts.push(msg.content);
    }
  }

  if (systemParts.length === 0 && userParts.length === 0) {
    throw new Error(`El prompt "${LANGFUSE_PROMPT_NAME}" (label "${label}") vino vacío.`);
  }

  return {
    system: systemParts.join("\n\n"),
    userMessage: userParts.join("\n\n"),
    origin: "langfuse",
  };
}

/**
 * Devuelve el system prompt y el mensaje de usuario ya compilados para la
 * etiqueta dada, más de dónde salieron ("langfuse" o "local").
 *
 * Intenta Langfuse primero; si falla por cualquier motivo, cae al `.txt`
 * local sin ruido — solo un aviso breve a stderr — porque el chatbot tiene
 * que funcionar antes de que exista el proyecto de Langfuse (bloque 4).
 */
export async function getPrompt(
  label: PromptLabel,
  vars: PromptVars,
): Promise<CompiledPrompt> {
  if (langfuseDescartado || !langfuseConfigurado()) {
    return loadLocalPrompt(label, vars);
  }

  try {
    return await loadLangfusePrompt(label, vars);
  } catch {
    langfuseDescartado = true;
    console.error(
      `(aviso) el prompt "${LANGFUSE_PROMPT_NAME}" todavía no existe en tu proyecto de ` +
        "Langfuse — uso el .txt local. Súbelo con `npm run seed:prompts` (bloque 4).",
    );
    return loadLocalPrompt(label, vars);
  }
}
