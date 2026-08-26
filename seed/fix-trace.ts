#!/usr/bin/env tsx
/**
 * Vía de escape del bloque 5 — `npm run fix:trace`.
 *
 * Inserta las dos líneas de instrumentación en `src/chat.ts`, en los
 * marcadores `⬅ BLOQUE 5 · PEGA AQUÍ`, para quien se quedó atrás pegando a
 * mano. Mismo papel que `npm run seed:judge` en el bloque 6: el objetivo del
 * bloque es ver la traza, no pelear con un editor.
 *
 * Idempotente: si las líneas ya están, no hace nada y lo dice.
 */

import { readFileSync, writeFileSync } from "node:fs";

const ARCHIVO = "src/chat.ts";

/** Cada inserción: el marcador que la ancla y la línea que va debajo. */
const INSERCIONES = [
  { marcador: "⬅  BLOQUE 5 · PEGA AQUÍ (1 de 2)", linea: "    initTelemetry();" },
  { marcador: "⬅  BLOQUE 5 · PEGA AQUÍ (2 de 2)", linea: "    await shutdownTelemetry();" },
  {
    marcador: "⬅  BLOQUE 5 · el mismo flush va también aquí, en el camino de error.",
    linea: "    await shutdownTelemetry();",
  },
];

function main(): void {
  let contenido: string;
  try {
    contenido = readFileSync(ARCHIVO, "utf-8");
  } catch {
    console.error(
      `❌ No encuentro \`${ARCHIVO}\`. Corre este comando desde la raíz del repo del taller.`,
    );
    process.exit(1);
  }

  const lineas = contenido.split("\n");
  let insertadas = 0;
  let yaEstaban = 0;

  // Se recorre de abajo hacia arriba: insertar cambia los índices de las
  // líneas siguientes, y hacerlo al revés evita tener que recalcularlos.
  for (const { marcador, linea } of [...INSERCIONES].reverse()) {
    const i = lineas.findIndex((l) => l.includes(marcador));
    if (i === -1) {
      console.error(
        `❌ No encuentro el marcador "${marcador}" en \`${ARCHIVO}\`.\n` +
          "   Si editaste el archivo a mano, recupéralo con `git checkout src/chat.ts`.",
      );
      process.exit(1);
    }

    // El bloque de comentario del marcador puede tener varias líneas; la
    // inserción va tras la última línea comentada que le sigue.
    let j = i;
    while (j + 1 < lineas.length && /^\s*(\/\/|─|$)/.test(lineas[j + 1].trim() ? lineas[j + 1] : "//")) {
      if (!lineas[j + 1].trim().startsWith("//")) break;
      j++;
    }

    const siguienteCodigo = lineas.slice(j + 1, j + 6).join("\n");
    if (siguienteCodigo.includes(linea.trim())) {
      yaEstaban++;
      continue;
    }

    lineas.splice(j + 1, 0, "", linea);
    insertadas++;
  }

  if (insertadas === 0) {
    console.log("✓ Las líneas del bloque 5 ya estaban puestas — no toqué nada.");
    return;
  }

  writeFileSync(ARCHIVO, lineas.join("\n"));
  console.log(
    `✓ Instrumentación insertada en \`${ARCHIVO}\` (${insertadas} línea(s)` +
      `${yaEstaban ? `, ${yaEstaban} ya estaban` : ""}).\n\n` +
      "  Compruébalo con:  npm run chat -- --prompt v2 --trace\n" +
      "  Deberías ver «Instrumentación de Langfuse activa» y tu traza en Langfuse.",
  );
}

main();
