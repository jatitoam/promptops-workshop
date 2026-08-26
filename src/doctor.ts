#!/usr/bin/env tsx
/**
 * Diagnóstico de pre-vuelo del taller PromptOps.
 *
 * Corre una serie de comprobaciones (versión de Node, variables de entorno,
 * archivos generados, y llamadas REALES a Google AI Studio / Langfuse / Groq)
 * e imprime un reporte en español, legible por alguien que nunca vio el repo.
 */

import { existsSync, readFileSync } from "node:fs";
import { loadEnv, langfuseBaseUrl } from "./env.ts";

type Status = "ok" | "warn" | "fail";

interface CheckResult {
  status: Status;
  message: string;
}

const ICONS: Record<Status, string> = {
  ok: "✅",
  warn: "⚠️ ",
  fail: "❌",
};

const results: CheckResult[] = [];

/**
 * Registra una comprobación. NO imprime: las comprobaciones de red corren en
 * paralelo y terminan en orden impredecible, así que la impresión se hace al
 * final, en el orden en que se registraron. Frente a 25 personas replicando
 * paso a paso, el reporte tiene que verse igual en todas las pantallas.
 */
function report(status: Status, message: string): CheckResult {
  return { status, message };
}

const NETWORK_TIMEOUT_MS = 15_000;

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(NETWORK_TIMEOUT_MS);
}

const NETWORK_ERROR_HINT =
  "¿estás detrás de un firewall? el taller necesita salida a " +
  "generativelanguage.googleapis.com, cloud.langfuse.com y api.groq.com";

// ---------------------------------------------------------------------------
// 1) Versión de Node
// ---------------------------------------------------------------------------
function checkNodeVersion(): CheckResult {
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 22) {
    return report("ok", `Node.js ${process.versions.node} (>= 22)`);
  } else {
    return report(
      "fail",
      `Node.js ${process.versions.node} es menor que 22 → instala Node 22 LTS ` +
        "(por ejemplo con nvm: `nvm install 22 && nvm use 22`).",
    );
  }
}

// ---------------------------------------------------------------------------
// 2) .env existe y se carga
// ---------------------------------------------------------------------------
function checkEnvFileExists(): CheckResult {
  if (!existsSync(".env")) {
    return report(
      "fail",
      "No existe el archivo `.env` en la raíz del repo → copia `.env.example` a `.env` " +
        "y completa tus credenciales (`cp .env.example .env`).",
    );
  }
  // loadEnv() calla el banner de dotenv y normaliza LANGFUSE_HOST -> LANGFUSE_BASE_URL.
  loadEnv();
  return report("ok", "Archivo `.env` encontrado y cargado.");
}

// ---------------------------------------------------------------------------
// 3) Las 5 variables están definidas y no vacías
// ---------------------------------------------------------------------------
const REQUIRED_VARS = [
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "LANGFUSE_BASE_URL",
] as const;

function checkRequiredVars(): CheckResult {
  const missing = REQUIRED_VARS.filter((name) => !process.env[name]?.trim());
  if (missing.length === 0) {
    const lengths = REQUIRED_VARS.map(
      (name) => `${name} (${process.env[name]!.trim().length} caracteres)`,
    ).join(", ");
    return report("ok", `Las 5 variables de entorno están definidas: ${lengths}.`);
  }
  return report(
    "fail",
    `Faltan estas variables en \`.env\`: ${missing.join(", ")}. ` +
      "Cuidado con dos trampas de nombre que fallan en silencio: " +
      "en JavaScript la variable es `LANGFUSE_BASE_URL` (no `LANGFUSE_HOST`, que es el " +
      "nombre del SDK de Python), y la de Google es `GOOGLE_GENERATIVE_AI_API_KEY` " +
      "(no `GEMINI_API_KEY`). " +
      "Nunca se imprime el valor de una credencial, solo su nombre.",
  );
}

// ---------------------------------------------------------------------------
// 4) data/policy-index.json existe y parsea
// ---------------------------------------------------------------------------
function checkPolicyIndex(): CheckResult {
  const path = "data/policy-index.json";
  if (!existsSync(path)) {
    return report(
      "warn",
      `\`${path}\` todavía no existe → se genera con \`npm run seed:index\` ` +
        "(normal en esta fase del build).",
    );
  }
  try {
    const raw = readFileSync(path, "utf-8");
    JSON.parse(raw);
    return report("ok", `\`${path}\` existe y es JSON válido.`);
  } catch (err) {
    return report(
      "fail",
      `\`${path}\` existe pero no se pudo parsear como JSON → regenera con ` +
        `\`npm run seed:index\`. Detalle: ${(err as Error).message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 5) Llamada REAL de generación (Gemini)
// ---------------------------------------------------------------------------
async function checkGeminiGeneration(): Promise<CheckResult> {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!key) {
    return report(
      "fail",
      "No se puede probar la generación con Gemini: falta `GOOGLE_GENERATIVE_AI_API_KEY`.",
    );
  }
  const model = process.env.GENERATION_MODEL?.trim() || "gemini-3.5-flash-lite";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "responde solo: ok" }] }],
      }),
      signal: timeoutSignal(),
    });

    if (res.status === 200) {
      return report("ok", `Generación con \`${model}\` responde 200.`);
    }
    if ([400, 401, 403].includes(res.status)) {
      return report(
        "fail",
        `Generación con \`${model}\` devolvió ${res.status} → la key es inválida o sin ` +
          "permisos. Regenérala en https://aistudio.google.com/apikey. " +
          "Nota: muchas cuentas institucionales no pueden crear keys; usa una cuenta Gmail personal.",
      );
    }
    if (res.status === 404) {
      return report(
        "fail",
        `Generación con \`${model}\` devolvió 404 → el modelo no está disponible para esta ` +
          "key (esto pasa aunque el modelo aparezca en el listado de modelos). Cambia el " +
          "modelo y repórtalo al instructor.",
      );
    }
    if (res.status === 429) {
      return report(
        "fail",
        `Generación con \`${model}\` devolvió 429 → cuota excedida, espera antes de reintentar.`,
      );
    }
    if (res.status === 503) {
      return report(
        "warn",
        `Generación con \`${model}\` devolvió 503 → el modelo está saturado, reintenta en unos segundos.`,
      );
    }
    return report(
      "fail",
      `Generación con \`${model}\` devolvió un código inesperado: ${res.status} ${res.statusText}.`,
    );
  } catch (err) {
    return report(
      "fail",
      `No se pudo llamar a la API de generación de Gemini (${(err as Error).message}). ${NETWORK_ERROR_HINT}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 6) Llamada REAL de embedding (Gemini)
// ---------------------------------------------------------------------------
async function checkGeminiEmbedding(): Promise<CheckResult> {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!key) {
    return report(
      "fail",
      "No se puede probar el embedding con Gemini: falta `GOOGLE_GENERATIVE_AI_API_KEY`.",
    );
  }
  const model = "gemini-embedding-001";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        model: `models/${model}`,
        content: { parts: [{ text: "prueba" }] },
        outputDimensionality: 768,
      }),
      signal: timeoutSignal(),
    });

    if (res.status !== 200) {
      if ([400, 401, 403].includes(res.status)) {
        return report(
          "fail",
          `Embedding con \`${model}\` devolvió ${res.status} → key inválida o sin permisos → ` +
            "regenérala en https://aistudio.google.com/apikey.",
        );
      }
      if (res.status === 404) {
        return report(
          "fail",
          `Embedding con \`${model}\` devolvió 404 → el modelo no está disponible para esta key.`,
        );
      }
      if (res.status === 429) {
        return report("fail", `Embedding con \`${model}\` devolvió 429 → cuota excedida, espera.`);
      }
      if (res.status === 503) {
        return report("warn", `Embedding con \`${model}\` devolvió 503 → modelo saturado, reintenta.`);
      }
      return report(
        "fail",
        `Embedding con \`${model}\` devolvió un código inesperado: ${res.status} ${res.statusText}.`,
      );
    }

    const body = (await res.json()) as {
      embedding?: { values?: number[] };
    };
    const dims = body.embedding?.values?.length ?? 0;
    if (dims === 768) {
      return report("ok", `Embedding con \`${model}\` responde 200 con 768 dimensiones.`);
    } else {
      return report(
        "fail",
        `Embedding con \`${model}\` respondió 200 pero con ${dims} dimensiones (se esperaban 768).`,
      );
    }
  } catch (err) {
    return report(
      "fail",
      `No se pudo llamar a la API de embeddings de Gemini (${(err as Error).message}). ${NETWORK_ERROR_HINT}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 7) Langfuse alcanzable y autenticado
// ---------------------------------------------------------------------------
async function checkLangfuse(): Promise<CheckResult> {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = process.env.LANGFUSE_SECRET_KEY?.trim();
  const host = langfuseBaseUrl();

  if (!publicKey || !secretKey || !host) {
    return report(
      "fail",
      "No se puede probar Langfuse: faltan `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` o `LANGFUSE_BASE_URL`.",
    );
  }

  const url = `${host}/api/public/projects`;
  const auth = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");

  try {
    const res = await fetch(url, {
      headers: { authorization: `Basic ${auth}` },
      signal: timeoutSignal(),
    });
    if (res.status === 200) {
      return report("ok", "Langfuse alcanzable y autenticado (`/api/public/projects` → 200).");
    }
    if (res.status === 401 || res.status === 403) {
      return report(
        "fail",
        `Langfuse devolvió ${res.status} → o las keys no son de este proyecto, o ` +
          `\`LANGFUSE_BASE_URL\` apunta a la región equivocada. Ojo: con el nombre ` +
          "`LANGFUSE_HOST` el SDK de JS ignora el valor y se va a la región UE por defecto, " +
          "y el error se lee igual que unas keys malas.",
      );
    }
    return report(
      "fail",
      `Langfuse devolvió un código inesperado: ${res.status} ${res.statusText}.`,
    );
  } catch (err) {
    return report(
      "fail",
      `No se pudo conectar con Langfuse (${(err as Error).message}). ${NETWORK_ERROR_HINT}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 8) Groq (opcional en bloques tempranos)
// ---------------------------------------------------------------------------
async function checkGroq(): Promise<CheckResult> {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) {
    return report(
      "warn",
      "`GROQ_API_KEY` está vacía → solo hace falta desde el bloque 6, no es un problema todavía.",
    );
  }

  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { authorization: `Bearer ${key}` },
      signal: timeoutSignal(),
    });
    if (res.status === 200) {
      return report("ok", "Groq alcanzable y autenticado (`/openai/v1/models` → 200).");
    }
    if (res.status === 401 || res.status === 403) {
      return report("fail", `Groq devolvió ${res.status} → la key de Groq es inválida o sin permisos.`);
    }
    return report("fail", `Groq devolvió un código inesperado: ${res.status} ${res.statusText}.`);
  } catch (err) {
    return report(
      "fail",
      `No se pudo conectar con Groq (${(err as Error).message}). ${NETWORK_ERROR_HINT}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Orquestación
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log("Diagnóstico de pre-vuelo — taller PromptOps\n");

  results.push(checkNodeVersion());

  const envFile = checkEnvFileExists();
  results.push(envFile);
  results.push(
    envFile.status === "ok"
      ? checkRequiredVars()
      : report(
          "fail",
          "Sin `.env` no se pueden validar las variables de entorno " +
            "(GOOGLE_GENERATIVE_AI_API_KEY, GROQ_API_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL).",
        ),
  );
  results.push(checkPolicyIndex());

  // Las cuatro llamadas de red van en paralelo (rápido), pero se guardan en un
  // orden fijo para que el reporte impreso sea idéntico en todas las máquinas.
  results.push(
    ...(await Promise.all([
      checkGeminiGeneration(),
      checkGeminiEmbedding(),
      checkLangfuse(),
      checkGroq(),
    ])),
  );

  for (const r of results) {
    console.log(`${ICONS[r.status]}  ${r.message}`);
  }

  const ok = results.filter((r) => r.status === "ok").length;
  const warn = results.filter((r) => r.status === "warn").length;
  const fail = results.filter((r) => r.status === "fail").length;

  console.log("\n— Resumen —");
  console.log(`✅ ${ok}   ⚠️  ${warn}   ❌ ${fail}`);

  if (fail > 0) {
    console.log("Veredicto: hay problemas bloqueantes, revisa los ❌ antes de empezar el taller.");
    process.exit(1);
  }
  if (warn > 0) {
    console.log("Veredicto: todo listo, con advertencias no bloqueantes (⚠️).");
    process.exit(0);
  }
  console.log("Veredicto: todo en orden, listo para empezar el taller.");
  process.exit(0);
}

main().catch((err) => {
  console.error(`❌  Error inesperado en el doctor: ${(err as Error).message}. ${NETWORK_ERROR_HINT}`);
  process.exit(1);
});
