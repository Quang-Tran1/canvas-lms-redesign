/*
 * Puts the To-Do widget into Canvas's right sidebar.
 *
 * Canvas renders .Sidebar__TodoListContainer with React some time after the
 * page loads, so the sidebar is watched for it rather than queried once.
 * Canvas's own list is hidden by todo.css instead of removed from the DOM:
 * it's a React root, and React throws if the node it manages disappears.
 */

import { render } from "preact";
import { injectCss } from "../inject-css";
import { TodoPanel } from "./TodoPanel";
import css from "./todo.css?inline";

const HOST_ID = "blms-todo";
const CANVAS_TODO = ".Sidebar__TodoListContainer";
const SIDEBAR = "#right-side";

export function mountTodo(): void {
    // Straight away, so Canvas's list is hidden before it ever paints.
    injectCss(`${HOST_ID}-css`, css);

    const tryMount = () => {
        const sidebar = document.querySelector(SIDEBAR);
        if (!sidebar || !document.querySelector(CANVAS_TODO)) return;
        if (document.getElementById(HOST_ID)) return;       // already mounted

        const host = document.createElement("section");
        host.id = HOST_ID;
        sidebar.prepend(host);
        render(<TodoPanel />, host);
    };

    // Re-runs after every DOM change so the widget comes back if Canvas
    // re-renders the sidebar underneath it.
    new MutationObserver(tryMount).observe(document.documentElement, { childList: true, subtree: true });
    tryMount();
}
