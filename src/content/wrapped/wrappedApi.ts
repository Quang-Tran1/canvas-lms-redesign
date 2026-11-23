/*
 * Fetches the Wrapped year from Canvas and hands it to wrappedMath.ts.
 *
 * - The course list: names, card images, when each ran, class sizes, and
 *   the dashboard colors the to-do list already loads.
 * - Per course, its assignments and the student's own submissions with every
 *   attempt. These still cover courses that have ended, which Canvas drops
 *   from the planner.
 * - The planner's checkoffs, for work done on paper or in another tool.
 * - The class lists, for people met.
 *
 * Two or three requests per course, most taking a second or two, so a year of
 * courses takes several seconds. The launcher starts it when the pointer
 * reaches it, and the result is kept for as long as the page is open.
 */

import { api, fetchAllPages } from "../canvasApi";
import { customCourseImage } from "../courseImages/mount";
import { readPageEnv } from "../pageEnv";
import { loadCourses, type CourseMap } from "../todo/canvasEnv";
import { wrappedRange, type WrappedStats } from "./stats";
import { computeStats, type Course, type Range, type Work, type WorkKind, type WrappedInput } from "./wrappedMath";

interface ApiDates {
    start_at?: string | null;
    end_at?: string | null;
}

interface ApiCourse extends ApiDates {
    id: number;
    /** The user's nickname for it, when they set one. */
    name?: string;
    /** Set, with nothing else, on a course outside its access dates. */
    access_restricted_by_date?: boolean;
    restrict_enrollments_to_course_dates?: boolean;
    term?: ApiDates;
    image_download_url?: string | null;
    total_students?: number;
    enrollments?: { type?: string }[];
}

interface ApiAssignment {
    id: number;
    due_at?: string | null;
    created_at?: string | null;
    unlock_at?: string | null;
    submission_types?: string[];
    is_quiz_assignment?: boolean;
    is_quiz_lti_assignment?: boolean;
    external_tool_tag_attributes?: { url?: string | null } | null;
}

interface ApiSubmission {
    assignment_id: number;
    /** The student's own deadline. */
    cached_due_date?: string | null;
    submitted_at?: string | null;
    score?: number | null;
    graded_at?: string | null;
    excused?: boolean | null;
    missing?: boolean;
    /** One version per attempt, and more when an attempt is regraded. */
    submission_history?: { submitted_at?: string | null }[];
}

interface ApiOverride {
    plannable_type?: string;
    plannable_id?: number;
    /** Set for quizzes and graded discussions too, whose plannable is the
        quiz or the topic. */
    assignment_id?: number | null;
    marked_complete?: boolean;
    dismissed?: boolean;
    deleted_at?: string | null;
    workflow_state?: string;
    created_at?: string;
}

interface Checkoffs {
    /** When each assignment was checked off, by assignment id. */
    byAssignment: Map<string, Date>;
    /** Ungraded discussions, which aren't assignments. */
    discussions: Date[];
}

/** Requests in flight at once. */
const CONCURRENCY = 8;

/** A class bigger than this is a homeroom or an orientation, not people met. */
const MAX_CLASS_SIZE = 1000;

let cached: Promise<WrappedStats> | null = null;
let loaded: WrappedStats | undefined;

export function loadWrappedStats(): Promise<WrappedStats> {
    if (!cached) {
        const range = wrappedRange();
        cached = fetchWrappedInput(range).then((input) => (loaded = computeStats(input, range)));
        // A failure isn't kept, so opening Wrapped again tries again.
        cached.catch(() => {
            cached = null;
        });
    }
    return cached;
}

/** The year, if it has already loaded, so the modal can open straight to it
    instead of waiting a tick for the promise. */
export function loadedWrappedStats(): WrappedStats | undefined {
    return loaded;
}

/** Everything wrappedMath.ts needs for `range`. */
export async function fetchWrappedInput(range: Range): Promise<WrappedInput> {
    const slot = limiter(CONCURRENCY);

    const [listed, checkoffs, selfId, colors] = await Promise.all([
        fetchCourses(),
        fetchCheckoffs().catch((cause): Checkoffs => {
            console.warn("[BetterLMS] Wrapped could not load planner checkoffs:", cause);
            return { byAssignment: new Map(), discussions: [] };
        }),
        currentUserId(),
        // Only for the busiest course's glow, which has a color of its own
        // to fall back on.
        loadCourses().catch((): CourseMap => ({})),
    ]);
    const inYear = listed
        .map((source) => ({ source, course: toCourse(source, colors) }))
        .filter(({ course }) => overlaps(course, range));

    const [work, peopleMet] = await Promise.all([
        Promise.all(inYear.map(({ course }) => fetchWork(course.id, checkoffs.byAssignment, slot).catch((cause) => {
            // One course that won't load shouldn't cost the whole year.
            console.warn(`[BetterLMS] Wrapped skipped course ${course.id}:`, cause);
            return [];
        }))),
        countPeopleMet(inYear, range, selfId, slot),
    ]);

    return {
        courses: inYear.map(({ course }) => course),
        work: work.flat(),
        discussionCheckoffs: checkoffs.discussions,
        peopleMet,
    };
}

/* ---- Courses ---- */

async function fetchCourses(): Promise<ApiCourse[]> {
    const params = new URLSearchParams({ per_page: "100" });
    for (const include of ["term", "course_image", "total_students"]) params.append("include[]", include);
    const completed = new URLSearchParams(params);
    completed.set("enrollment_state", "completed");

    // Some schools leave finished courses out of the default list.
    const lists = await Promise.all([
        fetchAllPages<ApiCourse>(`/api/v1/courses?${params}`),
        fetchAllPages<ApiCourse>(`/api/v1/courses?${completed}`),
    ]);

    const byId = new Map<number, ApiCourse>();
    for (const course of lists.flat()) if (!byId.has(course.id)) byId.set(course.id, course);
    return [...byId.values()].filter((course) =>
        !course.access_restricted_by_date &&
        (!course.enrollments || course.enrollments.some((enrollment) => enrollment.type === "student")),
    );
}

/* A course runs on its term's dates unless it's set to its own, as Canvas
   decides it. Whichever is missing falls back to the other. */
function toCourse(source: ApiCourse, colors: CourseMap): Course {
    const own = { start: toDate(source.start_at), end: toDate(source.end_at) };
    const term = { start: toDate(source.term?.start_at), end: toDate(source.term?.end_at) };
    const [first, second] = source.restrict_enrollments_to_course_dates ? [own, term] : [term, own];
    const id = String(source.id);
    return {
        id,
        name: source.name || "",
        image: customCourseImage(id) || source.image_download_url || undefined,
        color: colors[`course_${id}`]?.color,
        start: first.start ?? second.start,
        end: first.end ?? second.end,
    };
}

function overlaps(course: Course, range: Range): boolean {
    return (!course.start || course.start < range.end) && (!course.end || course.end > range.start);
}

/* ---- Coursework ---- */

async function fetchWork(courseId: string, checkoffs: Map<string, Date>, slot: Slot): Promise<Work[]> {
    // Without student_ids, Canvas lists the caller's own submissions.
    const submissionParams = new URLSearchParams({ per_page: "100" });
    submissionParams.append("include[]", "submission_history");
    // Assignments come by group because that endpoint can leave out the
    // descriptions and rubrics, which make up most of an assignment and take
    // Canvas most of its time to send. Listed with the submissions instead,
    // a course takes about three times as long.
    const groupParams = new URLSearchParams({ per_page: "100" });
    groupParams.append("include[]", "assignments");
    groupParams.append("exclude_response_fields[]", "description");
    groupParams.append("exclude_response_fields[]", "rubric");

    const [submissions, groups] = await Promise.all([
        slot(() => fetchAllPages<ApiSubmission>(`/api/v1/courses/${courseId}/students/submissions?${submissionParams}`)),
        slot(() => fetchAllPages<{ assignments?: ApiAssignment[] }>(`/api/v1/courses/${courseId}/assignment_groups?${groupParams}`)),
    ]);
    const submissionFor = new Map(submissions.map((submission) => [String(submission.assignment_id), submission]));

    const work: Work[] = [];
    for (const assignment of groups.flatMap((group) => group.assignments || [])) {
        const id = String(assignment.id);
        const submission = submissionFor.get(id);
        work.push({
            courseId,
            kind: workKind(assignment),
            // The submission carries the student's own deadline.
            due: toDate(submission && "cached_due_date" in submission ? submission.cached_due_date : assignment.due_at),
            posted: latest(toDate(assignment.created_at), toDate(assignment.unlock_at)),
            attempts: submission ? attempts(submission) : [],
            checkedAt: checkoffs.get(id),
            score: typeof submission?.score === "number" && Number.isFinite(submission.score) ? submission.score : undefined,
            gradedAt: toDate(submission?.graded_at),
            excused: !!submission?.excused,
            missing: !!submission?.missing,
        });
    }
    return work;
}

/* New Quizzes are an external tool, told apart by the tool's address. */
function workKind(assignment: ApiAssignment): WorkKind {
    const types = assignment.submission_types || [];
    const toolUrl = assignment.external_tool_tag_attributes?.url || "";
    if (assignment.is_quiz_assignment || assignment.is_quiz_lti_assignment ||
        types.includes("online_quiz") || /quiz-lti/i.test(toolUrl)) return "quiz";
    if (types.includes("discussion_topic")) return "discussion";
    return "assignment";
}

/* Each distinct submit time once: regrading an attempt adds a version to the
   history without anyone pressing submit. */
function attempts(submission: ApiSubmission): Date[] {
    const times = new Set<number>();
    for (const version of submission.submission_history || []) {
        const at = toDate(version.submitted_at);
        if (at) times.add(at.getTime());
    }
    const latestAt = toDate(submission.submitted_at);
    if (latestAt) times.add(latestAt.getTime());
    return [...times].sort((a, b) => a - b).map((time) => new Date(time));
}

/* Every planner checkoff the user has made, in any course, ended or not. */
async function fetchCheckoffs(): Promise<Checkoffs> {
    const overrides = await fetchAllPages<ApiOverride>("/api/v1/planner/overrides?per_page=100");
    const checkoffs: Checkoffs = { byAssignment: new Map(), discussions: [] };
    for (const override of overrides) {
        if (!override.marked_complete || override.dismissed || override.deleted_at || override.workflow_state === "deleted") continue;
        // created_at, not updated_at: re-saving an override bumps updated_at.
        const at = toDate(override.created_at);
        if (!at) continue;
        const assignmentId = override.assignment_id ??
            (override.plannable_type === "assignment" ? override.plannable_id : undefined);
        if (assignmentId != null) checkoffs.byAssignment.set(String(assignmentId), at);
        else if (override.plannable_type === "discussion_topic") checkoffs.discussions.push(at);
    }
    return checkoffs;
}

/* ---- People met ---- */

/*
 * Everyone in the classes that started this year: classmates met earlier
 * aren't new. Counted once each, however many classes they shared.
 *
 * Canvas hides a class list once the course ends, leaving only its size. Those
 * classes add their size instead, so a classmate from one of them may count
 * twice, and the total is an estimate.
 */
async function countPeopleMet(
    courses: { source: ApiCourse; course: Course }[],
    range: Range,
    selfId: string | null,
    slot: Slot,
): Promise<number> {
    const met = new Set<string>();
    let estimated = 0;

    await Promise.all(courses.map(async ({ source, course }) => {
        if (!course.start || course.start < range.start || course.start >= range.end) return;
        const size = source.total_students ?? 0;
        if (size > MAX_CLASS_SIZE) return;
        try {
            const users = await slot(() => fetchAllPages<{ id: number }>(`/api/v1/courses/${course.id}/users?per_page=100`));
            for (const user of users) met.add(String(user.id));
        } catch {
            estimated += Math.max(0, size - 1);           // less the student
        }
    }));

    if (selfId) met.delete(selfId);
    return met.size + estimated;
}

async function currentUserId(): Promise<string | null> {
    const fromEnv = readPageEnv()?.current_user_id;
    if (typeof fromEnv === "string" || typeof fromEnv === "number") return String(fromEnv);
    try {
        const { data } = await api<{ id?: number }>("/api/v1/users/self");
        return data.id != null ? String(data.id) : null;
    } catch {
        return null;
    }
}

/* ---- Helpers ---- */

type Slot = <T>(task: () => Promise<T>) => Promise<T>;

/* Runs at most `max` tasks at once. A finished task hands its slot straight
   to the next one waiting, so a task arriving in between can't take it too. */
function limiter(max: number): Slot {
    let active = 0;
    const waiting: (() => void)[] = [];
    return async (task) => {
        if (active < max) active++;
        else await new Promise<void>((resolve) => waiting.push(resolve));
        try {
            return await task();
        } finally {
            const next = waiting.shift();
            if (next) next();
            else active--;
        }
    };
}

function toDate(value: string | null | undefined): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

function latest(a: Date | undefined, b: Date | undefined): Date | undefined {
    if (!a || !b) return a ?? b;
    return a > b ? a : b;
}
