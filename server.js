import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import got from 'got';
import * as cheerio from 'cheerio';

const app = express();
const PORT = process.env.PORT || 2096;

// CORS & JSON middleware
app.use(cors({
    origin: 'https://akuta.xyz',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// Cache config
const CACHE_TTL = {
    ethEvents: 120 * 60 * 1000,
    ethCareers: 120 * 60 * 1000,
    visEvents: 120 * 60 * 1000,
    amivEvents: 120 * 60 * 1000,
};
let cache = {};

// Cache utilities
function getCachedData(key) {
    const now = Date.now();
    if (cache[key]?.data && (now - cache[key].lastFetch < CACHE_TTL[key])) {
        return cache[key].data;
    }
    return null;
}
function updateCache(key, data) {
    cache[key] = { data, lastFetch: Date.now() };
}

// URLs & keywords
const url_ethevents = "https://idapps.ethz.ch/pcm-pub-services/v2/entries?rs-first=0&rs-size=9999&lang=en&filters[0].cals=1&filters[0].min-till-end=0&filters[0].max-till-start=999&filters[0].trg-grps=1,4,5,2&client-id=anonymous";
const url_ethcareers  = 'https://ethcareer.ch/Umbraco/iTalent/Events/ListPaging';
const url_amivevents  = 'https://amiv.ethz.ch/_next/data';
const url_visevents   = "https://vis.ethz.ch/en/events/";
const foodKeywords    = ["apero", "apéro", "pizza", "dinner", "breakfast", "lunch"];
function API_log(response) {
    const d = new Date();
    console.log(`Made API Call (${d.toLocaleTimeString()}.${d.getMilliseconds()}):`, response.url);
}

// === HELPER FUNCTIONS ===

async function getAMIVBuildID() {
    try {
        const res = await fetch('https://amiv.ethz.ch/en/events', { credentials: 'include' });
        API_log(res);
        const text = await res.text();
        const match = text.match(/"buildId":"([^"]+)"/);
        return match?.[1] || null;
    } catch (err) {
        console.error("Error fetching AMIV buildId:", err);
        return null;
    }
}

async function getETHCareerCsrfToken() {
    try {
        const res = await fetch('https://ethcareer.ch/en/events/', { credentials: 'include' });
        API_log(res);
        const text = await res.text();
        const match = text.match(/var apiCsrfToken = '([^']+)'/);
        return match?.[1] || null;
    } catch (err) {
        console.error("Error fetching ETH Careers CSRF:", err);
        return null;
    }
}

async function getVISCsrfToken() {
    try {
        const res = await fetch('https://vis.ethz.ch/en/events/', { credentials: 'include' });
        API_log(res);
        const text = await res.text();
        const match = text.match(/<input type="hidden" name="csrfmiddlewaretoken" value="([^"]+)"\/?>/i);
        return match?.[1] || null;
    } catch (err) {
        console.error("Error fetching VIS CSRF:", err);
        return null;
    }
}

function getLocation(entry) {
    const locObj = entry.location || {};
    const type = Object.keys(locObj)[0];
    const loc   = locObj[type] || {};
    switch (type) {
        case "address":
            return Object.entries(loc)
                .filter(([k]) => !["reg-area-code","country-code","country-desc","loc-plan-url"].includes(k))
                .map(([,v]) => v).join(", ");
        case "internal":
            return `${loc["area-desc"]||""}, ${[loc.building,loc.floor,loc.room].filter(Boolean).join(" ")}`;
        case "online":
            return loc.online;
        default:
            return null;
    }
}

function getDatesAndTimes(entry) {
    const info = entry["date-time-indication"] || {};
    const dates = new Set(), times = new Set();
    if (info["date-with-times-array"]) {
        info["date-with-times-array"].forEach(d => {
            dates.add(d.date);
            times.add(d["all-day"] ? "All day" : `${d["time-from"]} - ${d["time-to"]}`);
        });
    }
    return [Array.from(dates).join("\n"), Array.from(times).join("\n")];
}

// === REFRESH FUNCTIONS ===

async function refreshEthEvents() {
    try {
        const res  = await fetch(url_ethevents);
        API_log(res);
        const json = await res.json();
        const list = json["entry-array"]
            .filter(e => {
                const t = e.content?.title?.toLowerCase()  || "";
                const d = e.content?.description?.toLowerCase() || "";
                return foodKeywords.some(k => t.includes(k) || d.includes(k));
            })
            .map(e => ({
                title:       e.content?.title,
                id:          e.id,
                location:    getLocation(e),
                description: e.content?.description,
                organizer:   e.organizers?.["ou-array"]?.[0]?.["name-short"]
                    || e.organizers?.["series-ou-array"]?.[0]?.["name-short"],
                targetGroup: e.classification?.["target-group-desc"],
                entryType:   e.classification?.["entry-type-desc"],
                date:        getDatesAndTimes(e)[0],
                times:       getDatesAndTimes(e)[1],
                orgType:     "ethevents",
            }));
        updateCache('ethEvents', list);
    } catch (err) {
        console.error("refreshEthEvents failed:", err);
    }
}

async function refreshVisEvents() {
    try {
        const token = await getVISCsrfToken();
        if (!token) throw new Error("no VIS CSRF");
        const headers = { cookie: `csrftoken=${token}`, "user-agent":"Mozilla/5.0" };
        const res     = await fetch(url_visevents, { headers });
        API_log(res);
        const $       = cheerio.load(await res.text());
        const cards   = $('.event-column').toArray();
        const events  = cards.map(elem => {
            const $e = $(elem);
            const title = $e.find('.card-title h5').text().trim();
            if (!title) return null;
            const startRaw = $e.find('p:contains("Event start time")').text().replace('Event start time ','');
            const endRaw   = $e.find('p:contains("Event end time")').text().replace('Event end time ','');
            const [sd, st] = startRaw.split(' '), [ed, et] = endRaw.split(' ');
            const formatDate = d => { const [day,mo,yr]=d.split('.'); return `${yr}-${mo}-${day}`; };
            const sDate = formatDate(sd), eDate = formatDate(ed);
            const date  = sDate!==eDate ? `${sDate} ~~ ${eDate}` : sDate;
            const times = date.includes("~~") ? "All day" : `${st} - ${et}`;
            const link  = 'https://vis.ethz.ch'+$e.find('a').attr('href');
            const spots = $e.find('p:contains("Remaining places")').text().replace('Remaining places: ','') || null;
            const wait  = $e.find('p:contains("on waitlist")').text().replace(' on waitlist','') || null;
            const req   = !$e.find('p:contains("doesn\'t need registration")').length;
            return { title, link, date, times, spotsLeft: spots, waitList: wait, reg_required: req,
                organizer:"VIS", location:"Probably CAB", orgType:"vis", description:"" };
        }).filter(Boolean);

        const detailed = await Promise.all(events.map(async ev => {
            try {
                const resp = await fetch(ev.link, { headers });
                API_log(resp);
                const html = await resp.text();
                const $d   = cheerio.load(html);
                let desc="";
                $d('div.col-md-11').children().each((i,el)=>{
                    const t = $d(el);
                    if (t.is('h4') && t.text().toLowerCase().includes('event organisers')) return false;
                    desc += t.text().trim()+" ";
                });
                desc=desc.trim();
                if (foodKeywords.some(k=>desc.toLowerCase().includes(k))) return {...ev,description:desc};
            } catch(e){ console.error("VIS detail failed:",e) }
            return null;
        }));

        updateCache('visEvents', detailed.filter(x=>x));
    } catch (err) {
        console.error("refreshVisEvents failed:", err);
    }
}

async function refreshAmivEvents() {
    try {
        const buildId = await getAMIVBuildID();
        if (!buildId) throw new Error("no AMIV buildId");
        const res   = await fetch(`${url_amivevents}/${buildId}/de/events.json`);
        API_log(res);
        const json  = await res.json();
        const items = Object.values(json.pageProps.initialState.events.items).map(i=>i.data);
        const list  = items
            .filter(e=>{
                const t=e.title_en.toLowerCase(), d=(e.description_en||"").toLowerCase();
                return foodKeywords.some(k=>t.includes(k)||d.includes(k));
            })
            .map(e=>({
                title:e.title_en, location:e.location, description:e.description_en,
                organizer:"AMIV", id:e._id,
                date:e.time_start.split('T')[0],
                times:`${e.time_start.split('T')[1].slice(0,5)} - ${e.time_end.split('T')[1].slice(0,5)}`,
                spotsLeft:e.spots!=null?(e.spots-e.signup_count):null,
                reg_required:e.spots!=null, orgType:"amiv"
            }));
        updateCache('amivEvents', list);
    } catch (err) {
        console.error("refreshAmivEvents failed:", err);
    }
}

async function refreshEthCareers() {
    try {
        const token = await getETHCareerCsrfToken();
        if (!token) throw new Error("no ETH Careers CSRF");
        const post = await got.post(url_ethcareers, {
            responseType:'json',
            headers:{
                'Accept':'application/json, text/plain, */*',
                'Content-Type':'application/json;charset=UTF-8',
                'Requestverificationtoken':token
            },
            json:{}
        });
        API_log(post);
        const events = post.body.results;
        const detailed = await Promise.all(events.map(async ev=>{
            try {
                const url = `https://ethcareer.ch/Umbraco/iTalent/Events/Detail?id=${ev.id}&updateCounter=true`;
                const resp = await fetch(url, { headers:{'Requestverificationtoken':token} });
                API_log(resp);
                const js = await resp.json();
                const desc = js.description||"";
                if (foodKeywords.some(k=>desc.toLowerCase().includes(k)) && !ev.isOnlineEvent) {
                    return {
                        title:ev.name, id:ev.id,
                        location:ev.location||"Not specified",
                        description:desc,
                        closed_event:ev.closedEvent,
                        category:ev.category?.name||"",
                        organizer:ev.organizerName||"Not specified",
                        date:ev.dateStart.split('T')[0]===ev.dateEnd.split('T')[0]
                            ? ev.dateStart.split('T')[0]
                            : `${ev.dateStart.split('T')[0]} ~~ ${ev.dateEnd.split('T')[0]}`,
                        times:`${ev.dateStart.split('T')[1].slice(0,5)} - ${ev.dateEnd.split('T')[1].slice(0,5)}`,
                        reg_required:js.hasRegistrationForm,
                        orgType:"ethcareers"
                    };
                }
            } catch(e) {
                console.error(`refreshEthCareers detail failed ${ev.id}:`,e);
            }
            return null;
        }));
        updateCache('ethCareers', detailed.filter(x=>x));
    } catch (err) {
        console.error("refreshEthCareers failed:", err);
    }
}

// === ROUTES ===

app.get('/api/food/eth-events', async (req, res) => {
    const data = getCachedData('ethEvents');
    if (data) return res.json(data);
    await refreshEthEvents();
    res.json(cache.ethEvents.data);
});

app.get('/api/food/vis-events', async (req, res) => {
    const data = getCachedData('visEvents');
    if (data) return res.json(data);
    await refreshVisEvents();
    res.json(cache.visEvents.data);
});

app.get('/api/food/amiv-events', async (req, res) => {
    const data = getCachedData('amivEvents');
    if (data) return res.json(data);
    await refreshAmivEvents();
    res.json(cache.amivEvents.data);
});

app.get('/api/food/eth-careers', async (req, res) => {
    const data = getCachedData('ethCareers');
    if (data) return res.json(data);
    await refreshEthCareers();
    res.json(cache.ethCareers.data);
});

app.get('/api/food/last-updated', (req, res) => {
    res.json({
        ethEvents:  cache.ethEvents?.lastFetch || null,
        ethCareers: cache.ethCareers?.lastFetch || null,
        amivEvents: cache.amivEvents?.lastFetch || null,
        visEvents:  cache.visEvents?.lastFetch || null,
    });
});

// === INITIAL CACHE & RE-REFRESH ===

;(async function initialCache() {
    await Promise.all([
        refreshEthEvents(),
        refreshVisEvents(),
        refreshAmivEvents(),
        refreshEthCareers(),
    ]);
    console.log('Initial cache fill complete.');
})();

setInterval(() => {
    console.log('Periodic cache refresh…');
    refreshEthEvents();
    refreshVisEvents();
    refreshAmivEvents();
    refreshEthCareers();
}, 2 * 60 * 60 * 1000);

// Start server
app.listen(PORT, '127.0.0.1', () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
