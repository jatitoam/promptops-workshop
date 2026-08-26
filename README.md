# Taller PromptOps

**De la intuición a las métricas con LLM-as-a-Judge** — taller práctico de 3 horas.

Construyes, instrumentas y **mides** un chatbot de soporte bancario (BanCentral GT).
La tesis: *genera con un modelo, júzgalo con otro más fuerte y una rúbrica explícita.*

> 🚧 Repo en construcción. La guía de arranque en 5 minutos vive aquí; la preparación
> previa en `SETUP.md` y el guion del instructor en `RUNBOOK.md`.

## Requisitos

- **Node 22 LTS** (ver `.nvmrc`)
- Tres cuentas gratuitas: Google AI Studio, Langfuse Cloud y Groq.
  Las *keys* se generan en el salón — ver `SETUP.md`.

## Arranque

```bash
npm install
cp .env.example .env    # y pega tus keys cuando el taller te lo pida
npm run doctor
```
