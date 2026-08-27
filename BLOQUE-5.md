# Bloque 5 — Instrumentar

Dos líneas. Se pegan en `src/chat.ts`, en los dos marcadores que dicen
`⬅ BLOQUE 5 · PEGA AQUÍ`.

## Antes de pegar nada

```bash
npm run chat -- --prompt v2 --trace
```

Corre y responde con normalidad, pero avisa de que **no creó ninguna traza**.
Abre tu proyecto de Langfuse: está vacío. Ese es el punto de partida.

## 1 de 2 — encender la instrumentación

En `src/chat.ts`, busca `⬅ BLOQUE 5 · PEGA AQUÍ (1 de 2)` y pega **debajo del
comentario**:

```ts
initTelemetry();
```

## 2 de 2 — vaciar los spans antes de salir

Busca `⬅ BLOQUE 5 · PEGA AQUÍ (2 de 2)` y pega **debajo del comentario**:

```ts
await shutdownTelemetry();
```

Hay un segundo marcador unas líneas más abajo, en el camino de error. Pega ahí
lo mismo: si el comando falla, la traza de ese fallo es justo la que más quieres
conservar.

## Después de pegar

```bash
npm run chat -- --prompt v2 --trace
```

Ahora dice que la instrumentación está activa. En Langfuse aparece el árbol:

```
support_chat
├── rag_retrieve         → embeddings gemini-embedding-001
├── mcp_account_lookup
└── invoke_agent → step 1 → chat gemini-3.5-flash-lite
```

**Checkpoint del bloque:** ves tu propia traza completa, en tu propio proyecto.

Fíjate también en la línea `Origen del prompt: langfuse`. Pediste `--prompt v2`,
no `production`, y aun así el prompt lo sirvió Langfuse por etiqueta: desde que
pegaste tus credenciales en el bloque 4, **todas** las variantes se resuelven así
y el `.txt` del repo quedó solo como respaldo.

> ⏳ **La traza tarda entre 30 y 60 segundos en aparecer.** Langfuse Cloud es
> eventualmente consistente: el comando ya terminó y en la UI todavía no hay
> nada. **Refresca antes de concluir que falló** — es el error de diagnóstico
> más común de este bloque, y lleva a "arreglar" algo que no está roto.

## Por qué la segunda línea no es burocracia

Si pegas solo la primera, el turno se instrumenta igual... y la traza **se pierde
en silencio**. Sin error, sin aviso: simplemente no aparece nada en Langfuse.

El proceso termina antes de que el exportador alcance a enviar los spans. Es el
fallo más común al instrumentar un script de un solo turno, y por eso el bloque
te hace pegarlo a mano en vez de traerlo ya hecho.

## Si te quedaste atrás

```bash
npm run fix:trace
```

Deja `src/chat.ts` con las dos líneas puestas, exactamente donde van. Úsalo sin
culpa: el objetivo del bloque es ver la traza, no pelear con un editor.
