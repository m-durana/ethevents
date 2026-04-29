import test from "node:test";
import assert from "node:assert/strict";
import {
    displayDate,
    isTodayOrFuture,
    normalizeDateRange,
    normalizeEvent,
    normalizeIsoDate,
} from "../event-utils.js";

test("normalizes loose ISO and dotted dates", () => {
    assert.equal(normalizeIsoDate("2026-4-9"), "2026-04-09");
    assert.equal(normalizeIsoDate("09.04.2026 18:15"), "2026-04-09");
});

test("normalizes legacy multi-date event strings", () => {
    assert.deepEqual(normalizeDateRange("2026-04-09 ~~ 2026-04-11"), {
        dateStart: "2026-04-09",
        dateEnd: "2026-04-11",
    });
    assert.equal(displayDate("2026-04-09", "2026-04-11"), "2026-04-09 ~~ 2026-04-11");
});

test("keeps today events visible by comparing calendar dates", () => {
    const now = new Date(2026, 3, 29, 22, 30);
    assert.equal(isTodayOrFuture({ date: "2026-04-29" }, now), true);
    assert.equal(isTodayOrFuture({ date: "2026-04-28" }, now), false);
});

test("uses end date for multi-day future filtering", () => {
    const now = new Date(2026, 3, 29, 12, 0);
    assert.equal(isTodayOrFuture({ date: "2026-04-27 ~~ 2026-04-29" }, now), true);
    assert.equal(isTodayOrFuture({ date: "2026-04-27 ~~ 2026-04-28" }, now), false);
});

test("normalizes missing provider fields without throwing", () => {
    const event = normalizeEvent({ orgType: "vis", reg_required: true });
    assert.equal(event.title, "Untitled event");
    assert.equal(event.location, "Location not specified");
    assert.equal(event.times, "Time not specified");
    assert.equal(event.registrationRequired, true);
    assert.equal(event.reg_required, true);
    assert.ok(event.tags.includes("Registration Required"));
});
