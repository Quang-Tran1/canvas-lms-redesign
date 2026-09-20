/*
 * The To-Do panel's date state: the chosen scope and how far the user has
 * stepped from today. TodoPanel owns one of these and hands the pieces to the
 * scope selector and the date picker.
 */

import { useCallback, useMemo, useState } from "preact/hooks";
import { type DateRange, type Scope, rangeFor } from "./dateRange";

export interface UseDateRange {
    scope: Scope;
    /** Switching scope also returns to the current window. */
    setScope: (scope: Scope) => void;
    /** Whole scopes from today: 0 is the current one, -1 the previous. */
    offset: number;
    range: DateRange;
    goPrevious: () => void;
    goNext: () => void;
    /** Back to the day / week / month / semester containing today. */
    goToToday: () => void;
    isCurrent: boolean;
}

export function useDateRange(initialScope: Scope = "week"): UseDateRange {
    const [scope, setScopeState] = useState<Scope>(initialScope);
    const [offset, setOffset] = useState(0);

    // Recomputed only when the scope or the offset changes. A tab left open
    // across midnight keeps yesterday's window until something moves; the
    // planner refresh will re-read the clock when it lands.
    const range = useMemo(() => rangeFor(scope, offset), [scope, offset]);

    const setScope = useCallback((next: Scope) => {
        setScopeState(next);
        setOffset(0);      // "3 weeks ahead" means nothing once the scope is months
    }, []);

    const goPrevious = useCallback(() => setOffset((current) => current - 1), []);
    const goNext = useCallback(() => setOffset((current) => current + 1), []);
    const goToToday = useCallback(() => setOffset(0), []);

    return { scope, setScope, offset, range, goPrevious, goNext, goToToday, isCurrent: offset === 0 };
}
