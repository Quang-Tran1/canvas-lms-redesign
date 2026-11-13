/*
 * Course colors and course names, read from the Canvas page's ENV. Where that
 * fails (a Canvas page that doesn't render ENV, or a shape change), the same
 * data is fetched from the REST API instead.
 */

import { api } from "../canvasApi";
import { readPageEnv } from "../pageEnv";

export interface CourseInfo {
    /** "#rrggbb" -- the user's own dashboard color for this course. */
    color?: string;
    /** The user's nickname for the course, else its name: "COMM103", not the
        course code "COMM103-01-Fall2026". */
    name?: string;
}

/** Keyed by Canvas asset string: "course_208726", "group_41". */
export type CourseMap = Record<string, CourseInfo>;

interface EnvCourse {
    id?: string | number;
    assetString?: string;
    courseCode?: string;
    shortName?: string;
    originalName?: string;
    longName?: string;
    color?: string;
}

interface CanvasEnv {
    PREFERENCES?: { custom_colors?: Record<string, string> };
    STUDENT_PLANNER_COURSES?: EnvCourse[];
}

/* Used when a course has no color set -- hashed so one course keeps the same
   color between page loads instead of shuffling. */
const FALLBACK_PALETTE = [
    "#9b7fe0", "#e05fa2", "#f0a020", "#3aa0e0",
    "#42c28a", "#e06060", "#5a8ae0", "#c98b3a",
];

export function fallbackColor(key: string | undefined): string {
    if (!key) return "#8e8e93";
    let hash = 0;
    for (const character of key) {
        hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    }
    return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
}

/* "course_212306" on a course's pages, from the <body> class Canvas sets
   ("context-course_212306"); null on the dashboard and everywhere else. */
export function currentCourseKey(): string | null {
    return document.body?.className.match(/\bcontext-(course_\d+)\b/)?.[1] ?? null;
}

/* Courses don't change while the page is open, so this is fetched once and the
   promise itself is cached -- two widgets mounting at once share one request. */
let cached: Promise<CourseMap> | null = null;

export function loadCourses(): Promise<CourseMap> {
    cached ??= buildCourseMap();
    return cached;
}

async function buildCourseMap(): Promise<CourseMap> {
    const courses: CourseMap = {};
    const env = readPageEnv() as CanvasEnv | null;

    const setColor = (key: string | undefined, color: unknown) => {
        if (!key || typeof color !== "string") return;
        (courses[key] ??= {}).color = color;
    };
    const setName = (key: string | undefined, name: unknown) => {
        if (!key || typeof name !== "string" || !name) return;
        const entry = (courses[key] ??= {});
        entry.name ||= name;                          // first source wins
    };

    const envColors = env?.PREFERENCES?.custom_colors;
    if (envColors) {
        for (const [key, color] of Object.entries(envColors)) setColor(key, color);
    } else {
        try {
            const response = await fetch("/api/v1/users/self/colors", {
                headers: { Accept: "application/json" },
                credentials: "same-origin",
            });
            const data = JSON.parse((await response.text()).replace(/^while\(1\);/, "")) as {
                custom_colors?: Record<string, string>;
            };
            for (const [key, color] of Object.entries(data.custom_colors || {})) setColor(key, color);
        } catch {
            // Every course falls back to its hashed palette color.
        }
    }

    // shortName is the nickname, else the course name -- what planner items
    // carry as context_name, so the dashboard and course pages agree.
    const envCourses = env?.STUDENT_PLANNER_COURSES;
    if (envCourses) {
        for (const course of envCourses) {
            const key = course.assetString || (course.id != null ? `course_${course.id}` : undefined);
            setName(key, course.shortName || course.originalName || course.courseCode || course.longName);
            setColor(key, course.color);
        }
    } else {
        // Course pages don't carry the list. context_name covers the names;
        // only nicknames need fetching.
        try {
            const { data } = await api<{ course_id?: number; nickname?: string }[]>("/api/v1/users/self/course_nicknames");
            for (const entry of data) setName(entry.course_id != null ? `course_${entry.course_id}` : undefined, entry.nickname);
        } catch {
            // Courses keep their plain names.
        }
    }

    return courses;
}
