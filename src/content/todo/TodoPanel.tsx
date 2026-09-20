import ScopeSelector from "./components/ScopeSelector"
import DatePicker from "./components/DatePicker"
import ProgressBar from "./components/ProgressBar"
import TaskCard from "./components/TaskCard"
import { useDateRange } from "./useDateRange"
import { usePlannerTasks } from "./usePlannerTasks"

export function TodoPanel() {
    // The window the list covers.
    const { scope, setScope, range, goPrevious, goNext, goToToday, isCurrent } = useDateRange()
    // Everything due inside it, refetched whenever the window moves.
    const { tasks, open, loading, error, completeTask } = usePlannerTasks(range)

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
            ) : loading && tasks.length === 0 ? (
                <p className="blms-todo__message">Loading…</p>
            ) : open.length === 0 ? (
                <p className="blms-todo__message">
                    {tasks.length === 0 ? "Nothing due. Enjoy the break!" : "Nicely done."}
                </p>
            ) : (
                <ul className="blms-todo__list">
                    {open.map((task) => (
                        <TaskCard key={task.key} task={task} onComplete={completeTask} />
                    ))}
                </ul>
            )}
        </>
    )
}
