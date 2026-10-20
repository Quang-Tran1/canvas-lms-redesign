/*
 * Keeps items on screen for a moment after they leave a list, so they can
 * play an exit animation instead of vanishing.
 *
 * When cards leave and new ones arrive in the same change (moving to another
 * date), the new ones wait until every leaving card has finished, then come in
 * ENTER_DELAY later, so the two animations don't overlap.
 */

import { useCallback, useEffect, useState } from "preact/hooks";

/** Gap between the last card finishing its exit and the new cards coming in. */
const ENTER_DELAY = 100;

export interface ExitEntry<T> {
    item: T;
    /** True once the item is gone from the real list and is animating out. */
    leaving: boolean;
    /** 0 for the first card to leave in a batch, 1 for the next... drives the stagger. */
    leaveOrder: number;
}

export function useExitList<T>(
    items: T[],
    getKey: (item: T) => string,
): [ExitEntry<T>[], (key: string) => void, boolean] {
    const [list, setList] = useState<ExitEntry<T>[]>(() =>
        items.map((item) => ({ item, leaving: false, leaveOrder: 0 })),
    );

    useEffect(() => {
        const stillHere = new Set(items.map(getKey));

        setList((previous) => {
            const exiting = previous.some((entry) => entry.leaving || !stillHere.has(getKey(entry.item)));
            // Cards that are on screen and staying; newcomers only join right away
            // when nothing is animating out.
            const shown = new Set(previous.filter((entry) => !entry.leaving).map((entry) => getKey(entry.item)));
            const next = items
                .filter((item) => !exiting || shown.has(getKey(item)))
                .map((item) => ({ item, leaving: false, leaveOrder: 0 }));
            const nextKeys = new Set(next.map((entry) => getKey(entry.item)));
            let order = 0;

            previous.forEach((entry, index) => {
                if (nextKeys.has(getKey(entry.item))) return;
                // Not shown any more: keep it, flagged, near where it was.
                const leaveOrder = entry.leaving ? entry.leaveOrder : order++;
                next.splice(Math.min(index, next.length), 0, { ...entry, leaving: true, leaveOrder });
            });

            return next;
        });
        // getKey is a fresh arrow every render; only the items decide this.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items]);

    // Items held back while the old cards were leaving.
    const shownKeys = new Set(list.map((entry) => getKey(entry.item)));
    const waiting = items.some((item) => !shownKeys.has(getKey(item)));
    const exiting = list.some((entry) => entry.leaving);

    // Once the last card is gone, let the held-back ones in.
    useEffect(() => {
        if (!waiting || exiting) return;
        const timer = setTimeout(() => {
            setList(items.map((item) => ({ item, leaving: false, leaveOrder: 0 })));
        }, ENTER_DELAY);
        return () => clearTimeout(timer);
    }, [waiting, exiting, items]);

    // Called once a card's exit animation finishes: now it can really go.
    const drop = useCallback((key: string) => {
        setList((current) => current.filter((entry) => getKey(entry.item) !== key));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return [list, drop, waiting];
}
