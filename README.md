# Cuenta atrás

La página no muestra referencias a Telegram. Al cambiar el día o la hora, el servidor guarda los nuevos valores compartidos y envía el aviso únicamente al chat privado configurado. No se guarda quién hizo el cambio.

## Configuración privada (una sola vez)

1. En Telegram, abre **@BotFather**, envía `/newbot` y sigue los pasos. Guarda el token en privado.
2. Crea `.env` a partir de `.env.example` y pega el token después de `TELEGRAM_BOT_TOKEN=`. No compartas ese archivo ni el token.
3. Instala Node.js 18 o posterior. En una terminal abierta en esta carpeta, ejecuta `npm run setup:telegram`.
4. Abre el enlace privado que aparece en la terminal y pulsa **Iniciar** en el bot.
5. Inicia la aplicación con `npm start` y abre `http://localhost:3000`.

La configuración del chat se guarda en `telegram-config.json`; la hora compartida, en `app-state.json`. Ambos archivos y `.env` están excluidos de Git. El servidor solo publica `index.html`, `form.js` y `style.css`, no los archivos de configuración.

## Uso desde otras ubicaciones

Para que las personas puedan cambiar la hora desde cualquier dispositivo, hay que desplegar esta aplicación con Node.js en un servidor accesible por HTTPS. Ese servidor debe permanecer activo, tener acceso saliente a `api.telegram.org` y almacenamiento persistente para los archivos de configuración y estado. No subas el token a una página estática ni al repositorio.