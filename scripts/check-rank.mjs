/*
 * Accuracy check for src/content/grades/rankMath.ts.
 *
 * Simulates three kinds of class, gives the estimator only what Canvas shows a
 * student (their own scores plus each assignment's statistics), and compares
 * the displayed range with each student's true rank. Run it before changing
 * CONSISTENCY or MARGIN:
 *
 *     npm run check:rank
 *
 * The seeds are fixed, so the numbers are the same on every run.
 */
import { estimatePercentile, formatRank, percentileOf, MARGIN, CONSISTENCY } from "../src/content/grades/rankMath.ts";
let seed = 1;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const normal = () => { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const between = (a, b) => a + rand() * (b - a);
const Phi = (z) => { const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x); const e = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return 0.5 * (1 + (z >= 0 ? e : -e)); };
const quantile = (s, q) => { const p = (s.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return s[lo] + (s[hi] - s[lo]) * (p - lo); };
const statsOf = (xs) => { const s = [...xs].sort((a, b) => a - b); return { min: s[0], max: s[s.length - 1], mean: xs.reduce((a, b) => a + b, 0) / xs.length, lowerQ: quantile(s, 0.25), median: quantile(s, 0.5), upperQ: quantile(s, 0.75) }; };

const gens = {
  "A (normal ability, clipped, zeros)": () => { const n = pick([20, 35, 60, 120, 250]), nA = 2 + Math.floor(rand() * 19), r = between(0.1, 0.9), nG = 1 + Math.floor(rand() * 4), w = rand() < 0.5; const ab = Array.from({ length: n }, normal);
    return { n, weighted: w, groups: Array.from({ length: nG }, () => ({ weight: between(5, 50) })), assigns: Array.from({ length: nA }, () => { const pp = pick([5, 10, 20, 25, 50, 100]), b = between(0.6, 0.93), sp = between(0.06, 0.25), z = pick([0, 0, 0.02, 0.05, 0.1]); return { pp, group: Math.floor(rand() * nG), scores: ab.map((a) => rand() < z ? 0 : Math.round(Math.min(pp, Math.max(0, pp * (b + sp * (Math.sqrt(r) * a + Math.sqrt(1 - r) * normal())))) * 2) / 2) }; }) }; },
  "B (skewed ability, ceilings)      ": () => { const n = pick([15, 30, 50, 90, 180, 400]), nA = 1 + Math.floor(rand() * 25), nG = 1 + Math.floor(rand() * 5), w = rand() < 0.6; const ab = Array.from({ length: n }, () => { const g = normal(); return g < 0 ? g * 1.6 : g * 0.7; });
    return { n, weighted: w, groups: Array.from({ length: nG }, () => ({ weight: pick([10, 15, 20, 25, 30, 40]) })), assigns: Array.from({ length: nA }, () => { const pp = pick([1, 3, 10, 15, 40, 100, 150]), ld = between(0.2, 0.95), c = rand() < 0.3, b = c ? between(0.9, 1) : between(0.55, 0.85), sp = between(0.05, 0.3); return { pp, group: Math.floor(rand() * nG), scores: ab.map((a) => rand() < 0.08 * Phi(-a * 1.5) ? 0 : Math.round(Math.min(pp, Math.max(0, pp * (b + sp * (ld * a + Math.sqrt(1 - ld * ld) * normal())))))) }; }) }; },
  "C (early term, perfect scores)    ": () => { const n = pick([20, 40, 80]), nA = 1 + Math.floor(rand() * 3), ab = Array.from({ length: n }, normal);
    return { n, weighted: false, groups: [{ weight: 100 }], assigns: Array.from({ length: nA }, () => { const pp = pick([5, 10, 20]), b = between(0.85, 1.05), sp = between(0.05, 0.2); return { pp, group: 0, scores: ab.map((a) => Math.round(Math.min(pp, Math.max(0, pp * (b + sp * (0.7 * a + 0.71 * normal())))))) }; }) }; },
};

function run(name, gen, seedValue, count) {
  seed = seedValue; const reg = { "bottom 10%": [0, 0], "bottom 25%": [0, 0], "middle 50%": [0, 0], "top 25%": [0, 0], "top 10%": [0, 0] }; let hit = 0, n = 0; const errs = [], shown = [];
  for (let k = 0; k < count; k++) {
    const cls = gen(); for (const a of cls.assigns) a.stats = statsOf(a.scores);
    // Truth: the same weighting Canvas uses, on the real scores.
    const filled = cls.groups.map((g, gi) => ({ weight: g.weight, items: cls.assigns.filter((a) => a.group === gi) })).filter((g) => g.items.length);
    const W = filled.reduce((s, g) => s + g.weight, 0), all = cls.assigns.reduce((s, a) => s + a.pp, 0);
    const totals = Array.from({ length: cls.n }, (_, j) => filled.reduce((sum, g) => { const gp = g.items.reduce((s, a) => s + a.pp, 0); return sum + g.items.reduce((s, a) => s + a.scores[j] * (cls.weighted ? (100 * g.weight / W) / gp : 100 / all), 0); }, 0));
    for (let s = 0; s < Math.min(cls.n, 20); s++) {
      const j = Math.floor(rand() * cls.n); let below = 0, eq = 0; for (const x of totals) { if (x < totals[j] - 1e-9) below++; else if (Math.abs(x - totals[j]) <= 1e-9) eq++; }
      const truth = (below + eq / 2) / cls.n * 100;
      // Only what the student can see: their own scores plus each assignment's statistics.
      const groups = cls.groups.map((g, gi) => ({ weight: g.weight, assignments: cls.assigns.filter((a) => a.group === gi).map((a) => ({ pointsPossible: a.pp, score: a.scores[j], stats: a.stats })) }));
      const est = estimatePercentile(groups, cls.weighted);
      const h = truth >= est.low - 1 && truth <= est.high + 1; hit += h; n++; errs.push(Math.abs(est.estimate - truth));
      const r = truth < 25 ? "bottom 25%" : truth < 75 ? "middle 50%" : "top 25%"; reg[r][0] += h; reg[r][1]++;
      if (truth < 10) { reg["bottom 10%"][0] += h; reg["bottom 10%"][1]++; } if (truth >= 90) { reg["top 10%"][0] += h; reg["top 10%"][1]++; }
      if (shown.length < 3 && k % 37 === 0) shown.push(`true ${truth.toFixed(0)}th -> "${formatRank(est)}"`);
    }
  }
  errs.sort((a, b) => a - b);
  console.log(`${name} range holds truth ${(100 * hit / n).toFixed(0)}% | typical error ${errs[Math.floor(errs.length / 2)].toFixed(1)}, p90 ${errs[Math.floor(errs.length * .9)].toFixed(1)} | by region: ${Object.entries(reg).map(([k, [h, m]]) => `${k} ${(100 * h / m).toFixed(0)}%`).join(", ")}`);
  console.log(`   examples: ${shown.join("; ")}`);
}
console.log(`Shipping constants: CONSISTENCY=${CONSISTENCY}, MARGIN=${MARGIN}`);
// Fresh seeds, not the ones used while tuning.
run(...Object.entries(gens)[0], 424242, 400);
run(...Object.entries(gens)[1], 515151, 400);
run(...Object.entries(gens)[2], 606060, 300);

// Unit checks.
let failed = 0; const check = (ok, msg) => { if (!ok) { failed++; console.log("FAIL:", msg); } };
const f = (estimate, low, high) => formatRank({ estimate, low, high, assignmentCount: 1 });
check(f(91.5, 88, 95) === "Top 5-12%", "top range " + f(91.5, 88, 95));
check(f(99.9, 93.4, 100) === "Top 1-7%", "clipped at the top " + f(99.9, 93.4, 100));
check(f(25, 18.5, 31.5) === "Bottom 19-32%", "bottom range " + f(25, 18.5, 31.5));
check(f(50, 43.5, 56.5) === "Top 44-57%", "median shown as top " + f(50, 43.5, 56.5));
check(f(0.2, 0, 6.7) === "Bottom 1-7%", "clipped at the bottom " + f(0.2, 0, 6.7));
check(percentileOf([60, 80, 100, 100, 100], 100) === 75, "tie at the ceiling takes the middle of the block");
const one = (score, stats) => estimatePercentile([{ weight: 100, assignments: [{ pointsPossible: 10, score, stats }] }], false);
const ceil = { min: 4, lowerQ: 8, median: 10, upperQ: 10, max: 10, mean: 8.9 };
check(Math.abs(one(10, ceil).estimate - 75) < 1e-9, "perfect score when half the class is perfect -> 75th, got " + one(10, ceil).estimate);
check(one(9, ceil).estimate < 50, "one point short of a perfect-score median is below the median, got " + one(9, ceil).estimate.toFixed(1));
const same = { min: 7, lowerQ: 7, median: 7, upperQ: 7, max: 7, mean: 7 };
check(one(7, same).estimate === 50, "everyone identical -> 50th");
const old = { min: 2, max: 10, mean: 7 };   // older Canvas: no quartiles
check(Number.isFinite(one(9, old).estimate) && one(9, old).estimate > 50, "works without quartiles, got " + one(9, old).estimate);
const weightedEmpty = estimatePercentile([{ weight: 60, assignments: [{ pointsPossible: 10, score: 9, stats: { min: 2, lowerQ: 6, median: 7, upperQ: 8, max: 10, mean: 6.8 } }] }, { weight: 40, assignments: [] }], true);
check(weightedEmpty && weightedEmpty.assignmentCount === 1, "an empty weighted group is dropped, not divided by");
check(estimatePercentile([{ weight: 100, assignments: [] }], false) === null, "nothing to rank -> null");
check(estimatePercentile([{ weight: 100, assignments: [{ pointsPossible: 0, score: 0, stats: same }] }], false) === null, "zero-point assignments are ignored");
console.log(failed ? `${failed} unit check(s) FAILED` : "all unit checks passed");
if (failed) process.exitCode = 1;
