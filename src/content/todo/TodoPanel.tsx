import ScopeSelector from "./components/ScopeSelector"
import DatePicker from "./components/DatePicker"
import ProgressBar from "./components/ProgressBar"
import TaskCard from "./components/TaskCard"

export function TodoPanel() {
    return (
        <>
            <h2 className="blms-todo__title">To Do</h2>
            <ScopeSelector></ScopeSelector>
            <DatePicker></DatePicker>
            <ProgressBar></ProgressBar>
            <TaskCard></TaskCard>
            <TaskCard></TaskCard>
            <TaskCard></TaskCard>
            {/* <p style="color:var(--secondary-text-color); text-align:center; margin: 40px 0;">Nicely done.</p> */}
            
        </>
    )
}
