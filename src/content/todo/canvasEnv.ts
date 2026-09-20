/*
 * Course colors and course names, read from the Canvas page.
 *
 * The content script runs in an isolated world, so it cannot see window.ENV
 * even though the page sets it. The ENV object is a plain JSON literal in an
 * inline <script> in <head>, so it is parsed straight out of the page source.
 * Where that fails (a Canvas page that doesn't render ENV, or a shape change),
 * the same data is fetched from the REST API instead.
 */

export interface CourseInfo {
    /** "#rrggbb" -- the user's own dashboard color for this course. */
    color?: string;
    /** The short code the dashboard shows, e.g. "COMM103". */
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

/* Walks forward from the opening brace to its match, so the scan stops at the
   end of the ENV object rather than at the first "}" inside a string value.
   Returns -1 if the braces never balance. */
function findObjectEnd(text: string, open: number): number {
    let depth = 0;
    let inString = false;
    for (let i = open; i < text.length; i++) {
        const character = text[i];
        if (inString) {
            if (character === "\\") i++;               // skip the escaped character
            else if (character === '"') inString = false;
        } else if (character === '"') {
            inString = true;
        } else if (character === "{") {
            depth++;
        } else if (character === "}") {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

export function readPageEnv(): CanvasEnv | null {
    for (const script of document.scripts) {
        if (script.src) continue;                     // only inline scripts carry ENV
        const text = script.textContent;
        if (!text) continue;

        const match = /\bENV\s*=\s*\{/.exec(text);
        if (!match) continue;

        const open = match.index + match[0].length - 1;
        const close = findObjectEnd(text, open);
        if (close < 0) continue;

        try {
            return JSON.parse(text.slice(open, close + 1)) as CanvasEnv;
        } catch {
            return null;                              // ENV is there but not plain JSON
        }
    }
    return null;
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
    const env = readPageEnv();

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

    const envCourses = env?.STUDENT_PLANNER_COURSES;
    if (envCourses) {
        for (const course of envCourses) {
            const key = course.assetString || (course.id != null ? `course_${course.id}` : undefined);
            setName(key, course.courseCode || course.shortName || course.originalName || course.longName);
            setColor(key, course.color);
        }
    }
    // No REST fallback for names: each planner item carries context_name, which
    // is the long course name but always present.

    return courses;
}
