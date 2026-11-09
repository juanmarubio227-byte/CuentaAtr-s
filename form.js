const STORAGE_KEY = "viernes13-countdown-settings";
const DEFAULT_TIME = "17:15";

const elements = {
	days: document.querySelector("#days"),
	hours: document.querySelector("#hours"),
	minutes: document.querySelector("#minutes"),
	seconds: document.querySelector("#seconds"),
	eventDate: document.querySelector("#event-date"),
	chosenTime: document.querySelector("#chosen-time-label"),
	form: document.querySelector("#time-form"),
	eventDateInput: document.querySelector("#event-date-input"),
	customTime: document.querySelector("#custom-time"),
	toast: document.querySelector("#toast"),
};

function formatDateInput(date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function isValidDate(value) {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [year, month, day] = value.split("-").map(Number);
	return formatDateInput(new Date(year, month - 1, day)) === value;
}

function getTargetDate(date, time) {
	const [year, month, day] = date.split("-").map(Number);
	const [hours, minutes] = time.split(":").map(Number);
	return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function readSettings() {
	try {
		const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
		const time = typeof saved.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(saved.time) ? saved.time : DEFAULT_TIME;
		const now = new Date();
		const savedTarget = isValidDate(saved.date) ? getTargetDate(saved.date, time) : null;
		const date = savedTarget && savedTarget > now ? saved.date : formatDateInput(getNextFridayThirteenth(now, time));
		return { date, time };
	} catch {
		return { date: formatDateInput(getNextFridayThirteenth(new Date(), DEFAULT_TIME)), time: DEFAULT_TIME };
	}
}

async function syncSettings() {
	try {
		const response = await fetch("/api/settings", { cache: "no-store" });
		if (!response.ok) return;
		const shared = await response.json();
		if (typeof shared.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(shared.time) || !isValidDate(shared.date)) return;
		if (shared.time === settings.time && shared.date === settings.date) return;
		settings = { date: shared.date, time: shared.time };
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
		} catch {
			// La sincronización sigue funcionando aunque el navegador bloquee el almacenamiento.
		}
		setSelectedTime(shared.time);
		elements.eventDateInput.value = shared.date;
		updateCountdown();
	} catch {
		// La cuenta atrás local sigue funcionando si el servidor no está disponible.
	}
}

let settings = readSettings();
let toastTimeout;

function setSelectedTime(time) {
	const preset = document.querySelector(`input[name="preset-time"][value="${time}"]`);
	if (preset) {
		preset.checked = true;
	} else {
		document.querySelector('input[name="preset-time"][value="custom"]').checked = true;
		elements.customTime.value = time;
	}
	elements.chosenTime.textContent = time;
}

function getNextFridayThirteenth(now, time) {
	const [hours, minutes] = time.split(":").map(Number);
	for (let monthOffset = 0; monthOffset <= 24; monthOffset += 1) {
		const monthStart = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
		const candidate = new Date(monthStart.getFullYear(), monthStart.getMonth(), 13, hours, minutes, 0, 0);
		if (candidate.getDay() === 5 && candidate.getTime() > now.getTime()) return candidate;
	}
	return new Date(now.getFullYear() + 2, now.getMonth(), 13, hours, minutes, 0, 0);
}

function updateCountdown() {
	const now = new Date();
	const target = getTargetDate(settings.date, settings.time);
	const remaining = Math.max(0, target.getTime() - now.getTime());
	const totalSeconds = Math.floor(remaining / 1000);
	const days = Math.floor(totalSeconds / 86400);
	const hours = Math.floor((totalSeconds % 86400) / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	elements.days.textContent = String(days).padStart(2, "0");
	elements.hours.textContent = String(hours).padStart(2, "0");
	elements.minutes.textContent = String(minutes).padStart(2, "0");
	elements.seconds.textContent = String(seconds).padStart(2, "0");
	elements.eventDate.textContent = new Intl.DateTimeFormat("es-ES", {
		weekday: "long",
		day: "numeric",
		month: "long",
		year: "numeric",
	}).format(target);
}

function showToast(message) {
	elements.toast.textContent = message;
	elements.toast.classList.add("visible");
	window.clearTimeout(toastTimeout);
	toastTimeout = window.setTimeout(() => elements.toast.classList.remove("visible"), 3500);
}

async function saveSettings(event) {
	event.preventDefault();
	const selected = document.querySelector('input[name="preset-time"]:checked')?.value;
	const time = selected === "custom" ? elements.customTime.value : selected;
	const date = elements.eventDateInput.value;
	if (!time || !isValidDate(date) || getTargetDate(date, time) <= new Date()) {
		showToast("Elige un día y una hora futuros.");
		return;
	}

	settings = { date, time };
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
	} catch {
		// La cuenta atrás sigue funcionando aunque el navegador bloquee el almacenamiento.
	}
	setSelectedTime(time);
	updateCountdown();
	try {
		const response = await fetch("/api/update", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(settings),
		});
		if (!response.ok) throw new Error("Actualización no disponible.");
		showToast(`Cuenta atrás actualizada a las ${time}.`);
	} catch {
		showToast("Se cambió aquí, pero no se pudo sincronizar.");
	}
}

setSelectedTime(settings.time);
elements.eventDateInput.value = settings.date;
elements.eventDateInput.min = formatDateInput(new Date());
updateCountdown();
window.setInterval(updateCountdown, 1000);
window.setInterval(syncSettings, 5000);
elements.form.addEventListener("submit", saveSettings);
syncSettings();
