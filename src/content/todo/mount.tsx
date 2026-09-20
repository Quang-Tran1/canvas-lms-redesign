/*
 * Puts the To-Do widget into Canvas's right sidebar, and takes it back out
 * when the user switches it off in the popup.
 *
 * Canvas renders .Sidebar__TodoListContainer with React some time after the
 * page loads, so the sidebar is watched for it rather than queried once.
 * Canvas's own list is hidden by todo.css instead of removed from the DOM:
 * it's a React root, and React throws if the node it manages disappears.
 */

import { render } from "preact";
import { injectCss, removeCss } from "../inject-css";
import { TodoPanel } from "./TodoPanel";
import css from "./todo.css?inline";

const HOST_ID = "blms-todo";
const STYLE_ID = `${HOST_ID}-css`;
const CANVAS_TODO = ".Sidebar__TodoListContainer";
const SIDEBAR = "#right-side";

/* Non-null exactly while the widget is switched on, so this doubles as the
   "already running" flag and makes both calls below safe to repeat. */
let observer: MutationObserver | null = null;

export function setTodoEnabled(enabled: boolean): void {
    if (enabled) start();
    else stop();
}

function start(): void {
    if (observer) return;

    // Hides Canvas's own list. Injected before the first mount attempt so the
    // two lists are never on screen together.
    injectCss(STYLE_ID, css);

    // Re-runs after every DOM change so the widget comes back if Canvas
    // re-renders the sidebar underneath it.
    observer = new MutationObserver(tryMount);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    tryMount();
}

function stop(): void {
    if (!observer) return;

    observer.disconnect();
    observer = null;

    const host = document.getElementById(HOST_ID);
    if (host) {
        // Unmount rather than just dropping the node: this runs the effect
        // cleanups, which abort any planner request still in flight.
        render(null, host);
        host.remove();
    }

    // Last, so Canvas's list only reappears once ours is gone.
    removeCss(STYLE_ID);
}

function tryMount(): void {
    const sidebar = document.querySelector(SIDEBAR);
    if (!sidebar || !document.querySelector(CANVAS_TODO)) return;
    if (document.getElementById(HOST_ID)) return;       // already mounted

    const host = document.createElement("section");
    host.id = HOST_ID;
    sidebar.prepend(host);
    render(<TodoPanel />, host);
}
