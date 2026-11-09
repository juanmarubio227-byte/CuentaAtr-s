const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const STATE_FILE = path.join(ROOT, "app-state.json");
const TELEGRAM_CONFIG_FILE = path.join(ROOT, "telegram-config.json");
const DEFAULT_TIME = "17:15";
const PUBLIC_FILES = new Map([
	["/", "index.html"],
	["/index.html", "index.html"],
	["/form.js", "form.js"],
	["/style.css", "style.css"],
]);

function loadEnvFile() {
	const envPath = path.join(ROOT, ".env");
	if (!fs.existsSync(envPath)) return;
	for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
		const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
		if (!match || match[1] in process.env) continue;
		process.env[match[1]] = match[2].replace(/^(?:"(.*)"|'(.*)')$/, (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted);
	}
}

function readJson(filePath, fallback) {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return fallback;
	}
}

function writeJson(filePath, value) {
	return fs.promises.writeFile(filePath, JSON.stringify(value, null, 2), { mode: 0o600 });
}

loadEnvFile();
let state = readJson(STATE_FILE, { time: DEFAULT_TIME });
const telegramConfig = readJson(TELEGRAM_CONFIG_FILE, {});
const chatId = String(process.env.TELEGRAM_CHAT_ID || telegramConfig.chatId || "");
const rateLimits = new Map();

function sendJson(response, statusCode, data) {
	response.writeHead(statusCode, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff",
	});
	response.end(JSON.stringify(data));
}

function isRateLimited(request) {
	const key = request.socket.remoteAddress || "unknown";
	const now = Date.now();
	const current = rateLimits.get(key);
	if (!current || now - current.startedAt >= 60_000) {
		rateLimits.set(key, { startedAt: now, count: 1 });
		return false;
	}
	current.count += 1;
	return current.count > 8;
}

function readRequestBody(request) {
	return new Promise((resolve, reject) => {
		let body = "";
		request.on("data", (chunk) => {
			body += chunk;
			if (body.length > 10_000) {
				reject(new Error("Request body too large"));
				request.destroy();
			}
		});
		request.on("end", () => {
			try {
				resolve(JSON.parse(body || "{}"));
			} catch {
				reject(new Error("Invalid request body"));
			}
		});
		request.on("error", reject);
	});
}

async function sendTelegramNotice(date, time) {
	if (!process.env.TELEGRAM_BOT_TOKEN || !chatId) return;
	const token = process.env.TELEGRAM_BOT_TOKEN;
	const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			chat_id: chatId,
			text: `Se actualizó la cuenta atrás. Nueva fecha: ${date}. Nueva hora: ${time}.`,
		}),
	});
	const result = await response.json();
	if (!response.ok || !result.ok) throw new Error(result.description || "Telegram request failed");
}

async function handleApi(request, response, requestUrl) {
	if (request.method === "GET" && requestUrl.pathname === "/api/settings") {
		return sendJson(response, 200, { date: state.date || "", time: state.time || DEFAULT_TIME });
	}

	if (request.method !== "POST" || requestUrl.pathname !== "/api/update") {
		return sendJson(response, 404, { error: "Not found" });
	}

	const origin = request.headers.origin;
	if (origin && new URL(origin).host !== request.headers.host) {
		return sendJson(response, 403, { error: "Request not allowed" });
	}
	if (isRateLimited(request)) return sendJson(response, 429, { error: "Try again later" });

	let body;
	try {
		body = await readRequestBody(request);
	} catch {
		return sendJson(response, 400, { error: "Invalid request" });
	}
	const validDate = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) && (() => {
		const [year, month, day] = body.date.split("-").map(Number);
		const parsed = new Date(Date.UTC(year, month - 1, day));
		return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
	})();
	if (!validDate || typeof body.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)) {
		return sendJson(response, 400, { error: "Invalid date or time" });
	}

	state = { date: body.date, time: body.time };
	await writeJson(STATE_FILE, state);
	try {
		await sendTelegramNotice(body.date, body.time);
	} catch (error) {
		// El error queda en el servidor; no se muestra en la página pública.
		console.error("No se pudo enviar el aviso privado.", error.message);
	}
	return sendJson(response, 200, { ok: true, time: state.time });
}

const contentTypes = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
};

const server = http.createServer(async (request, response) => {
	try {
		const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
		if (requestUrl.pathname.startsWith("/api/")) return await handleApi(request, response, requestUrl);
		if (request.method !== "GET" && request.method !== "HEAD") return sendJson(response, 405, { error: "Method not allowed" });

		const fileName = PUBLIC_FILES.get(requestUrl.pathname);
		if (!fileName) return sendJson(response, 404, { error: "Not found" });
		const filePath = path.join(ROOT, fileName);
		const file = await fs.promises.readFile(filePath);
		response.writeHead(200, {
			"Content-Type": contentTypes[path.extname(filePath)],
			"X-Content-Type-Options": "nosniff",
			"Referrer-Policy": "no-referrer",
		});
		response.end(request.method === "HEAD" ? undefined : file);
	} catch (error) {
		if (response.headersSent || response.destroyed) return;
		if (error.code === "ENOENT") return sendJson(response, 404, { error: "Not found" });
		console.error(error);
		sendJson(response, 500, { error: "Internal server error" });
	}
});

server.listen(PORT, () => {
	console.log(`Cuenta atrás disponible en http://localhost:${PORT}`);
	if (!process.env.TELEGRAM_BOT_TOKEN || !chatId) {
		console.log("Completa la configuración privada de Telegram (consulta README.md).");
	}
});