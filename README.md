# Michi 🐾

Michi es una mascota virtual para Windows: un gato esmoquin kawaii que vive en tu
escritorio, se mueve, parpadea, mueve la cola y te saluda con la patita. Haz clic en él
para hablar y conectarlo a **Google Gemini** (o cualquier API compatible con OpenAI).

![Michi](assets/vista_previa.png)

## Qué incluye

- **Mascota animada** con fotogramas vectoriales: cola en movimiento, parpadeo y saludo.
- **Tamaño compacto** (la mitad que la versión inicial): 116 px de gato.
- **Se mueve sola** por el escritorio cada cierto tiempo y duerme si la dejas tranquila.
- **Arrástrala a cualquier posición**, incluso entre monitores. La posición se recuerda.
- **Chat con IA** con respuestas en streaming, historial persistente y personalidad configurable.
- **Burbuja de diálogo** para leer sus respuestas sin abrir el chat.
- **Bandeja del sistema**, atajos globales e inicio automático con Windows.
- **Modo tarjeta** automático en equipos sin transparencia (GPU desactivada, escritorio remoto…).

## Requisitos

- Windows 10 u 11.
- Para desarrollo: Node.js 18 o superior.
- Una clave de API de Gemini (gratis en <https://aistudio.google.com/apikey>).

## Instalación y uso

```bash
npm install
npm start
```

La primera vez abre Ajustes con el engranaje ⚙ del chat (o clic derecho sobre la mascota →
**Ajustes…**), pega tu clave de Gemini, comprueba la conexión con **Probar conexión** y
guarda.

### Controles

| Acción | Cómo |
| --- | --- |
| Hablar con Michi | Clic en el gato (o doble clic en la bandeja) |
| Moverla | Arrastra el gato o cualquier punto de la tarjeta |
| Acariciarla | Doble clic en el gato |
| Menú rápido | Clic derecho sobre la mascota o la bandeja |
| Abrir/cerrar chat | `Ctrl + Shift + Espacio` |
| Mostrar/ocultar mascota | `Ctrl + Shift + M` |
| Cerrar el chat | `Esc` o la ✕ de la ventana |

Desde la bandeja también puedes **centrar la mascota**, hacerle cariño, mandarla a dormir
o activar **Iniciar con Windows**.

## Conectar la IA

Michi usa el formato de la API de OpenAI (`/chat/completions`), así que funciona con:

| Proveedor | URL base | Modelo de ejemplo |
| --- | --- | --- |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| OpenRouter | `https://openrouter.ai/api/v1` | `google/gemini-2.5-flash` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| Ollama (local) | `http://localhost:11434/v1` | `llama3.2` |

En Ajustes puedes elegir el proveedor, la clave, el modelo y una personalidad libre
(por ejemplo, «sarcástica pero cariñosa»). La clave y el historial se guardan **solo en tu
equipo**, en `%APPDATA%\Michi\`:

- `config.json`: ajustes y clave de API.
- `history.json`: últimas conversaciones.

## Modo silueta y transparencia

En condiciones normales Michi flota sobre el escritorio con fondo transparente y sombra suave.
Si Windows no permite composición con transparencia (por ejemplo, en escritorio remoto o con
la GPU desactivada), la app lo detecta y **recorta la ventana con la silueta exacta del gato y
la burbuja**: no hay tarjeta ni fondo, y todo lo que rodea al gato es click-through. El chat
sigue siendo una ventana normal.

Puedes forzar el modo manualmente:

```bash
npm start -- --solid        # silueta recortada (sin transparencia real)
npm start -- --transparent  # fondo transparente
```

También con la variable de entorno `MICHI_SOLID=1` o `MICHI_SOLID=0`.

## Crear el instalador

```bash
npm run dist    # instalador NSIS en dist/
npm run pack    # versión sin instalador en dist/win-unpacked/
```

El icono y el avatar se generan a partir del PNG original del gato:

```bash
npm run icons
```

## Estructura del proyecto

```
main.js                 Proceso principal: ventanas, bandeja, IA y persistencia
preload.js              Puente seguro entre Electron y las interfaces
src/main/ai.js          Cliente OpenAI-compatible con streaming
src/pet/                Ventana de la mascota (HTML/CSS/JS + motor de fotogramas)
src/chat/               Chat, ajustes y avatares
assets/01_parpadeo/     Fotogramas del parpadeo
assets/02_saludo/       Fotogramas del saludo con la patita
assets/03_cola/         Fotogramas del movimiento de cola
assets/avatar.png       Avatar para el chat
scripts/mock-ai.js      Servidor local de pruebas (IA simulada)
scripts/test-ai.js      Prueba del cliente de IA
```

## Pruebas

```bash
npm run test:ai     # arranca un servidor simulado y prueba streaming/errores
```

También puedes levantar el servidor simulado y apuntar la app a `http://127.0.0.1:8787/v1`
con cualquier clave para ver el chat funcionando sin gastar cuota.

## Notas

- Las respuestas de la IA se piden en 1-3 frases para que quepan en la burbuja; el chat
  muestra el texto completo.
- El ánimo del gato se deduce de una etiqueta al principio de cada respuesta
  (`[feliz]`, `[curioso]`, `[cariñoso]`…), que no se muestra al usuario.
- Si la mascota se queda oculta detrás de otra ventana, la app la vuelve a subir
  periódicamente mientras **Siempre visible** esté activo.
- Proyecto personal, sin telemetría ni servicios propios: todo va de tu equipo al
  proveedor de IA que elijas.
