/*
 * Check for src/content/todo/streak.ts against a planner export (the
 * { "Aug 30": { "<title>": { due_at, submission, planner_override, ... } } }
 * JSON), where every item is known to have been done on time:
 *
 *     npm run check:streak -- ~/Downloads/canvas-planner.json [--now 2026-11-13T12:00:00]
 *
 * Expects no misses and an unbroken streak from the first due date to today,
 * then removes things one at a time and expects the streak to break on that
 * item's day. Last, saves checkpoints on different days and checks that
 * counting on from one matches counting from scratch. Days are Pacific time
 * unless TZ is set.
 */
process.env.TZ ||= "America/Los_Angeles";

import { readFileSync } from "node:fs";
import { classify, computeStreak, continueStreak } from "../src/content/todo/streak.ts";

const args = process.argv.slice(2);
const nowFlag = args.indexOf("--now");
const now = nowFlag >= 0 ? new Date(args.splice(nowFlag, 2)[1]) : new Date();
const [path] = args;
if (!path) {
    console.error("usage: npm run check:streak -- <planner-export.json> [--now <date>]");
    process.exit(1);
}

const items = Object.values(JSON.parse(readFileSync(path, "utf8"))).flatMap((day) =>
    Object.entries(day).map(([title, raw]) => ({
        title,
        dueAt: raw.due_at,
        submission: raw.submission,
        override: raw.planner_override,
    })),
);

const day = (date) => { const d = new Date(date); d.setHours(0, 0, 0, 0); return d; };
const daysBetween = (from, to) => Math.round((day(to) - day(from)) / 86_400_000) + 1;
const label = (date) => day(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });

let failures = 0;
function expect(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failures++;
    console.log(`${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

// --- The export as-is: everything was on time. ---
const statuses = items.map((item) => ({ item, status: classify(item, now) }));
const counts = {};
for (const { status } of statuses) counts[status] = (counts[status] || 0) + 1;
console.log(`${items.length} items as of ${now.toLocaleString()} (${process.env.TZ}):`, counts);
for (const { item, status } of statuses) {
    if (status === "missed") console.log(`      missed: ${item.title} (due ${label(item.dueAt)})`);
}

const counted = statuses.filter(({ status }) => status !== "ignored" && status !== "pending");
const first = counted.map(({ item }) => new Date(item.dueAt)).sort((a, b) => a - b)[0];
const full = daysBetween(first, now);
expect("no missed items", counts.missed || 0, 0);
expect(`unbroken ${full}-day streak since ${label(first)}`, computeStreak(items, now), { current: full, longest: full });

// --- Take one thing away and the streak should break on that item's day. ---
/* The streak expected after a single miss on `due`'s day. */
function brokenOn(due) {
    const after = due < day(now) ? daysBetween(addDay(due), now) : 0;
    const before = daysBetween(first, due) - 1;
    return { current: after, longest: Math.max(before, after) };
}
function changeOne(title, change) {
    return items.map((item) => (item.title === title ? change(structuredClone(item)) : item));
}
function breaksOn(name, title, change) {
    const item = items.find((candidate) => candidate.title === title);
    if (!item) return console.log(`skip  ${name}: no "${title}" in this export`);
    const expected = brokenOn(new Date(item.dueAt));
    expect(`${name} breaks it on ${label(item.dueAt)} (now ${expected.current}, longest ${expected.longest})`, computeStreak(changeOne(title, change), now), expected);
}
const addDay = (date) => { const d = day(date); d.setDate(d.getDate() + 1); return d; };

// Synced late, but checked off days before the deadline: only rule 3 saves it.
breaksOn("unchecking a late-synced chapter", "Chapter 10: Learning Disabilities", (item) => ({ ...item, override: null }));
// Submitted on time but checked off late: rule 2 saves it, so it must break once the submission goes.
breaksOn("no submission + late checkoff", "Speech of Introduction Outline", (item) => ({ ...item, submission: { ...item.submission, submitted: false, missing: true } }));
// In class: checked off after the deadline, nothing online, not flagged missing.
breaksOn("an in-class speech Canvas flags missing", "Informative Speech", (item) => ({ ...item, submission: { ...item.submission, missing: true } }));
breaksOn("an in-class speech never checked off", "Persuasive Speech", (item) => ({ ...item, override: null }));
// Ungraded discussion: no submission at all, so the checkoff is the only signal.
breaksOn("an ungraded discussion never checked off", "Persuasive Speech Topic Discussion", (item) => ({ ...item, override: null }));
// A dismissed override is not a checkoff.
breaksOn("a dismissed checkoff", "Chapter 12: Adaptive Sports", (item) => ({ ...item, override: { ...item.override, dismissed: true } }));

// --- Excused work and work that isn't due yet never break it. ---
const extra = (dueAt, submission) => computeStreak([...items, { dueAt, submission, override: null }], now);
expect("an excused, unsubmitted item is ignored", extra(items[0].dueAt, { excused: true }), { current: full, longest: full });
const endOfToday = addDay(now); endOfToday.setMilliseconds(-1);
expect("an unsubmitted item due later today is pending", extra(endOfToday.toISOString(), { submitted: false }), { current: full, longest: full });

// --- Saved checkpoints: resuming must match counting from scratch. ---
const key = (date) => { const d = day(date); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const noonAfter = (date) => { const d = addDay(date); d.setHours(12); return d; };
const dueAfter = (list, date) => list.filter((item) => day(item.dueAt) > day(date));
const yesterday = new Date(day(now).getTime() - 12 * 3_600_000);
const saved = continueStreak(items, now).checkpoint;

expect(`today saves the streak through yesterday (${full - 1} days, not ${full})`, saved, { through: key(yesterday), current: full - 1, longest: full - 1, started: true });
expect("resuming from yesterday gives today's streak", continueStreak(dueAfter(items, yesterday), now, saved).streak, { current: full, longest: full });
expect("nothing returned after the checkpoint (courses concluded) still counts", continueStreak([], now, saved).streak, { current: full, longest: full });
const tomorrow = noonAfter(now);
expect("the next day counts on from the same checkpoint", continueStreak([], tomorrow, saved), { streak: { current: full + 1, longest: full + 1 }, checkpoint: { through: key(now), current: full, longest: full, started: true } });
const missedToday = { dueAt: new Date(day(now).getTime() + 1000).toISOString(), submission: { submitted: false }, override: null };
if (now.getTime() > day(now).getTime() + 1000) {
    expect("a miss today resets the streak but not the saved checkpoint", continueStreak([missedToday], now, saved), { streak: { current: 0, longest: full - 1 }, checkpoint: saved });
}
const beforeFirst = new Date(day(first).getTime() - 12 * 3_600_000);
expect("a checkpoint before anything was due hasn't started", continueStreak(items, noonAfter(beforeFirst)).checkpoint, { through: key(beforeFirst), current: 0, longest: 0, started: false });

const chapter = items.find((item) => item.title === "Chapter 10: Learning Disabilities");
const variants = { "everything on time": items };
if (chapter) variants["Chapter 10 missed"] = changeOne(chapter.title, (item) => ({ ...item, override: null }));
const checkpointDays = [beforeFirst, first, new Date(2026, 9, 24), new Date(2026, 9, 25), new Date(2026, 9, 26), new Date(day(now).getTime() - 5 * 86_400_000), yesterday]
    .filter((date) => day(date) < day(now));
for (const [name, list] of Object.entries(variants)) {
    const scratch = computeStreak(list, now);
    const mismatches = checkpointDays.filter((date) => {
        const checkpoint = continueStreak(list, noonAfter(date)).checkpoint;
        const resumed = continueStreak(dueAfter(list, date), now, checkpoint).streak;
        return checkpoint.through !== key(date) || JSON.stringify(resumed) !== JSON.stringify(scratch);
    });
    expect(`${name}: resuming from ${checkpointDays.length} different checkpoints matches from scratch (${scratch.current}/${scratch.longest})`, mismatches.map(label), []);
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
