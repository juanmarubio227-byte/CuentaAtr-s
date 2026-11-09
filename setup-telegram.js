const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, "telegram-config.json");

function loadEnvFile() {
	const envPath = path.join(ROOT, ".env");
	if (!fs.existsSync(envPath)) return;
	for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
		const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
		if (!match || match[1] in process.env) continue;
		process.env[match[1]] = match[2].replace(/^(?:"(.*)"|'(.*)')$/, (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted);
	}
}

async function telegramRequest(token, method, payload = {}) {
	const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
	const result = await response.json();
	if (!response.ok || !result.ok) throw new Error(result.description || "Telegram rechazó la solicitud.");
	return result.result;
}

async function main() {
	loadEnvFile();
	const token = process.env.TELEGRAM_BOT_TOKEN;
	if (!token || token.includes("pega_aqui")) throw new Error("Añade primero el token en el archivo .env.");

	const bot = await telegramRequest(token, "getMe");
	const code = crypto.randomBytes(12).toString("hex");
	console.log("Abre este enlace en tu Telegram y pulsa Iniciar. No lo compartas:");
	console.log(`https://t.me/${bot.username}?start=${code}`);
	console.log("Esperando confirmación del chat privado…");

	let offset = 0;
	const deadline = Date.now() + 5 * 60 * 1000;
	while (Date.now() < deadline) {
		const updates = await telegramRequest(token, "getUpdates", { offset, timeout: 0, allowed_updates: ["message"] });
		for (const update of updates) {
			offset = Math.max(offset, update.update_id + 1);
			const message = update.message;
			const expectedStart = new RegExp(`^/start(?:@${bot.username})?\\s+${code}$`, "i");
			if (message?.chat?.type !== "private" || !expectedStart.test(message.text || "")) continue;

			await fs.promises.writeFile(CONFIG_FILE, JSON.stringify({ chatId: String(message.chat.id) }, null, 2), { mode: 0o600 });
			await telegramRequest(token, "sendMessage", {
				chat_id: message.chat.id,
				text: "Conexión privada activada. Recibirás aquí los avisos de cambios de la cuenta atrás.",
			});
			console.log("Listo. Este chat recibirá los avisos privados.");
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}
	throw new Error("No se confirmó la conexión en cinco minutos. Vuelve a ejecutar la configuración.");
}

main().catch((error) => {
	console.error(`No se pudo configurar Telegram: ${error.message}`);
	process.exitCode = 1;
});