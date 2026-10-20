import ScopeSelector from "./components/ScopeSelector"
import DatePicker from "./components/DatePicker"
import ProgressBar from "./components/ProgressBar"
import TaskCard from "./components/TaskCard"
import { useDateRange } from "./useDateRange"
import { usePlannerTasks } from "./usePlannerTasks"
import { useExitList } from "./useExitList"
import { type Task } from "./plannerApi"

// Shared so the exit list sees the same array every loading render.
const NO_TASKS: Task[] = []

export function TodoPanel() {
    // The window the list covers.
    const { scope, setScope, range, goPrevious, goNext, goToToday, isCurrent } = useDateRange()
    // Everything due inside it, refetched whenever the window moves.
    const { tasks, open, loading, error, completeTask } = usePlannerTasks(range)
    // Clearing the list while a new window loads sends the old cards out on
    // click, not when the response lands. New cards wait for them to finish.
    const [cards, dropCard, entering] = useExitList(loading ? NO_TASKS : open, (task) => task.key)

    return (
        <>
            <h2 className="blms-todo__title">To Do</h2>
            <ScopeSelector scope={scope} onScope={setScope} />
            <DatePicker
                label={range.label}
                scope={scope}
                isCurrent={isCurrent}
                onPrevious={goPrevious}
                onNext={goNext}
                onToday={goToToday}
            />

            {/* The bar needs completed tasks too, so it gets the full list. */}
            {tasks.length > 0 && <ProgressBar tasks={tasks} />}

            {error ? (
                <p className="blms-todo__message blms-todo__message--error">{error}</p>
            ) : cards.length === 0 && !entering ? (
                <p className="blms-todo__message">
                    {loading ? "Loading…" : tasks.length === 0 ? "Nothing due. Enjoy the break!" : "Nicely done."}
                </p>
            ) : (
                <ul className="blms-todo__list">
                    {cards.map(({ item, leaving, leaveOrder }) => (
                        <TaskCard
                            key={item.key}
                            task={item}
                            onComplete={completeTask}
                            leaving={leaving}
                            leaveOrder={leaveOrder}
                            onExited={dropCard}
                        />
                    ))}
                </ul>
            )}
        </>
    )
}
