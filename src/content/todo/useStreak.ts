/*
 * Works out the streak once per page.
 *
 * The streak at the end of yesterday is saved per school and user, so a load
 * only fetches and classifies what's been due since -- usually just today.
 * Without a saved one (first load, or no user id on the page) it reads the
 * whole planner history instead.
 *
 * Ticking a task off here can't change it: a checkoff only counts when it
 * comes before the deadline, and anything not yet due is still pending.
 */

import { useEffect, useState } from "preact/hooks";
import { STREAK_KEY } from "../../shared/settings";
import { readPageEnv } from "../pageEnv";
import { addDays, startOfDay } from "./dateRange";
import { fetchStreakItems } from "./plannerApi";
import { type Streak, type StreakCheckpoint, continueStreak, parseDay } from "./streak";

export interface StreakState {
    /** null while loading, or if the planner couldn't be read. */
    streak: Streak | null;
    loading: boolean;
}

export function useStreak(): StreakState {
    const [state, setState] = useState<StreakState>({ streak: null, loading: true });

    useEffect(() => {
        const controller = new AbortController();
        loadStreak(controller.signal)
            .then((streak) => setState({ streak, loading: false }))
            .catch((cause: unknown) => {
                if (controller.signal.aborted) return;
                console.warn("[BetterLMS] could not load the streak:", cause);
                setState({ streak: null, loading: false });
            });
        return () => controller.abort();
    }, []);

    return state;
}

async function loadStreak(signal: AbortSignal): Promise<Streak> {
    const now = new Date();
    const owner = checkpointOwner();
    const saved = owner ? ((await chrome.storage.local.get(STREAK_KEY))[STREAK_KEY] ?? {}) as Record<string, unknown> : {};
    const from = owner ? validCheckpoint(saved[owner], now) : undefined;

    // From the day after the checkpoint; the whole history without one.
    const items = await fetchStreakItems(from && addDays(parseDay(from.through)!, 1), signal);
    const { streak, checkpoint } = continueStreak(items, now, from);

    if (owner && !signal.aborted && JSON.stringify(checkpoint) !== JSON.stringify(from)) {
        await chrome.storage.local.set({ [STREAK_KEY]: { ...saved, [owner]: checkpoint } });
    }
    return streak;
}

/* "school.instructure.com/12345": one checkpoint per school per Canvas user,
   so a shared browser or a second school doesn't mix streaks. */
function checkpointOwner(): string | null {
    const userId = readPageEnv()?.current_user_id;
    if (typeof userId !== "string" && typeof userId !== "number") return null;
    return `${location.host}/${userId}`;
}

/* Storage is outside our control. A checkpoint that isn't before today (the
   clock or time zone moved back) is dropped, and the history is reread. */
function validCheckpoint(value: unknown, now: Date): StreakCheckpoint | undefined {
    if (!value || typeof value !== "object") return undefined;
    const { through, current, longest, started } = value as Partial<StreakCheckpoint>;
    const day = parseDay(through);
    const count = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;
    if (!day || day >= startOfDay(now) || !count(current) || !count(longest) || typeof started !== "boolean") {
        return undefined;
    }
    return { through: through!, current, longest, started };
}
