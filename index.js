import { FOOD_KEYWORDS, daysBetween, isTodayOrFuture, normalizeEvent, toLocalDate } from "./event-utils.js";

document.addEventListener("DOMContentLoaded", async function () {
    const apiBase = getApiBase();
    const endpoints = [
        ["ethEvents", "eth-events"],
        ["ethCareers", "eth-careers"],
        ["amivEvents", "amiv-events"],
        ["visEvents", "vis-events"],
    ];

    let allEvents = [];
    const filterDropdownBtn = document.getElementById("filter-dropdown-btn");
    const filterCheckboxes = document.querySelectorAll(".filter-checkbox");
    const customDropdown = document.getElementById("filter-dropdown");

    filterDropdownBtn.addEventListener("click", function (event) {
        event.stopPropagation();
        customDropdown.classList.toggle("open");
    });

    document.addEventListener("click", function (event) {
        if (!customDropdown.contains(event.target)) {
            customDropdown.classList.remove("open");
        }
    });

    filterCheckboxes.forEach(checkbox => {
        checkbox.addEventListener("change", () => {
            applyFilters();
            updateLegendVisibility();
        });
    });

    await updateLastUpdatedTime();
    setInterval(updateLastUpdatedTime, 5 * 60 * 1000);

    allEvents = await loadEvents(endpoints);
    applyFilters();
    updateLegendVisibility();

    async function updateLastUpdatedTime() {
        try {
            const response = await fetch(`${apiBase}last-updated`);
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            const data = await response.json();
            document.getElementById("last-updated-time").textContent = formatTimestamp(maxTimestamp(Object.values(data)));
        } catch (error) {
            console.error("Error fetching last updated times:", error);
            document.getElementById("last-updated-time").textContent = "Unavailable";
        }
    }

    async function loadEvents(endpointList) {
        const results = await Promise.allSettled(endpointList.map(async ([key, path]) => {
            const response = await fetch(`${apiBase}${path}`);
            const data = await response.json().catch(() => []);
            if (!response.ok) throw new Error(`${key}: ${response.status} ${response.statusText}`);
            return Array.isArray(data) ? data : data.events || [];
        }));

        const events = [];
        results.forEach((result, index) => {
            if (result.status === "fulfilled") {
                events.push(...result.value.map(normalizeEvent));
            } else {
                console.error(`Error fetching ${endpointList[index][0]}:`, result.reason);
            }
        });

        return events
            .filter(event => event.dateStart && isTodayOrFuture(event))
            .sort((a, b) => toLocalDate(a.dateStart) - toLocalDate(b.dateStart));
    }

    function displayEvents(events) {
        const eventWrapper = document.getElementById("event-wrapper");
        eventWrapper.replaceChildren();

        events.forEach(event => {
            const eventContainer = document.createElement("div");
            eventContainer.className = "event-container";
            eventContainer.style.backgroundColor = eventColor(event.orgType);

            const eventLink = document.createElement("a");
            eventLink.className = "event-link";
            eventLink.target = "_blank";
            eventLink.rel = "noopener noreferrer";
            eventLink.href = eventLinkUrl(event);

            const eventInnerContent = document.createElement("div");
            eventInnerContent.className = "event-inner-content";
            eventInnerContent.appendChild(createDateBox(event));
            eventInnerContent.appendChild(createEventDetails(event));

            eventLink.appendChild(eventInnerContent);
            eventContainer.appendChild(eventLink);
            eventWrapper.appendChild(eventContainer);
        });
    }

    function createDateBox(event) {
        const date = toLocalDate(event.dateStart);
        const dateBox = document.createElement("div");
        dateBox.className = "event-date-box";

        const day = document.createElement("div");
        day.className = "event-date-day";
        day.textContent = date ? String(date.getDate()) : "?";

        const monthYear = document.createElement("div");
        monthYear.className = "event-date-month-year";
        appendTextDiv(monthYear, date ? date.toLocaleString("default", { weekday: "short" }) : "");
        appendTextDiv(monthYear, date ? date.toLocaleString("default", { month: "short" }) : "");
        appendTextDiv(monthYear, date ? String(date.getFullYear()) : "");

        const beginsIn = document.createElement("div");
        beginsIn.className = "event-begins-in";
        beginsIn.textContent = relativeDateLabel(event);

        dateBox.append(day, monthYear, beginsIn);
        return dateBox;
    }

    function createEventDetails(event) {
        const eventDetails = document.createElement("div");
        eventDetails.className = "event-details";

        const eventTags = document.createElement("div");
        eventTags.className = "event-tags";
        getEventTags(event).forEach(tag => {
            const tagElement = document.createElement("span");
            tagElement.className = "event-tag";
            tagElement.textContent = tag;
            eventTags.appendChild(tagElement);
        });

        const eventTitle = document.createElement("div");
        eventTitle.className = "event-title";
        eventTitle.textContent = event.title;

        eventDetails.append(eventTags, eventTitle, createInfoTable(event));
        return eventDetails;
    }

    function createInfoTable(event) {
        const table = document.createElement("table");
        table.className = "event-info-table";
        addInfoRow(table, "Time", cleanTime(event.times));
        addInfoRow(table, "Location", event.location.split(",").map(part => part.trim()).filter(Boolean));
        addInfoRow(table, "Organizer", event.organizer);
        return table;
    }

    function addInfoRow(table, label, value) {
        const row = document.createElement("tr");
        const header = document.createElement("th");
        const cell = document.createElement("td");
        header.textContent = label;

        if (Array.isArray(value)) {
            value.forEach((part, index) => {
                if (index > 0) cell.appendChild(document.createElement("br"));
                cell.appendChild(document.createTextNode(part));
            });
        } else {
            cell.textContent = value || "Not specified";
        }

        row.append(header, cell);
        table.appendChild(row);
    }

    function updateLegendVisibility() {
        const orgLegendMapping = {
            ethevents: "legend-ethevents",
            ethcareers: "legend-ethcareers",
            amiv: "legend-amiv",
            vis: "legend-vis",
        };

        Object.keys(orgLegendMapping).forEach(orgType => {
            const checkbox = document.getElementById(`org-${orgType}`);
            const legendItem = document.getElementById(orgLegendMapping[orgType]);
            legendItem.style.display = checkbox.checked ? "flex" : "none";
        });
    }

    function applyFilters() {
        const orgCheckboxes = Array.from(filterCheckboxes)
            .filter(checkbox => checkbox.id.startsWith("org-"));
        const selectedOrgs = Array.from(filterCheckboxes)
            .filter(checkbox => checkbox.checked && checkbox.id.startsWith("org-"))
            .map(checkbox => checkbox.value);

        const unselectedTags = Array.from(filterCheckboxes)
            .filter(checkbox => !checkbox.checked && checkbox.id.startsWith("tag-"))
            .map(checkbox => normalizeFilterValue(checkbox.value));

        let filteredEvents = allEvents.filter(event => {
            return orgCheckboxes.length === 0 || selectedOrgs.includes(event.orgType);
        });

        if (unselectedTags.length > 0) {
            filteredEvents = filteredEvents.filter(event => {
                const eventTags = getEventTags(event).map(normalizeFilterValue);
                return !unselectedTags.some(tag => eventTags.some(eventTag => tagMatchesFilter(eventTag, tag)));
            });
        }

        displayEvents(filteredEvents);
    }
});

function getApiBase() {
    const configured = window.FOOD_FINDER_API_BASE || "/api/food/";
    return configured.endsWith("/") ? configured : `${configured}/`;
}

function formatTimestamp(timestamp) {
    if (!timestamp) return "Loading...";
    const ageMs = Date.now() - new Date(timestamp).getTime();
    if (ageMs < 0) return "Just now";
    if (ageMs < 60000) return "Just now";
    if (ageMs < 3600000) return `${Math.floor(ageMs / 60000)} minutes ago`;
    if (ageMs < 7200000) return "1 hour ago";
    return `${Math.floor(ageMs / 3600000)} hours ago`;
}

function maxTimestamp(values) {
    const timestamps = values.filter(Boolean).map(Number);
    return timestamps.length ? Math.max(...timestamps) : null;
}

function eventColor(orgType) {
    return {
        ethevents: "#e7eaef",
        ethcareers: "#e0f7fa",
        amiv: "#fbcebf",
        vis: "#fbf6b9",
    }[orgType] || "#ffffff";
}

function eventLinkUrl(event) {
    const base = event.link || fallbackEventLink(event);
    const keyword = FOOD_KEYWORDS.find(keyword =>
        event.title.toLowerCase().includes(keyword) || event.description.toLowerCase().includes(keyword)
    );

    if (!base || !keyword) return base || "#";
    return `${base}#:~:text=${encodeURIComponent(keyword)}`;
}

function fallbackEventLink(event) {
    if (event.orgType === "ethevents" && event.id) {
        const slug = event.title.toLowerCase().replace(/[^0-9a-zA-Z]+/g, "-").replace(/^-|-$/g, "");
        return `https://ethz.ch/en/news-and-events/events/details.${slug}.${event.id}.html`;
    }

    if (event.orgType === "ethcareers" && event.id) return `https://ethcareer.ch/en/events/detail/?id=${event.id}`;
    if (event.orgType === "amiv" && event.id) return `https://amiv.ethz.ch/en/events/signup/${event.id}/`;
    return "";
}

function relativeDateLabel(event) {
    const now = new Date();
    const start = toLocalDate(event.dateStart);
    const end = toLocalDate(event.dateEnd || event.dateStart);
    if (!start) return "";

    const startDelta = daysBetween(now, start);
    const endDelta = end ? daysBetween(now, end) : startDelta;

    if (startDelta <= 0 && endDelta >= 0) return startDelta === 0 ? "Is today" : `Ends in ${endDelta} days`;
    if (startDelta === 1) return "Begins tomorrow";
    if (startDelta < 28) return `Begins in ${startDelta} days`;
    if (startDelta < 35) return "Begins in a month";
    return `Begins in ${Math.ceil(startDelta / 30)} months`;
}

function appendTextDiv(parent, value) {
    const div = document.createElement("div");
    div.textContent = value;
    parent.appendChild(div);
}

function cleanTime(value) {
    return String(value || "Time not specified").replace(/:\d{4}$/, "");
}

function getEventTags(event) {
    const tags = Array.isArray(event.tags) ? [...event.tags] : [];
    if (event.spotsLeft != null) tags.push(`${event.spotsLeft} spots left`);
    if (event.waitList != null) tags.push(`${event.waitList} on waitlist`);
    return [...new Set(tags.filter(Boolean))];
}

function normalizeFilterValue(value) {
    return String(value || "").trim().toLowerCase();
}

function tagMatchesFilter(eventTag, filterTag) {
    return eventTag === filterTag || (filterTag === "waitlist" && eventTag.includes("waitlist"));
}
