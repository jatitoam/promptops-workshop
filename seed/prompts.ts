/**
 * Sube el prompt `support-bot` (tipo chat) a Langfuse con sus cuatro
 * etiquetas: v1-terse, v2-empathetic, v3-compliant y production (alias de
 * v3-compliant).
 *
 * El bloque 4 del taller depende de esto: el participante cambia la
 * etiqueta activa desde la UI de Langfuse y ve al bot cambiar de
 * comportamiento sin tocar el repo.
 *
 * NO sube el prompt del juez (`judge/support-rubric`) — esa rúbrica se
 * configura dentro de Langfuse en la tarea 2.4, no aquí.
 *
 * Correr con:
 *   npm run seed:prompts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LangfuseClient } from "@langfuse/client";

import { loadEnv, langfuseBaseUrl } from "../src/env.ts";

loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "..", "prompts");

// Debe coincidir con el modelo generador usado en src/chat.ts.
const GENERATOR_MODEL = "gemini-3.5-flash-lite";

function load(filename: string): string {
  return readFileSync(join(PROMPTS_DIR, filename), "utf-8").trim();
}

async function createSupportBotVariant(
  langfuse: LangfuseClient,
  label: string,
  systemPrompt: string,
  userTemplate: string,
): Promise<void> {
  const result = await langfuse.prompt.create({
    name: "support-bot",
    type: "chat",
    prompt: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userTemplate },
    ],
    labels: [label],
    config: { model: GENERATOR_MODEL, temperature: 0.3 },
  });
  console.log(`✓ support-bot @ ${label} (versión ${result.version})`);
}

async function main(): Promise<void> {
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    console.error(
      "✗ Faltan las credenciales de Langfuse (LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY).\n" +
        "  Se sacan en el bloque 4: creá tu propio proyecto en Langfuse → Settings → API Keys,\n" +
        "  y pegalas en tu .env antes de correr este script.",
    );
    process.exit(1);
  }

  const langfuse = new LangfuseClient();

  const userTemplate = load("_user-template.txt");
  const v1 = load("v1-terse.txt");
  const v2 = load("v2-empathetic.txt");
  const v3 = load("v3-compliant.txt");

  console.log("Subiendo variantes de support-bot a Langfuse...\n");

  await createSupportBotVariant(langfuse, "v1-terse", v1, userTemplate);
  await createSupportBotVariant(langfuse, "v2-empathetic", v2, userTemplate);
  await createSupportBotVariant(langfuse, "v3-compliant", v3, userTemplate);

  // "production" apunta al mismo contenido que v3-compliant (alias).
  await createSupportBotVariant(langfuse, "production", v3, userTemplate);

  await langfuse.shutdown();

  const base = langfuseBaseUrl() ?? "(host no configurado)";
  console.log(
    `\nListo. Verificá en la UI de Langfuse (${base}) → Prompts → support-bot.\n` +
      "Deberías ver 4 etiquetas activas (v1-terse, v2-empathetic, v3-compliant, production),\n" +
      "con v2-empathetic y v3-compliant apuntando a system prompts distintos, y production\n" +
      "apuntando al mismo contenido que v3-compliant.",
  );
}

main().catch((error: unknown) => {
  console.error("✗ Error al subir los prompts a Langfuse:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
