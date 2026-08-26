#!/usr/bin/env tsx
/**
 * CLI del participante — bloques 1, 2, 3 y 5 del taller.
 *
 * Cuatro modos, cada uno el punto de entrada de un bloque del taller:
 *
 *   npm run chat -- --naked                    (bloque 1: modelo crudo)
 *   npm run chat -- --prompt v1                 (bloque 2: system prompt, sin RAG)
 *   npm run chat -- --prompt v1 --rag            (bloque 3: con RAG, muestra los chunks)
 *   npm run chat -- --trace                      (bloque 5: --rag + instrumentación, aún pendiente)
 *
 * Cada modo tiene que funcionar solo — sin haber corrido el anterior — porque
 * si alguien se pierde en el taller, tiene que poder saltar directo al
 * comando del bloque en el que está el resto del salón.
 */

import { loadEnv } from "./env.ts";

// `loadEnv()` tiene que ser lo primero, antes de importar nada que lea
// variables de entorno (p. ej. `agent.ts`, que lee `GENERATION_MODEL` a
// nivel de módulo).
loadEnv();

const { parseArgs } = await import("node:util");
const { answerUser, askRaw } = await import("./agent.ts");
const { initTelemetry, shutdownTelemetry, telemetriaActiva } = await import("./telemetry.ts");
type PromptLabel = "v1-terse" | "v2-empathetic" | "v3-compliant" | "production";

const CONSULTA_CANONICA =
  "No puedo entrar a la app, creo que alguien intentó acceder a mi cuenta anoche";

const ALIAS_A_ETIQUETA: Record<string, PromptLabel> = {
  v1: "v1-terse",
  v2: "v2-empathetic",
  v3: "v3-compliant",
  production: "production",
  "v1-terse": "v1-terse",
  "v2-empathetic": "v2-empathetic",
  "v3-compliant": "v3-compliant",
};

const isTTY = Boolean(process.stdout.isTTY);

function color(code: string, text: string): string {
  if (!isTTY) return text;
  return `[${code}m${text}[0m`;
}

const bold = (s: string) => color("1", s);
const dim = (s: string) => color("2", s);
const cyan = (s: string) => color("36", s);
const yellow = (s: string) => color("33", s);
const green = (s: string) => color("32", s);
const red = (s: string) => color("31", s);

function printHelp(): void {
  console.log(`${bold("chat.ts")} — CLI del participante del taller PromptOps

${bold("Uso:")}
  npm run chat -- [opciones]

${bold("Modos (uno por bloque del taller):")}
  ${cyan("npm run chat -- --naked")}
      Bloque 1 — el modelo crudo, sin system prompt ni RAG.

  ${cyan("npm run chat -- --prompt v1")}
      Bloque 2 — con system prompt (variante v1), sin RAG.

  ${cyan("npm run chat -- --prompt v1 --rag")}
      Bloque 3 — con RAG, imprimiendo los chunks recuperados.

  ${cyan("npm run chat -- --trace")}
      Bloque 5 — igual que --rag + instrumentación con Langfuse. El turno
      queda como un span raíz "support_chat" con hijos "rag_retrieve" y
      "mcp_account_lookup", más la generación. Requiere LANGFUSE_PUBLIC_KEY
      / LANGFUSE_SECRET_KEY en el .env; sin ellas corre igual pero sin
      trazar nada.

${bold("Opciones:")}
  --naked              Modo desnudo: sin system prompt ni RAG.
                        Incompatible con --prompt y --rag.
  --prompt <variante>   v1 | v2 | v3 | production (también los nombres
                        largos: v1-terse, v2-empathetic, v3-compliant).
                        Por defecto: v3.
  --rag                Activa el retrieval e imprime los chunks recuperados.
  --trace              Implica --rag. Activa la instrumentación con
                        Langfuse (bloque 5).
  -m, --message <texto> La consulta del cliente. Por defecto la consulta
                        canónica del taller:
                        "${CONSULTA_CANONICA}"
  --user <id>          Id de usuario para el mock de cuenta. Por defecto
                        "U-DEMO-001".
  -h, --help            Muestra esta ayuda.
`);
}

function fail(message: string): never {
  console.error(red("✖ ") + message);
  console.error(dim("Corre `npm run chat -- --help` para ver el uso."));
  process.exit(1);
}

function resolvePromptLabel(raw: string | undefined): PromptLabel {
  const value = (raw ?? "v3").trim().toLowerCase();
  const resolved = ALIAS_A_ETIQUETA[value];
  if (!resolved) {
    fail(
      `Variante de prompt desconocida: "${raw}". Usa v1, v2, v3, production ` +
        "(o los nombres largos v1-terse / v2-empathetic / v3-compliant / production).",
    );
  }
  return resolved;
}

let parsed: ReturnType<typeof parseArgs>;
try {
  parsed = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: false,
    strict: true,
    options: {
      naked: { type: "boolean", default: false },
      prompt: { type: "string" },
      rag: { type: "boolean", default: false },
      trace: { type: "boolean", default: false },
      message: { type: "string", short: "m" },
      user: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  fail(`Argumento inválido: ${message}`);
}

const values = parsed!.values;

if (values.help) {
  printHelp();
  process.exit(0);
}

const naked = Boolean(values.naked);
const trace = Boolean(values.trace);
const rag = Boolean(values.rag) || trace; // --trace implica --rag
const userMsg = (values.message as string | undefined)?.trim() || CONSULTA_CANONICA;
const userId = (values.user as string | undefined)?.trim() || "U-DEMO-001";

if (naked && (values.prompt !== undefined || values.rag || trace)) {
  fail("--naked es incompatible con --prompt y --rag (el modo desnudo no usa ninguno de los dos).");
}

function printHeader(info: {
  modo: string;
  promptLabel?: string;
  promptOrigin?: string;
  ragActivo: boolean;
  modelo: string;
}): void {
  console.log(bold(`━━━ BanCentral GT — CLI del taller (${info.modo}) ━━━`));
  if (info.promptLabel) {
    const origen = info.promptOrigin ? ` ${dim(`(origen: ${info.promptOrigin})`)}` : "";
    console.log(`  Prompt:  ${cyan(info.promptLabel)}${origen}`);
  } else {
    console.log(`  Prompt:  ${dim("(ninguno — modo desnudo)")}`);
  }
  console.log(`  RAG:     ${info.ragActivo ? green("sí") : dim("no")}`);
  console.log(`  Modelo:  ${cyan(info.modelo)}`);
  console.log("");
}

function printChunks(chunks: { text: string; similarity: number; source: string }[]): void {
  console.log(bold("── Chunks recuperados ──"));
  if (chunks.length === 0) {
    console.log(dim("  (ninguno)"));
  } else {
    chunks.forEach((chunk, i) => {
      const preview = chunk.text.split("\n").slice(0, 2).join(" ").slice(0, 160);
      console.log(
        `  ${bold(`#${i + 1}`)}  similitud=${yellow(chunk.similarity.toFixed(3))}  fuente=${cyan(chunk.source)}`,
      );
      console.log(`      ${dim(preview)}${preview.length >= 160 ? "…" : ""}`);
    });
  }
  console.log("");
}

function printRequiredVerification(required: string[]): void {
  console.log(bold("── Verificación requerida (mock de cuenta) ──"));
  console.log(`  ${yellow(JSON.stringify(required))}`);
  console.log("");
}

function printExchange(userMsg: string, reply: string): void {
  console.log(bold("── Pregunta del cliente ──"));
  console.log(`  ${userMsg}`);
  console.log("");
  console.log(bold("── Respuesta del bot ──"));
  console.log(`  ${reply}`);
  console.log("");
}

async function main(): Promise<void> {
  const modelo = process.env.GENERATION_MODEL?.trim() || "gemini-3.5-flash-lite";

  if (naked) {
    printHeader({ modo: "bloque 1 — desnudo", ragActivo: false, modelo });
    const { reply } = await askRaw({ userMsg });
    printExchange(userMsg, reply);
    return;
  }

  const promptLabel = resolvePromptLabel(values.prompt as string | undefined);

  if (trace) {
    // ─────────────────────────────────────────────────────────────────────
    // ⬅  BLOQUE 5 · PEGA AQUÍ (1 de 2)
    //
    //    Enciende la instrumentación. La línea exacta está en `BLOQUE-5.md`.
    //    Hasta que la pegues, `--trace` corre igual que `--rag` y NO crea
    //    ninguna traza en Langfuse. Eso es a propósito: primero se ve el
    //    "antes".
    // ─────────────────────────────────────────────────────────────────────

    const activa = telemetriaActiva();
    console.log(
      activa
        ? green("✓ Instrumentación de Langfuse activa — este turno queda trazado como ") +
            green('"support_chat".')
        : yellow(
            "⚠️  --trace pedido pero la instrumentación NO está encendida: este turno no va a\n" +
              "    crear ninguna traza. Pega las dos líneas del bloque 5 (ver `BLOQUE-5.md`),\n" +
              "    o corre `npm run fix:trace` si te quedaste atrás.",
          ),
    );
    console.log("");
  }

  const modo = trace ? "bloque 5 — con trace" : rag ? "bloque 3 — con RAG" : "bloque 2 — sin RAG";

  // El encabezado se imprime ANTES de llamar al modelo, a propósito: la
  // generación tarda varios segundos y, proyectada en pantalla delante del
  // salón, una terminal en blanco se lee como "se colgó". Primero se ve en
  // qué modo corre, y luego llega la respuesta.
  printHeader({ modo, promptLabel, ragActivo: rag, modelo });
  // Solo en TTY: si la salida está redirigida a un archivo, el indicador de
  // progreso y su borrado dejarían códigos de escape sueltos en el texto.
  if (isTTY) process.stdout.write(dim("  consultando al modelo…"));

  const result = await answerUser({ userMsg, promptLabel, userId, useRag: rag });

  // Borra la línea de "consultando…" para que no ensucie la salida final.
  if (isTTY) process.stdout.write("\r\u001b[2K");

  // De dónde salió el prompt solo se sabe después de pedirlo. Importa: en el
  // bloque 4 el instructor demuestra justo el cambio de local a Langfuse.
  console.log(`  Origen del prompt: ${cyan(result.promptOrigin)}`);
  console.log("");

  if (rag) {
    printChunks(result.policyChunks);
    printRequiredVerification(result.account.required_verification);
  }

  printExchange(userMsg, result.reply);
}

main()
  .then(async () => {
    // ───────────────────────────────────────────────────────────────────────
    // ⬅  BLOQUE 5 · PEGA AQUÍ (2 de 2)
    //
    //    Vacía los spans antes de que el proceso termine.
    //
    //    Este paso parece burocrático y no lo es: si lo omites, el turno se
    //    traza igual pero el proceso sale antes de enviar nada, y la traza
    //    **se pierde en silencio** — sin error, sin aviso, simplemente no
    //    aparece en Langfuse. Es la lección del bloque, no un accidente.
    // ───────────────────────────────────────────────────────────────────────

    process.exit(0);
  })
  .catch(async (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(red("✖ ") + message);
    // ⬅  BLOQUE 5 · el mismo flush va también aquí, en el camino de error.
    process.exit(1);
  });
