/*
 * Loads the planner tasks for a date range and lets the user tick them off.
 *
 * Completed tasks stay in `tasks` but drop out of `open` -- the list renders
 * the open ones, while the progress bar needs the completed count too.
 */

import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { type DateRange } from "./dateRange";
import { type Task, fetchTasks, setComplete } from "./plannerApi";

export interface UsePlannerTasks {
    /** Everything in the window, completed included. */
    tasks: Task[];
    /** What the list shows: not yet done. */
    open: Task[];
    loading: boolean;
    /** Set when the load failed; null otherwise. */
    error: string | null;
    /** Ticks a task off. Updates immediately, rolls back if Canvas rejects it. */
    completeTask: (task: Task) => void;
}

export function usePlannerTasks(range: DateRange): UsePlannerTasks {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const start = range.start.getTime();
    const end = range.end.getTime();

    useEffect(() => {
        // Aborts the in-flight request when the range changes again, so a slow
        // earlier response can't land after a newer one.
        const controller = new AbortController();
        setLoading(true);
        setError(null);

        fetchTasks(range, controller.signal)
            .then((loaded) => {
                if (controller.signal.aborted) return;
                setTasks(loaded);
                setLoading(false);
            })
            .catch((cause: unknown) => {
                if (controller.signal.aborted) return;   // superseded, not a failure
                console.warn("[BetterLMS] could not load planner items:", cause);
                setError("Couldn't load your to-do list.");
                setTasks([]);
                setLoading(false);
            });

        return () => controller.abort();
        // range is rebuilt on every scope/offset change; the timestamps are what
        // actually decide the request.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [start, end]);

    const completeTask = useCallback((task: Task) => {
        // Optimistic: the card leaves the list now, and comes back if the
        // request fails, rather than making the user wait on a round trip.
        setTasks((current) => current.map((item) => (item.key === task.key ? { ...item, complete: true } : item)));

        setComplete(task, true)
            .then((overrideId) => {
                if (overrideId === undefined) return;
                // Remember the override so a later untick updates it rather than
                // creating a second one.
                setTasks((current) => current.map((item) => (item.key === task.key ? { ...item, overrideId } : item)));
            })
            .catch((cause: unknown) => {
                console.warn("[BetterLMS] could not mark the task complete:", cause);
                setTasks((current) => current.map((item) => (item.key === task.key ? { ...item, complete: false } : item)));
            });
    }, []);

    const open = useMemo(() => tasks.filter((task) => !task.complete), [tasks]);

    return { tasks, open, loading, error, completeTask };
}
