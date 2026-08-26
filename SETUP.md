# SETUP — Taller PromptOps

Qué hacer **antes** de llegar al taller. Léelo entero: son quince minutos ahora que
evitan perder media hora del salón después.

> La preparación de la sala y las máquinas (red, proyector, enchufes) no está aquí —
> la llevan los organizadores por separado.

El taller son **3 horas continuas, sin recesos**. Todo lo que se pueda resolver antes
de sentarse (cuentas, instalación, red) se resuelve antes. Si algo de esto se descubre
en vivo, se pierde tiempo de taller para todo el grupo, no solo para quien lo descubre.

---

Construyes, instrumentas y **mides** un chatbot de soporte bancario (BanCentral GT,
ficticio) en TypeScript, con Gemini como generador y Groq como juez, medido en
Langfuse. Todo gratuito.

### 1. Crea las tres cuentas (con verificación de correo)

| Cuenta | URL |
|---|---|
| Google AI Studio | `aistudio.google.com` |
| Langfuse Cloud | `cloud.langfuse.com` |
| Groq | `console.groq.com` |

Regístrate y **confirma el correo de verificación** en las tres. Sin esto no puedes
avanzar el día del taller.

### 🚨 2. La advertencia más importante: usa una cuenta Gmail PERSONAL

Muchas cuentas de correo institucional (`@tuuniversidad.edu` y similares) **no pueden
crear API keys en Google AI Studio**. Es la fricción número uno de arranque del taller:
si la descubres en el salón, se cae el primer bloque y arrastra a todo lo demás.

**Compruébalo desde casa, ahora:**

1. Entra a `aistudio.google.com/apikey` con la cuenta que planeas usar el día del taller.
2. Verifica que el botón para crear una key **existe y responde** (no hace falta crear
   la key todavía — ver el punto 3).
3. Si tu cuenta institucional lo bloquea, usa o crea una cuenta de Gmail personal
   (`@gmail.com`) y regístrala en las tres plataformas de la tabla anterior.

### ⚠️ 3. Las keys NO se generan ahora — se generan en el salón, en tres momentos distintos

Esto es contraintuitivo: no te falta nada si terminas el pre-work sin ninguna key
pegada en ningún lado. Las tres se generan **en vivo, durante el taller**, cada una
cuando el bloque correspondiente la necesita:

| Key | Se genera en | Variable en `.env` |
|---|---|---|
| Google AI Studio | **Bloque 1** | `GOOGLE_GENERATIVE_AI_API_KEY` |
| Langfuse Cloud | **Bloque 4** | `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` |
| Groq | **Bloque 6** | `GROQ_API_KEY` (además, pegada dentro de Langfuse) |

¿Por qué no antes? Meter tres flujos de registro de API en los primeros 20 minutos es
la forma más confiable de perder media hora del taller. Escalonadas, cada key llega
cuando ya viste para qué sirve.

### 4. Instala Node 22, clona el repo, instala dependencias

```bash
# Node 22 LTS — el repo trae .nvmrc, usa nvm si lo tienes:
nvm install
nvm use

git clone https://github.com/jatitoam/promptops-workshop.git
cd promptops-workshop

npm install
```

### 5. Corre el diagnóstico de pre-vuelo

```bash
npm run doctor
```

`doctor` corre 8 comprobaciones e imprime cada una con ✅ / ⚠️ / ❌. **En esta etapa
(sin `.env` todavía) es normal y esperado que fallen las comprobaciones de
credenciales** — no tienes keys, ese es justo el punto. Lo que **sí** tiene que salir
en verde ahora mismo, en frío:

- ✅ Node.js ≥ 22
- Dependencias instaladas sin errores en `npm install`

Y es normal ver en rojo o amarillo, antes del taller:

- ❌ `.env` no existe todavía (no lo crees aún, o créalo vacío con `cp .env.example .env`
  y déjalo así — las tres comprobaciones de credenciales seguirán en ❌ hasta el taller)
- ⚠️ `data/policy-index.json` todavía no existe (se genera durante el taller)
- ❌ Gemini / Langfuse / Groq inalcanzables o sin autenticar (sin keys, es esperado)

Al final imprime un resumen (`✅ N   ⚠️ N   ❌ N`) y un veredicto. **El veredicto en rojo
antes del taller no es un problema tuyo** — es la foto correcta de "todavía no tengo
keys". Lo que importa del pre-work es que Node y las dependencias ya estén en verde,
para no perder tiempo de bloque 1 instalando cosas.

### ⚠️ El nombre de variable con trampa

Es **`LANGFUSE_BASE_URL`**, no `LANGFUSE_HOST`. `LANGFUSE_HOST` es el nombre que usa el
SDK de Python; el SDK de JavaScript que usa este repo lo ignora en silencio, se va a la
región europea por defecto, y devuelve un **401 "Invalid credentials"** que parece un
problema de keys y no lo es. El repo tolera ambos nombres, pero el `.env.example` ya
trae el correcto — no lo renombres.

### Checklist final — participantes

- [ ] Cuenta creada y verificada: Google AI Studio
- [ ] Cuenta creada y verificada: Langfuse Cloud
- [ ] Cuenta creada y verificada: Groq
- [ ] Confirmado que `aistudio.google.com/apikey` deja crear una key con la cuenta que
      usaré (es una cuenta Gmail personal, no institucional)
- [ ] Node 22 LTS instalado (`node -v`)
- [ ] Repo clonado, `npm install` corrido sin errores
- [ ] `npm run doctor` corrido al menos una vez (rojo por falta de keys = esperado)
- [ ] Laptop con cargador — son 3 horas seguidas

---

## Cosas medidas que conviene saber de antemano

- **Cada participante usa su propia key gratuita — nunca una compartida.** Los límites
  de la capa gratuita son *por cuenta*. Una key compartida para todo el salón se agota
  en minutos, no en horas.
- **La API gratuita de Gemini a veces se cuelga sin devolver error.** El repo reintenta
  solo y avisa cuando lo hace. Si ves ese aviso, la respuesta es repetir el comando —
  no está roto.
- **Langfuse Cloud tarda entre 30 y 60 segundos en mostrar una traza o un puntaje
  nuevo.** Es eventualmente consistente: el comando ya terminó y la UI todavía no
  muestra nada. **Refresca antes de concluir que algo falló** — es la fuente más común
  de "arreglar" algo que en realidad no estaba roto.

---

## Si algo falla (pre-work)

**No puedo crear una key en Google AI Studio.**
Casi siempre es una cuenta institucional. Cambia a una cuenta Gmail personal — ver la
advertencia destacada más arriba.

**`node -v` muestra una versión menor a 22.**
Instala Node 22 LTS. Con `nvm` disponible en el repo (`.nvmrc`): `nvm install && nvm use`.

**`npm install` falla.**
Confirma que estás en Node 22 (`node -v`) y que tienes salida a internet normal (npm
no está en la lista de hosts restringidos del taller, así que si otras instalaciones de
npm te funcionan, esta también debería). Si persiste, borra `node_modules` y
`package-lock.json` local y reintenta, o repórtalo al instructor antes del taller.

**`npm run doctor` sale en rojo.**
Antes del taller, en rojo por falta de credenciales (`.env` vacío o inexistente) es
**el resultado esperado** — ver el paso 5 de arriba. Si en cambio falla en la
comprobación de Node o de dependencias, revisa los dos puntos anteriores de esta
lista.
