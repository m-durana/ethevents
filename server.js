import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import * as cheerio from "cheerio";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { containsFood, normalizeEvent, normalizeIsoDate, text } from "./event-utils.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 2096);
const HOST = process.env.HOST || "127.0.0.1";
const CLIENT_ROOT = process.env.CLIENT_ROOT || __dirname;
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 15000);
const CACHE_TTL_MS = 120 * 60 * 1000;

const ETH_EVENTS_URL = "https://idapps.ethz.ch/pcm-pub-services/v2/entries?rs-first=0&rs-size=9999&lang=en&filters[0].cals=1&filters[0].min-till-end=0&filters[0].max-till-start=999&filters[0].trg-grps=1,4,5,2&client-id=anonymous";
const ETH_CAREERS_LIST_URL = "https://ethcareer.ch/Umbraco/iTalent/Events/ListPaging";
const AMIV_DATA_BASE_URL = "https://amiv.ethz.ch/_next/data";
const VIS_EVENTS_URL = "https://vis.ethz.ch/en/events/";

const providerState = {
    ethEvents: createProviderState(),
    ethCareers: createProviderState(),
    amivEvents: createProviderState(),
    visEvents: createProviderState(),
};

const providers = {
    ethEvents: { route: "/eth-events", refresh: fetchEthEvents },
    ethCareers: { route: "/eth-careers", refresh: fetchEthCareers },
    amivEvents: { route: "/amiv-events", refresh: fetchAmivEvents },
    visEvents: { route: "/vis-events", refresh: fetchVisEvents },
};

app.use(cors({
    origin: getCorsOrigin(),
    methods: ["GET"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json());
app.use("/api", rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_PER_MINUTE || 120),
    standardHeaders: "draft-7",
    legacyHeaders: false,
}));

for (const [key, provider] of Object.entries(providers)) {
    app.get(`/api/food${provider.route}`, (req, res) => handleProviderRequest(key, provider.refresh, res));
}

app.get("/api/food/last-updated", (req, res) => {
    res.json(Object.fromEntries(
        Object.entries(providerState).map(([key, state]) => [key, state.lastSuccess])
    ));
});

app.get("/api/food/status", (req, res) => {
    res.json(Object.fromEntries(
        Object.entries(providerState).map(([key, state]) => [key, publicProviderStatus(state)])
    ));
});

app.use("/food", express.static(CLIENT_ROOT, {
    extensions: ["html"],
    index: "index.html",
}));
app.get("/food/*path", (req, res) => {
    res.sendFile(path.join(CLIENT_ROOT, "index.html"));
});

;(async function initialCache() {
    await Promise.allSettled(
        Object.entries(providers).map(([key, provider]) => refreshProvider(key, provider.refresh))
    );
    console.log("Initial cache fill complete.");
})();

setInterval(() => {
    console.log("Periodic cache refresh...");
    for (const [key, provider] of Object.entries(providers)) {
        refreshProvider(key, provider.refresh).catch(error => {
            console.error(`${key} refresh failed:`, error);
        });
    }
}, CACHE_TTL_MS);

app.listen(PORT, HOST, () => {
    console.log(`Server is running on http://${HOST}:${PORT}`);
});

function getCorsOrigin() {
    if (!process.env.CORS_ORIGIN) return true;
    return process.env.CORS_ORIGIN.split(",").map(origin => origin.trim()).filter(Boolean);
}

function createProviderState() {
    return {
        data: [],
        lastFetch: null,
        lastSuccess: null,
        lastFailure: null,
        error: null,
        count: 0,
    };
}

function publicProviderStatus(state) {
    return {
        lastFetch: state.lastFetch,
        lastSuccess: state.lastSuccess,
        lastFailure: state.lastFailure,
        error: state.error,
        count: state.count,
        hasData: state.data.length > 0,
    };
}

function isCacheFresh(state) {
    return Boolean(state.lastSuccess && Date.now() - state.lastSuccess < CACHE_TTL_MS);
}

async function handleProviderRequest(key, refresh, res) {
    const state = providerState[key];
    if (isCacheFresh(state)) return res.json(state.data);

    try {
        const data = await refreshProvider(key, refresh);
        return res.json(data);
    } catch (error) {
        if (state.data.length > 0) {
            return res.json(state.data);
        }

        return res.status(503).json({
            provider: key,
            events: [],
            error: `Unable to refresh ${key}`,
            detail: error.message,
        });
    }
}

async function refreshProvider(key, refresh) {
    const state = providerState[key];
    state.lastFetch = Date.now();

    try {
        const events = await refresh();
        state.data = events.map(normalizeEvent).filter(event => event.dateStart);
        state.lastSuccess = Date.now();
        state.error = null;
        state.count = state.data.length;
        return state.data;
    } catch (error) {
        state.lastFailure = Date.now();
        state.error = error.message;
        throw error;
    }
}

async function request(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(options.timeoutMs || FETCH_TIMEOUT_MS),
        headers: {
            "user-agent": "Mozilla/5.0 FoodFinder/1.0",
            ...options.headers,
        },
    });

    console.log(`Made API Call (${new Date().toLocaleTimeString()}): ${response.url}`);

    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText} from ${response.url}`);
    }

    return response;
}

async function fetchJson(url, options) {
    return request(url, options).then(response => response.json());
}

async function fetchText(url, options) {
    return request(url, options).then(response => response.text());
}

async function getAmivBuildId() {
    const html = await fetchText("https://amiv.ethz.ch/en/events");
    const match = html.match(/"buildId":"([^"]+)"/);
    if (!match) throw new Error("AMIV buildId was not found");
    return match[1];
}

async function getEthCareerCsrfToken() {
    const html = await fetchText("https://ethcareer.ch/en/events/");
    const match = html.match(/var apiCsrfToken = '([^']+)'/);
    if (!match) throw new Error("ETH Careers CSRF token was not found");
    return match[1];
}

async function getVisCsrfToken() {
    const html = await fetchText(VIS_EVENTS_URL);
    const match = html.match(/<input type="hidden" name="csrfmiddlewaretoken" value="([^"]+)"\/?>/i);
    if (!match) throw new Error("VIS CSRF token was not found");
    return match[1];
}

function getEthLocation(entry) {
    const locObj = entry.location || {};
    const type = Object.keys(locObj)[0];
    const loc = locObj[type] || {};

    if (type === "address") {
        return Object.entries(loc)
            .filter(([key]) => !["reg-area-code", "country-code", "country-desc", "loc-plan-url"].includes(key))
            .map(([, value]) => value)
            .filter(Boolean)
            .join(", ");
    }

    if (type === "internal") {
        return `${loc["area-desc"] || ""}, ${[loc.building, loc.floor, loc.room].filter(Boolean).join(" ")}`.replace(/^,\s*/, "");
    }

    if (type === "online") return loc.online;
    return "";
}

function getEthDatesAndTimes(entry) {
    const info = entry["date-time-indication"] || {};
    const dates = new Set();
    const times = new Set();

    for (const dateInfo of info["date-with-times-array"] || []) {
        const date = normalizeIsoDate(dateInfo.date);
        if (date) dates.add(date);
        times.add(dateInfo["all-day"] ? "All day" : `${dateInfo["time-from"] || ""} - ${dateInfo["time-to"] || ""}`.trim());
    }

    return {
        dates: Array.from(dates),
        times: Array.from(times).filter(Boolean).join("\n"),
    };
}

async function fetchEthEvents() {
    const json = await fetchJson(ETH_EVENTS_URL);
    return (json["entry-array"] || [])
        .filter(entry => containsFood(entry.content?.title) || containsFood(entry.content?.description))
        .map(parseEthEvent);
}

function parseEthEvent(entry) {
    const { dates, times } = getEthDatesAndTimes(entry);
    return {
        title: entry.content?.title,
        id: entry.id,
        location: getEthLocation(entry),
        description: entry.content?.description,
        organizer: entry.organizers?.["ou-array"]?.[0]?.["name-short"]
            || entry.organizers?.["series-ou-array"]?.[0]?.["name-short"],
        targetGroup: entry.classification?.["target-group-desc"],
        entryType: entry.classification?.["entry-type-desc"],
        dateStart: dates[0],
        dateEnd: dates.at(-1) || dates[0],
        times,
        orgType: "ethevents",
    };
}

async function fetchVisEvents() {
    const token = await getVisCsrfToken();
    const headers = { cookie: `csrftoken=${token}` };
    const html = await fetchText(VIS_EVENTS_URL, { headers });
    const $ = cheerio.load(html);
    const events = $(".event-column").toArray().map(element => parseVisEvent($, element)).filter(Boolean);
    const detailed = await Promise.all(events.map(event => enrichVisEvent(event, headers)));
    return detailed.filter(Boolean);
}

function parseVisEvent($, element) {
    const card = $(element);
    const title = card.find(".card-title h5").text().trim();
    if (!title) return null;

    const startRaw = card.find('p:contains("Event start time")').text().replace("Event start time ", "").trim();
    const endRaw = card.find('p:contains("Event end time")').text().replace("Event end time ", "").trim();
    const [startDate, startTime] = startRaw.split(/\s+/);
    const [endDate, endTime] = endRaw.split(/\s+/);
    const href = card.find("a").attr("href") || "";

    return {
        title,
        link: href.startsWith("http") ? href : `https://vis.ethz.ch${href}`,
        dateStart: normalizeIsoDate(startDate),
        dateEnd: normalizeIsoDate(endDate || startDate),
        times: startTime && endTime ? `${startTime} - ${endTime}` : "Time not specified",
        spotsLeft: parseOptionalNumber(card.find('p:contains("Remaining places")').text()),
        waitList: parseOptionalNumber(card.find('p:contains("on waitlist")').text()),
        registrationRequired: !card.find('p:contains("doesn\'t need registration")').length,
        organizer: "VIS",
        location: "Probably CAB",
        orgType: "vis",
        description: "",
    };
}

async function enrichVisEvent(event, headers) {
    try {
        const html = await fetchText(event.link, { headers });
        const $ = cheerio.load(html);
        let description = "";

        $("div.col-md-11").children().each((index, element) => {
            const node = $(element);
            if (node.is("h4") && node.text().toLowerCase().includes("event organisers")) return false;
            description += `${node.text().trim()} `;
        });

        const trimmed = description.trim();
        if (containsFood(event.title) || containsFood(trimmed)) {
            return { ...event, description: trimmed };
        }
    } catch (error) {
        console.error(`VIS detail failed for ${event.link}:`, error.message);
    }

    return null;
}

async function fetchAmivEvents() {
    const buildId = await getAmivBuildId();
    const json = await fetchJson(`${AMIV_DATA_BASE_URL}/${buildId}/de/events.json`);
    const items = Object.values(json.pageProps?.initialState?.events?.items || {}).map(item => item.data);

    return items
        .filter(event => containsFood(event.title_en) || containsFood(event.description_en))
        .map(parseAmivEvent);
}

function parseAmivEvent(event) {
    const start = text(event.time_start);
    const end = text(event.time_end);

    return {
        title: event.title_en,
        location: event.location,
        description: event.description_en,
        organizer: "AMIV",
        id: event._id,
        link: event._id ? `https://amiv.ethz.ch/en/events/signup/${event._id}/` : "",
        dateStart: normalizeIsoDate(start.split("T")[0]),
        dateEnd: normalizeIsoDate(end.split("T")[0] || start.split("T")[0]),
        times: formatTimeRange(start, end),
        spotsLeft: event.spots != null ? event.spots - (event.signup_count || 0) : null,
        registrationRequired: event.spots != null,
        orgType: "amiv",
    };
}

async function fetchEthCareers() {
    const token = await getEthCareerCsrfToken();
    const list = await fetchJson(ETH_CAREERS_LIST_URL, {
        method: "POST",
        headers: {
            Accept: "application/json, text/plain, */*",
            "Content-Type": "application/json;charset=UTF-8",
            Requestverificationtoken: token,
        },
        body: JSON.stringify({}),
    });

    const detailed = await Promise.all((list.results || []).map(event => enrichEthCareerEvent(event, token)));
    return detailed.filter(Boolean);
}

async function enrichEthCareerEvent(event, token) {
    try {
        const detail = await fetchJson(`https://ethcareer.ch/Umbraco/iTalent/Events/Detail?id=${event.id}&updateCounter=true`, {
            headers: { Requestverificationtoken: token },
        });
        const description = detail.description || "";

        if (!containsFood(description) || event.isOnlineEvent) return null;
        return parseEthCareerEvent(event, detail, description);
    } catch (error) {
        console.error(`ETH Careers detail failed for ${event.id}:`, error.message);
        return null;
    }
}

function parseEthCareerEvent(event, detail, description) {
    const start = text(event.dateStart);
    const end = text(event.dateEnd || event.dateStart);

    return {
        title: event.name,
        id: event.id,
        link: event.id ? `https://ethcareer.ch/en/events/detail/?id=${event.id}` : "",
        location: event.location || "Not specified",
        description,
        closedEvent: event.closedEvent,
        category: event.category?.name || "",
        organizer: event.organizerName || "Not specified",
        dateStart: normalizeIsoDate(start.split("T")[0]),
        dateEnd: normalizeIsoDate(end.split("T")[0]),
        times: formatTimeRange(start, end),
        registrationRequired: detail.hasRegistrationForm,
        orgType: "ethcareers",
    };
}

function formatTimeRange(start, end) {
    const startTime = text(start).split("T")[1]?.slice(0, 5);
    const endTime = text(end).split("T")[1]?.slice(0, 5);
    if (!startTime && !endTime) return "Time not specified";
    if (!endTime || startTime === endTime) return startTime;
    return `${startTime} - ${endTime}`;
}

function parseOptionalNumber(value) {
    const match = text(value).match(/\d+/);
    return match ? Number(match[0]) : null;
}
