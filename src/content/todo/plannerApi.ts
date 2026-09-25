/*
 * The Canvas planner endpoints, and the Task shape the widget renders.
 */

import { api, fetchAllPages } from "../canvasApi";
import { type CourseMap, fallbackColor, loadCourses } from "./canvasEnv";
import { type DateRange, dueLabel } from "./dateRange";

/** Planner item types worth showing. Announcements are news, not work. */
const SHOWN_TYPES = new Set([
    "assignment",
    "quiz",
    "discussion_topic",
    "wiki_page",
    "planner_note",
    "calendar_event",
    "sub_assignment",
    "assessment_request",
    "peer_review_sub_assignment",
]);

interface PlannerOverride {
    id?: number;
    marked_complete?: boolean;
}

interface Submissions {
    submitted?: boolean;
    graded?: boolean;
    excused?: boolean;
    missing?: boolean;
    late?: boolean;
}

/** One entry from GET /api/v1/planner/items, trimmed to what the widget uses. */
interface PlannerItem {
    context_type?: string;
    context_name?: string;
    course_id?: number | string;
    group_id?: number | string;
    user_id?: number | string;
    plannable_id: number | string;
    plannable_type: string;
    plannable_date?: string;
    html_url?: string;
    planner_override?: PlannerOverride | null;
    /** false when the item has no submission concept (a page, a note). */
    submissions?: Submissions | false;
    plannable?: {
        title?: string;
        name?: string;
        due_at?: string;
        todo_date?: string;
        start_at?: string;
        points_possible?: number;
    };
}

/** A planner item after normalizing, ready to render. */
export interface Task {
    /** Stable across refetches, so Preact keeps DOM nodes in place. */
    key: string;
    plannableId: string;
    plannableType: string;
    title: string;
    url?: string;
    /** "course_208726" -- groups tasks by course in the progress bar. */
    courseKey: string;
    /** "COMM103" from the dashboard, else the long course name. */
    courseName: string;
    /** The user's dashboard color for the course. */
    color: string;
    due?: Date;
    /** "Due Today", "Tomorrow", "Thu, Sep 24" -- undefined when nothing is due. */
    dueText?: string;
    points: number | null;
    missing: boolean;
    late: boolean;
    complete: boolean;
    /** Set when Canvas already has an override for this item, so we PUT not POST. */
    overrideId?: number;
}

function contextKey(item: PlannerItem): string | undefined {
    if (item.course_id != null) return `course_${item.course_id}`;
    if (item.group_id != null) return `group_${item.group_id}`;
    if (item.context_type === "User" && item.user_id != null) return `user_${item.user_id}`;
    return undefined;
}

/* Complete means either the user ticked it here (an override) or Canvas already
   considers the work done. Both hide the item from the list. */
function isComplete(item: PlannerItem): boolean {
    if (item.planner_override?.marked_complete) return true;
    const submissions = item.submissions;
    return !!submissions && (!!submissions.submitted || !!submissions.graded || !!submissions.excused);
}

function normalize(item: PlannerItem, courses: CourseMap): Task {
    const key = contextKey(item);
    const course = (key && courses[key]) || {};
    const plannable = item.plannable || {};
    const dueRaw = plannable.due_at || plannable.todo_date || plannable.start_at || item.plannable_date;
    const due = dueRaw ? new Date(dueRaw) : undefined;

    return {
        key: `${item.plannable_type}:${item.plannable_id}`,
        plannableId: String(item.plannable_id),
        plannableType: item.plannable_type,
        title: plannable.title || plannable.name || "Untitled",
        url: item.html_url,
        courseKey: key || "other",
        courseName: course.name || item.context_name || "",
        color: course.color || fallbackColor(key),
        due: due && !Number.isNaN(due.getTime()) ? due : undefined,
        dueText: due && !Number.isNaN(due.getTime()) ? dueLabel(due) : undefined,
        points: typeof plannable.points_possible === "number" ? plannable.points_possible : null,
        missing: !!(item.submissions && item.submissions.missing),
        late: !!(item.submissions && item.submissions.late),
        complete: isComplete(item),
        overrideId: item.planner_override?.id,
    };
}

/** Open work first, soonest due at the top; undated work last. */
function byDueDate(a: Task, b: Task): number {
    const left = a.due ? a.due.getTime() : Infinity;
    const right = b.due ? b.due.getTime() : Infinity;
    return left - right;
}

export async function fetchTasks(range: DateRange, signal?: AbortSignal): Promise<Task[]> {
    const params = new URLSearchParams({
        start_date: range.start.toISOString(),
        end_date: range.end.toISOString(),
        per_page: "1000",
    });

    const items = await fetchAllPages<PlannerItem>(`/api/v1/planner/items?${params}`, signal);

    const courses = await loadCourses();
    return items
        .filter((item) => SHOWN_TYPES.has(item.plannable_type))
        .map((item) => normalize(item, courses))
        .sort(byDueDate);
}

/*
 * Ticking a task writes a planner override, the same record Canvas's own
 * planner uses -- so the change shows up in Canvas's UI too, not just here.
 * An item may already have one (Canvas creates them for other reasons), in
 * which case it is updated rather than duplicated.
 */
export async function setComplete(task: Task, complete: boolean): Promise<number | undefined> {
    if (task.overrideId) {
        await api(`/api/v1/planner/overrides/${task.overrideId}`, {
            method: "PUT",
            body: { marked_complete: complete },
        });
        return task.overrideId;
    }

    const { data } = await api<{ id?: number }>("/api/v1/planner/overrides", {
        method: "POST",
        body: {
            plannable_type: task.plannableType,
            plannable_id: task.plannableId,
            marked_complete: complete,
        },
    });
    return data.id;
}
