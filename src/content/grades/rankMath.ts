/*
 * Estimates where a student's course total sits within their class, using
 * only what Canvas shows students: each assignment's min, quartiles, median,
 * max and mean. No other student's scores are ever seen.
 *
 * WHY THIS IS AN ESTIMATE
 * Canvas gives each assignment's statistics separately, never the class's
 * totals. Adding up every assignment's quartiles would give the spread of
 * totals only if every student ranked the same on every assignment. Real
 * students don't, so the true spread is narrower, and naive summing puts
 * everyone too close to the middle.
 *
 * THE MODEL
 * 1. Each assignment is converted into its share of the course total, using
 *    the same weighting as the Grades page.
 * 2. The class's spread of totals is estimated from each assignment's spread
 *    and an assumed consistency between assignments (CONSISTENCY):
 *        spread = sqrt((1 - c) * sum(sd^2) + c * sum(sd)^2)
 *    The summed quartile gaps are scaled to that spread. The median's pull away
 *    from the mean (skew) fades faster, with the square of the same factor,
 *    because adding imperfectly correlated scores cancels skew out.
 * 3. The student's total is placed on that distribution, with normal-shaped
 *    tails beyond the quartiles. A single zero or a row of perfect scores
 *    would otherwise distort the ends.
 * 4. A student exactly at the class's best (or worst) possible total is tied
 *    with a block of classmates, so the middle of that block is used instead.
 *
 * HOW GOOD IT IS
 * Tested against three kinds of simulated class (varied sizes, weighting,
 * skew, missing work, early-term perfect scores). The estimate's typical error
 * is about 3 percentile points. MARGIN makes the displayed range contain the
 * true rank about 80-85% of the time, evenly across top, middle and bottom.
 * Run `npm run check:rank` (scripts/check-rank.mjs) before changing either
 * constant.
 */

export interface ScoreStats {
    min: number;
    max: number;
    mean: number;
    /** Newer Canvas returns quartiles; older instances send only min/max/mean. */
    lowerQ?: number;
    median?: number;
    upperQ?: number;
}

export interface AssignmentInput {
    pointsPossible: number;
    /** The student's own score, in points. */
    score: number;
    stats: ScoreStats;
}

export interface GroupInput {
    /** Group weight in percent. Ignored unless the course weights groups. */
    weight: number;
    assignments: AssignmentInput[];
}

/** Percentiles from 0 to 100, higher meaning a better standing in the class. */
export interface PercentileRange {
    /** The single best guess. */
    estimate: number;
    low: number;
    high: number;
    /** How many assignments the estimate drew on. */
    assignmentCount: number;
}

/** Assumed average correlation between a student's scores on different assignments. */
export const CONSISTENCY = 0.4;
/** Half-width of the displayed range, in percentile points. */
export const MARGIN = 6.5;

/* A normal distribution's interquartile range is 1.349 standard deviations,
   and its 75th percentile sits 0.6745 of one above the median. */
const IQR_PER_SD = 1.349;
const Z_UPPER_QUARTILE = 0.6744897501960817;

/* Standard normal CDF, via Abramowitz & Stegun 7.1.26 (error below 1.5e-7). */
function normalCdf(z: number): number {
    const x = Math.abs(z) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * x);
    const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return 0.5 * (1 + (z >= 0 ? erf : -erf));
}

interface Term {
    /** Converts points on this assignment into percentage points of the total. */
    scale: number;
    assignment: AssignmentInput;
}

/*
 * Matches Canvas's "current" score: only assignments that count toward it.
 * With weighted groups, empty groups are left out and the remaining weights
 * are scaled up to fill 100%, which is what Canvas does too.
 */
function toTerms(groups: GroupInput[], weighted: boolean): Term[] {
    const filled = groups
        .map((group) => ({
            weight: Math.max(group.weight, 0),
            assignments: group.assignments.filter((a) => a.pointsPossible > 0),
        }))
        .filter((group) => group.assignments.length > 0);

    const totalWeight = filled.reduce((sum, group) => sum + group.weight, 0);
    const useWeights = weighted && totalWeight > 0;
    const allPoints = filled.reduce(
        (sum, group) => sum + group.assignments.reduce((s, a) => s + a.pointsPossible, 0),
        0,
    );
    if (!useWeights && allPoints <= 0) return [];

    const terms: Term[] = [];
    for (const group of filled) {
        const groupPoints = group.assignments.reduce((s, a) => s + a.pointsPossible, 0);
        for (const assignment of group.assignments) {
            const scale = useWeights ? (100 * (group.weight / totalWeight)) / groupPoints : 100 / allPoints;
            terms.push({ scale, assignment });
        }
    }
    return terms;
}

/* Min, lower quartile, median, upper quartile, max. Without quartiles, the
   mean stands in for the median and the quartiles sit halfway either side. */
function fiveNumbers(stats: ScoreStats): number[] {
    const median = stats.median ?? stats.mean;
    const values = [
        stats.min,
        stats.lowerQ ?? (stats.min + median) / 2,
        median,
        stats.upperQ ?? (median + stats.max) / 2,
        stats.max,
    ];
    // Guard against inconsistent data: a quantile function never decreases.
    for (let i = 1; i < values.length; i++) values[i] = Math.max(values[i], values[i - 1]);
    return values;
}

function standardDeviation(stats: ScoreStats): number {
    if (stats.lowerQ !== undefined && stats.upperQ !== undefined) {
        return Math.max(stats.upperQ - stats.lowerQ, 0) / IQR_PER_SD;
    }
    return Math.max(stats.max - stats.min, 0) / 4;   // rough range rule
}

/*
 * Where `value` falls on a piecewise-linear quantile function through evenly
 * spaced percentiles. On a flat stretch, where many students share the exact
 * value, the middle of that stretch is used: the usual convention for ties.
 */
export function percentileOf(quantiles: number[], value: number): number {
    const last = quantiles.length - 1;
    const step = 100 / last;

    // Lowest percentile at which the class reaches `value`.
    let first = 100;
    if (value <= quantiles[0]) first = 0;
    else {
        for (let i = 0; i < last; i++) {
            if (value <= quantiles[i + 1]) {
                first = i * step + ((value - quantiles[i]) / (quantiles[i + 1] - quantiles[i])) * step;
                break;
            }
        }
    }

    // Highest percentile at which the class is still at or below `value`.
    let lastP = 0;
    if (value >= quantiles[last]) lastP = 100;
    else if (value >= quantiles[0]) {
        for (let i = last - 1; i >= 0; i--) {
            if (value >= quantiles[i]) {
                lastP = i * step + ((value - quantiles[i]) / (quantiles[i + 1] - quantiles[i])) * step;
                break;
            }
        }
    }

    return (first + lastP) / 2;
}

export function estimatePercentile(groups: GroupInput[], weighted: boolean): PercentileRange | null {
    const terms = toTerms(groups, weighted);
    if (!terms.length) return null;

    let mean = 0;
    let studentTotal = 0;
    let sdSum = 0;
    let sdSquaredSum = 0;
    const summed = [0, 0, 0, 0, 0];   // five-number summary, added up across assignments

    for (const { scale, assignment } of terms) {
        const { stats } = assignment;
        mean += scale * stats.mean;
        studentTotal += scale * assignment.score;
        const sd = scale * standardDeviation(stats);
        sdSum += sd;
        sdSquaredSum += sd * sd;
        fiveNumbers(stats).forEach((value, i) => { summed[i] += scale * value; });
    }

    const [lowest, q1, median, q3, highest] = summed;
    const tolerance = 1e-9 * Math.max(1, Math.abs(highest));
    let estimate: number;

    if (studentTotal >= highest - tolerance || studentTotal <= lowest + tolerance) {
        // Tied with everyone else at the best or worst possible total.
        estimate = percentileOf(summed, studentTotal);
    } else {
        // Spread relative to the "everyone ranks the same" sum.
        const shrink = sdSum > 0
            ? Math.sqrt((1 - CONSISTENCY) * sdSquaredSum + CONSISTENCY * sdSum * sdSum) / sdSum
            : 1;
        const centre = mean + shrink * shrink * (median - mean);
        let above = shrink * (q3 - median);
        let below = shrink * (median - q1);
        // A collapsed side (half the class on one score) borrows the other's width.
        if (above <= 0) above = below;
        if (below <= 0) below = above;

        const gap = studentTotal >= centre ? above : below;
        const z = gap > 0
            ? ((studentTotal - centre) / gap) * Z_UPPER_QUARTILE
            : Math.sign(studentTotal - centre) * 8;   // everyone identical: fully above or below
        estimate = normalCdf(z) * 100;
    }

    return {
        estimate,
        low: Math.max(0, estimate - MARGIN),
        high: Math.min(100, estimate + MARGIN),
        assignmentCount: terms.length,
    };
}

/*
 * "Top 5-12%" for the upper half of the class, "Bottom 20-31%" for the lower.
 * The side follows the best guess, so a range that straddles the median is
 * still shown from one side, in full.
 */
export function formatRank(range: PercentileRange): string {
    const topFrom = 100 - range.high;   // better standing, smaller "top" number
    const topTo = 100 - range.low;

    if (range.estimate >= 50) return label("Top", topFrom, topTo);
    return label("Bottom", 100 - topTo, 100 - topFrom);
}

function label(side: string, from: number, to: number): string {
    // Never "Top 0%": the best a class of any size can say is top 1%.
    const a = Math.max(1, Math.round(from));
    const b = Math.max(1, Math.round(to));
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    return lo === hi ? `${side} ${lo}%` : `${side} ${lo}-${hi}%`;
}
