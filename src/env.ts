/**
 * Carga del `.env` y normalización de nombres de variables.
 *
 * Todo script del taller debe empezar llamando a `loadEnv()` en vez de a
 * `dotenv` directamente. Hace dos cosas que evitan fallos silenciosos:
 *
 * 1. Calla el banner publicitario que `dotenv` v17 imprime en stdout — el
 *    reporte del taller se proyecta en pantalla y tiene que salir limpio.
 *
 * 2. Acepta `LANGFUSE_HOST` como alias de `LANGFUSE_BASE_URL`.
 *
 * Sobre el punto 2, que es la trampa más cara del taller:
 * **el SDK de Langfuse para JavaScript v5 NO lee `LANGFUSE_HOST`.** Ese es el
 * nombre del SDK de Python. En JS/TS la variable es `LANGFUSE_BASE_URL` (con
 * alias `LANGFUSE_BASEURL`), y `LANGFUSE_HOST` no aparece en ninguna parte del
 * paquete. Si solo se define `LANGFUSE_HOST`, el cliente **no da error de
 * configuración**: se va silenciosamente al host por defecto (la región UE) y
 * devuelve
 *
 *     401 "Invalid credentials. Confirm that you've configured the correct host."
 *
 * — un mensaje que apunta a las keys cuando el problema es el nombre de la
 * variable. Ver `GOTCHAS.md` E-09 y G-09.
 */

import { config as loadDotenv } from "dotenv";

let loaded = false;

/** Carga `.env` (una sola vez) y normaliza los nombres de variables. */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

  loadDotenv({ quiet: true });

  const baseUrl = process.env.LANGFUSE_BASE_URL?.trim();
  const host = process.env.LANGFUSE_HOST?.trim();

  if (!baseUrl && host) {
    process.env.LANGFUSE_BASE_URL = host;
    console.warn(
      "⚠️  Encontré `LANGFUSE_HOST` pero no `LANGFUSE_BASE_URL`. El SDK de Langfuse para\n" +
        "    JavaScript solo lee `LANGFUSE_BASE_URL` — uso el valor de `LANGFUSE_HOST` por ti,\n" +
        "    pero renombra la variable en tu `.env` para evitar sorpresas.",
    );
  }
}

/** El host de Langfuse ya normalizado, sin barra final. */
export function langfuseBaseUrl(): string | undefined {
  return process.env.LANGFUSE_BASE_URL?.trim().replace(/\/$/, "");
}
