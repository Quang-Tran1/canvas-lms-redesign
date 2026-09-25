/* One stylesheet for every grades feature. Safe to call from each of them. */

import { injectCss } from "../inject-css";
import css from "./grades.css?inline";

export function injectGradesCss(): void {
    injectCss("blms-grades-css", css);
}
