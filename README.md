# Taller PromptOps

**De la intuición a las métricas con LLM-as-a-Judge** — taller práctico de 3 horas.

Construyes, instrumentas y **mides** un chatbot de soporte bancario (BanCentral GT, ficticio).
La tesis: *genera con un modelo, júzgalo con otro más fuerte y una rúbrica explícita.*

## Qué leer, y cuándo

| Documento | Cuándo |
|---|---|
| **`SETUP.md`** | **Antes del taller.** Crear las tres cuentas, instalar Node 22, clonar, `npm install`. |
| Este `README.md` | Al arrancar, y como referencia de comandos durante el taller. |
| **`BLOQUE-5.md`** | Durante el bloque 5, cuando el instructor lo indique. |
| `RUNBOOK.md` | Es el guion **del instructor**. No hace falta leerlo para participar. |

## Requisitos

- **Node 22 LTS** (el repo trae `.nvmrc`)
- Tres cuentas gratuitas: Google AI Studio, Langfuse Cloud y Groq.
  **Las *keys* se generan en el salón**, no antes — ver `SETUP.md`.

## Arranque

```bash
npm install
cp .env.example .env    # pega tus keys cuando el taller te lo pida
npm run doctor          # comprueba Node, dependencias y credenciales
```

`npm run doctor` es la red de seguridad: hace llamadas **reales** a los tres servicios, no solo
comprueba que las variables existan. Antes de tener keys marcará ❌ en las comprobaciones de
credenciales — eso es lo normal en el pre-work.

## Los comandos, bloque por bloque

Un comando por bloque. **Cada uno funciona sin haber corrido el anterior**: si te pierdes,
salta directo al comando del bloque en el que va el resto del salón.

| Bloque | Comando | Qué hace |
|---|---|---|
| 1 | `npm run chat -- --naked` | El modelo crudo: sin system prompt, sin RAG. |
| 2 | `npm run chat -- --prompt v1` | Con system prompt, sin RAG. |
| 3 | `npm run chat -- --prompt v1 --rag` | Con RAG, imprimiendo los chunks recuperados. |
| 4 | `npm run seed:prompts` | Sube las 3 variantes a Langfuse; luego cambias la etiqueta desde la UI. |
| 5 | `npm run chat -- --prompt v2 --trace` | Instrumentado. **Antes hay que pegar 2 líneas — ver `BLOQUE-5.md`.** |
| 6 | `npm run seed:judge` | Vía de escape si configurar el juez en la UI se atasca. |
| 8 | `npm run seed:dataset` · `npm run experiment` | Sube los 12 casos y corre las 3 variantes contra ellos. |

Opciones útiles de la CLI:

```bash
npm run chat -- --help                 # todas las opciones
npm run chat -- -m "tu pregunta"       # cambia la consulta del cliente
npm run chat -- --prompt v2 --rag      # v1 | v2 | v3 | production
```

Las variantes se llaman `v1-terse`, `v2-empathetic` y `v3-compliant`; `v1`, `v2` y `v3` sirven
como atajo. Sin `--prompt`, la CLI usa `v3`.

## Si algo va mal

| Síntoma | Qué es | Qué hacer |
|---|---|---|
| El comando tarda y luego dice que la API no respondió | La capa gratuita de Gemini se cuelga de vez en cuando **sin devolver error**. El repo reintenta 3 veces. | **Vuelve a correr el mismo comando.** No está roto. |
| En Langfuse no aparece tu traza o tu puntaje | Langfuse tarda **30-60 s** en mostrarlos. | **Refresca antes de concluir que falló.** |
| `401 Invalid credentials` en Langfuse | Casi siempre es el **nombre de la variable**: es `LANGFUSE_BASE_URL`, no `LANGFUSE_HOST`. | Revisa tu `.env` contra `.env.example`. |
| `429` o cuota excedida en Gemini | El límite es **por día y por modelo**. | Pon `GENERATION_MODEL=gemini-3.1-flash-lite` en tu `.env`: es otro cupo entero. |

Para lo demás, `npm run doctor` suele decir qué falta, en español.
