export const FOOD_KEYWORDS = ["apero", "apéro", "pizza", "dinner", "breakfast", "lunch"];

export function text(value, fallback = "") {
    if (value == null) return fallback;
    return String(value);
}

export function containsFood(value) {
    const haystack = text(value).toLowerCase();
    return FOOD_KEYWORDS.some(keyword => haystack.includes(keyword));
}

export function firstDateLine(value) {
    return text(value).split("\n").find(Boolean) || "";
}

export function normalizeIsoDate(value) {
    const raw = firstDateLine(value).trim();
    if (!raw) return "";

    const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) {
        return [iso[1], iso[2].padStart(2, "0"), iso[3].padStart(2, "0")].join("-");
    }

    const dotted = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (dotted) {
        return [dotted[3], dotted[2].padStart(2, "0"), dotted[1].padStart(2, "0")].join("-");
    }

    return "";
}

export function normalizeDateRange(date, dateStart, dateEnd) {
    const legacy = text(date);
    if (legacy.includes("~~")) {
        const [start, end] = legacy.split("~~").map(part => normalizeIsoDate(part));
        return { dateStart: start, dateEnd: end || start };
    }

    const start = normalizeIsoDate(dateStart || legacy);
    const end = normalizeIsoDate(dateEnd || start);
    return { dateStart: start, dateEnd: end || start };
}

export function displayDate(dateStart, dateEnd) {
    if (!dateStart) return "";
    if (dateEnd && dateEnd !== dateStart) return `${dateStart} ~~ ${dateEnd}`;
    return dateStart;
}

export function toLocalDate(value) {
    const normalized = normalizeIsoDate(value);
    if (!normalized) return null;
    const [year, month, day] = normalized.split("-").map(Number);
    return new Date(year, month - 1, day);
}

export function startOfToday(now = new Date()) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function isTodayOrFuture(event, now = new Date()) {
    const { dateEnd } = normalizeDateRange(event?.date, event?.dateStart, event?.dateEnd);
    const end = toLocalDate(dateEnd);
    return Boolean(end && end >= startOfToday(now));
}

export function daysBetween(from, to) {
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.ceil((to - startOfToday(from)) / msPerDay);
}

export function normalizeEvent(event = {}) {
    const { dateStart, dateEnd } = normalizeDateRange(event.date, event.dateStart, event.dateEnd);
    const registrationRequired = Boolean(event.registrationRequired ?? event.reg_required);
    const closedEvent = Boolean(event.closedEvent ?? event.closed_event);
    const tags = Array.isArray(event.tags) ? [...event.tags] : [];

    if (dateEnd && dateStart !== dateEnd && !tags.includes("Event Series")) tags.push("Event Series");
    if (registrationRequired && !tags.includes("Registration Required")) tags.push("Registration Required");
    if (closedEvent && !tags.includes("Closed event")) tags.push("Closed event");
    if (event.entryType && !tags.includes(event.entryType)) tags.push(event.entryType);
    if (event.targetGroup && !tags.includes(event.targetGroup)) tags.push(event.targetGroup);
    if (event.category && !tags.includes(event.category)) tags.push(event.category);
    if (event.type && !tags.includes(event.type)) tags.push(event.type);
    if (event.waitList != null && !tags.includes("waitlist")) tags.push("waitlist");

    return {
        title: text(event.title, "Untitled event"),
        id: event.id ?? null,
        link: text(event.link),
        dateStart,
        dateEnd,
        date: displayDate(dateStart, dateEnd),
        times: text(event.times, "Time not specified"),
        location: text(event.location, "Location not specified"),
        organizer: text(event.organizer, "Organizer not specified"),
        orgType: text(event.orgType, "unknown"),
        description: text(event.description),
        tags,
        registrationRequired,
        reg_required: registrationRequired,
        closedEvent,
        closed_event: closedEvent,
        spotsLeft: event.spotsLeft ?? null,
        waitList: event.waitList ?? null,
        targetGroup: event.targetGroup ?? null,
        entryType: event.entryType ?? null,
        category: event.category ?? null,
        type: event.type ?? null,
    };
}
