import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/axios.js'
import './Dashboard.css'
import './MyTasks.css'
import './TaskCalendar.css'

const statusClass = {
    'To Do': 'todo',
    'In Progress': 'progress',
    Done: 'done',
}

const priorityClass = {
    Low: 'low',
    Medium: 'medium',
    High: 'high',
}

const TASK_STATUSES = ['To Do', 'In Progress', 'Done']
const STATUS_FILTERS = ['All', ...TASK_STATUSES]
const PRIORITY_FILTERS = ['All', 'Low', 'Medium', 'High']

// The week starts on Monday.
const WEEKDAYS = [
    { short: 'Mon', full: 'Monday' },
    { short: 'Tue', full: 'Tuesday' },
    { short: 'Wed', full: 'Wednesday' },
    { short: 'Thu', full: 'Thursday' },
    { short: 'Fri', full: 'Friday' },
    { short: 'Sat', full: 'Saturday' },
    { short: 'Sun', full: 'Sunday' },
]

const MAX_CHIPS = 3

const isText = (value) => typeof value === 'string' && value.trim() !== ''

// --- Date helpers (same rules as MyTasks, so a task is always on the date MyTasks shows) ---

// A calendar day as one number (for example 20261023). `month` is 0-based.
const dayNumber = (year, month, day) => year * 10000 + (month + 1) * 100 + day

// Today's calendar day in the user's local time zone.
const todayNumber = () => {
    const now = new Date()
    return dayNumber(now.getFullYear(), now.getMonth(), now.getDate())
}

// Due dates are date-only values stored as UTC midnight, so the day is read from the UTC
// parts. Returns null for a missing or invalid date.
const dueDayNumber = (value) => {
    if (!value) return null
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return dayNumber(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

const formatDueDate = (value) => {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' })
}

// A full date such as "Friday, 23 October 2026" for a day number. Built in UTC and shown in
// UTC so the local time zone can never shift it.
const formatDayLong = (year, month, day) =>
    new Date(Date.UTC(year, month, day)).toLocaleDateString(undefined, {
        dateStyle: 'full',
        timeZone: 'UTC',
    })

// 'overdue' | 'today' | 'upcoming' | 'none'. Done tasks and tasks without a valid
// due date are always 'none'.
const getDueState = (task, today) => {
    if (task.status === 'Done') return 'none'
    const due = dueDayNumber(task.dueDate)
    if (due === null) return 'none'
    if (due < today) return 'overdue'
    if (due === today) return 'today'
    return 'upcoming'
}

// Status and priority must both match.
const matchesFilters = (task, statusFilter, priorityFilter) =>
    (statusFilter === 'All' || task.status === statusFilter) &&
    (priorityFilter === 'All' || task.priority === priorityFilter)

// Keeps only entries that can be shown safely. The server's order is kept.
const cleanTasks = (tasks) =>
    tasks.filter((task) => task && typeof task === 'object' && isText(task._id))

const taskTitle = (task) => (isText(task.title) ? task.title : 'Untitled task')

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`

// One read-only task row, used in the day panel and the "No due date" list.
function TaskRow({ task, today }) {
    const projectId = task.project?._id
    const projectName = task.project?.name
    const dueState = getDueState(task, today)
    const due = formatDueDate(task.dueDate)

    return (
        <li className={`tc-task${task.status === 'Done' ? ' tc-task-done' : ''}`}>
            <div className="tc-task-main">
                <strong className="tc-task-title">{taskTitle(task)}</strong>
                <span className="tc-task-project">
                    Project:{' '}
                    {isText(projectId) ? (
                        <Link
                            to={`/projects/${encodeURIComponent(projectId)}`}
                            className="mt-project-link"
                        >
                            {isText(projectName) ? projectName : 'Untitled project'}
                        </Link>
                    ) : (
                        <span className="mt-muted">Unknown project</span>
                    )}
                </span>
            </div>
            <div className="tc-task-meta">
                <span className={`dash-status mt-status-${statusClass[task.status] ?? 'other'}`}>
                    {isText(task.status) ? task.status : 'No status'}
                </span>
                {isText(task.priority) && (
                    <span
                        className={`dash-status${priorityClass[task.priority]
                            ? ` mt-priority-${priorityClass[task.priority]}`
                            : ''
                            }`}
                    >
                        {task.priority} priority
                    </span>
                )}
                {dueState === 'overdue' && (
                    <span className="mt-badge mt-badge-overdue">Overdue</span>
                )}
                {dueState === 'today' && (
                    <span className="mt-badge mt-badge-today">Due today</span>
                )}
                {due && (
                    <span className={`mt-due${dueState === 'overdue' ? ' mt-due-overdue' : ''}`}>
                        Due {due}
                    </span>
                )}
            </div>
        </li>
    )
}

export default function TaskCalendar() {
    const [tasks, setTasks] = useState([])
    const [viewState, setViewState] = useState('loading') // loading | ready | error
    const [errorMessage, setErrorMessage] = useState('')
    const [reloadKey, setReloadKey] = useState(0)
    const [statusFilter, setStatusFilter] = useState('All')
    const [priorityFilter, setPriorityFilter] = useState('All')
    const [today, setToday] = useState(todayNumber)
    const [viewYear, setViewYear] = useState(() => new Date().getFullYear())
    const [viewMonth, setViewMonth] = useState(() => new Date().getMonth()) // 0-based
    const [selectedDay, setSelectedDay] = useState(null) // a day number, or null
    const panelRef = useRef(null)

    useEffect(() => {
        let cancelled = false

        api
            .get('/tasks')
            .then(({ data }) => {
                if (cancelled) return
                if (!Array.isArray(data?.tasks)) {
                    setErrorMessage('Received an unexpected response from the server.')
                    setViewState('error')
                    return
                }
                setTasks(cleanTasks(data.tasks))
                setViewState('ready')
            })
            .catch((err) => {
                if (cancelled) return
                setErrorMessage(err.response?.data?.message || 'Could not load your tasks.')
                setViewState('error')
            })

        return () => {
            cancelled = true
        }
    }, [reloadKey])

    // Refresh "today" at each local midnight so badges stay correct on a page left open
    useEffect(() => {
        let timer

        const scheduleNext = () => {
            const now = new Date()
            const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
            timer = setTimeout(() => {
                setToday(todayNumber())
                scheduleNext()
            }, nextMidnight - now)
        }

        scheduleNext()
        return () => clearTimeout(timer)
    }, [])

    const retry = () => {
        setErrorMessage('')
        setViewState('loading')
        setReloadKey((key) => key + 1)
    }

    const clearFilters = () => {
        setStatusFilter('All')
        setPriorityFilter('All')
    }

    // `new Date(y, m + delta, 1)` rolls the year over by itself (December -> January).
    const shiftMonth = (delta) => {
        const next = new Date(viewYear, viewMonth + delta, 1)
        setViewYear(next.getFullYear())
        setViewMonth(next.getMonth())
        setSelectedDay(null)
    }

    const goToToday = () => {
        const now = todayNumber()
        setViewYear(Math.floor(now / 10000))
        setViewMonth(Math.floor((now % 10000) / 100) - 1)
        setSelectedDay(now)
    }

    const selectDay = (day) => {
        setSelectedDay(day)
        // Put the details in view on narrow screens, where the panel sits below the grid.
        panelRef.current?.scrollIntoView?.({ block: 'nearest' })
    }

    const filtersActive = statusFilter !== 'All' || priorityFilter !== 'All'

    // Filter once, then split into "has a due day" (grouped by day) and "no due date".
    const { byDay, noDueDate, shownCount } = useMemo(() => {
        const shown = tasks.filter((task) => matchesFilters(task, statusFilter, priorityFilter))
        const grouped = new Map()
        const undated = []
        for (const task of shown) {
            const key = dueDayNumber(task.dueDate)
            if (key === null) {
                undated.push(task)
            } else if (grouped.has(key)) {
                grouped.get(key).push(task)
            } else {
                grouped.set(key, [task])
            }
        }
        return { byDay: grouped, noDueDate: undated, shownCount: shown.length }
    }, [tasks, statusFilter, priorityFilter])

    // Grid: blanks before day 1 (Monday-first), the days, then blanks to complete the week.
    const leading = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
    const totalCells = Math.ceil((leading + daysInMonth) / 7) * 7
    const cells = Array.from({ length: totalCells }, (_, i) => {
        const day = i - leading + 1
        return day >= 1 && day <= daysInMonth ? day : null
    })

    const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
    })

    let dueInMonth = 0
    for (let d = 1; d <= daysInMonth; d += 1) {
        dueInMonth += byDay.get(dayNumber(viewYear, viewMonth, d))?.length ?? 0
    }

    const selectedTasks = selectedDay === null ? [] : byDay.get(selectedDay) ?? []
    const selectedLabel =
        selectedDay === null
            ? ''
            : formatDayLong(
                Math.floor(selectedDay / 10000),
                Math.floor((selectedDay % 10000) / 100) - 1,
                selectedDay % 100
            )

    // Spoken to screen-reader users when a day is chosen, because the panel is out of focus.
    const selectedAnnouncement =
        selectedDay === null
            ? ''
            : `${selectedLabel}: ${selectedTasks.length === 0
                ? 'no tasks due'
                : `${plural(selectedTasks.length, 'task', 'tasks')} due`
            }.`

    return (
        <div className="mt-page">
            <header className="mt-header">
                <span className="mt-brand">ProjectFlow</span>
                <Link to="/dashboard" className="mt-back">
                    ← Back to dashboard
                </Link>
            </header>

            <main className="tc-content">
                <div className="mt-heading">
                    <h1 className="mt-title">Task Calendar</h1>
                    <nav className="tc-switch" aria-label="Task views">
                        <Link to="/my-tasks" className="tc-switch-item">
                            List
                        </Link>
                        <span className="tc-switch-item tc-switch-active" aria-current="page">
                            Calendar
                        </span>
                    </nav>
                </div>

                {viewState === 'loading' && (
                    <p className="dash-state" role="status">
                        Loading your tasks...
                    </p>
                )}

                {viewState === 'error' && (
                    <div className="dash-error" role="alert">
                        <p>{errorMessage}</p>
                        <button type="button" className="dash-retry" onClick={retry}>
                            Try again
                        </button>
                    </div>
                )}

                {viewState === 'ready' && tasks.length === 0 && (
                    <div className="dash-empty">
                        <strong>No tasks yet</strong>
                        <span className="dash-muted">
                            Open one of your projects and create a task. It will show up here.
                        </span>
                        <Link to="/dashboard" className="mt-empty-link">
                            Go to your projects
                        </Link>
                    </div>
                )}

                {viewState === 'ready' && tasks.length > 0 && (
                    <>
                        <div className="dash-filters">
                            <div className="dash-filter-field">
                                <label htmlFor="tc-status-filter">Status</label>
                                <select
                                    id="tc-status-filter"
                                    value={statusFilter}
                                    onChange={(e) => setStatusFilter(e.target.value)}
                                >
                                    {STATUS_FILTERS.map((status) => (
                                        <option key={status} value={status}>
                                            {status}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="dash-filter-field">
                                <label htmlFor="tc-priority-filter">Priority</label>
                                <select
                                    id="tc-priority-filter"
                                    value={priorityFilter}
                                    onChange={(e) => setPriorityFilter(e.target.value)}
                                >
                                    {PRIORITY_FILTERS.map((priority) => (
                                        <option key={priority} value={priority}>
                                            {priority}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="dash-filter-meta" aria-live="polite">
                                {filtersActive && (
                                    <span>
                                        Showing {shownCount} of {plural(tasks.length, 'task', 'tasks')}
                                    </span>
                                )}
                                {filtersActive && (
                                    <button
                                        type="button"
                                        className="dash-filter-clear"
                                        onClick={clearFilters}
                                    >
                                        Clear filters
                                    </button>
                                )}
                            </div>
                        </div>

                        <section className="tc-calendar" aria-label="Monthly calendar">
                            <div className="tc-toolbar">
                                <div className="tc-nav">
                                    <button
                                        type="button"
                                        className="tc-btn"
                                        onClick={() => shiftMonth(-1)}
                                        aria-label="Previous month"
                                    >
                                        ← Prev
                                    </button>
                                    <button
                                        type="button"
                                        className="tc-btn"
                                        onClick={() => shiftMonth(1)}
                                        aria-label="Next month"
                                    >
                                        Next →
                                    </button>
                                    <button type="button" className="tc-btn" onClick={goToToday}>
                                        Today
                                    </button>
                                </div>
                                <h2 id="tc-month-heading" className="tc-month" aria-live="polite">
                                    {monthLabel}
                                </h2>
                                <span className="tc-month-count">
                                    {dueInMonth === 0
                                        ? 'No tasks due this month'
                                        : `${plural(dueInMonth, 'task', 'tasks')} due this month`}
                                </span>
                            </div>

                            <div className="tc-weekdays">
                                {WEEKDAYS.map((weekday) => (
                                    <span key={weekday.short} className="tc-weekday">
                                        <span aria-hidden="true">{weekday.short}</span>
                                        <span className="tc-sr-only">{weekday.full}</span>
                                    </span>
                                ))}
                            </div>

                            <div className="tc-grid" role="group" aria-labelledby="tc-month-heading">
                                {cells.map((day, index) => {
                                    if (day === null) {
                                        return (
                                            <div
                                                key={`blank-${index}`}
                                                className="tc-cell tc-cell-blank"
                                                aria-hidden="true"
                                            />
                                        )
                                    }

                                    const key = dayNumber(viewYear, viewMonth, day)
                                    const dayTasks = byDay.get(key) ?? []
                                    const isToday = key === today
                                    const isSelected = key === selectedDay
                                    const hasOverdue = dayTasks.some(
                                        (task) => getDueState(task, today) === 'overdue'
                                    )
                                    const label =
                                        formatDayLong(viewYear, viewMonth, day) +
                                        `, ${dayTasks.length === 0 ? 'no tasks' : plural(dayTasks.length, 'task', 'tasks')}` +
                                        (hasOverdue ? ', includes overdue' : '') +
                                        (isSelected ? ', selected' : '')

                                    return (
                                        <div
                                            key={key}
                                            type="button"
                                            className={`tc-cell tc-day${isToday ? ' tc-today' : ''}${isSelected ? ' tc-selected' : ''
                                                }`}
                                            aria-label={label}
                                            aria-controls="tc-day-panel"
                                            aria-current={isToday ? 'date' : undefined}
                                            onClick={() => selectDay(key)}
                                        >
                                            <button
                                                type="button"
                                                className="tc-daynum"
                                                aria-label={`Select ${formatDayLong(viewYear, viewMonth, day)}`}
                                                aria-controls="tc-day-panel"
                                                onClick={() => selectDay(key)}
                                            >
                                                {day}
                                            </button>
                                            {dayTasks.slice(0, MAX_CHIPS).map((task) => {
                                                const state = getDueState(task, today)
                                                const projectId = task.project?._id

                                                const chipClass = `tc-chip tc-chip-${priorityClass[task.priority] ?? 'none'
                                                    }${task.status === 'Done' ? ' tc-chip-done' : ''}${state === 'overdue' ? ' tc-chip-overdue' : ''
                                                    }`

                                                return projectId ? (
                                                    <Link
                                                        key={task._id}
                                                        to={`/projects/${encodeURIComponent(projectId)}`}
                                                        title={`Open project: ${taskTitle(task)}`}
                                                        className={chipClass}
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        {taskTitle(task)}
                                                    </Link>
                                                ) : (
                                                    <span key={task._id} title={taskTitle(task)} className={chipClass}>
                                                        {taskTitle(task)}
                                                    </span>
                                                )
                                            })}
                                            {dayTasks.length > MAX_CHIPS && (
                                                <span className="tc-more">
                                                    +{dayTasks.length - MAX_CHIPS} more
                                                </span>
                                            )}
                                            {dayTasks.length > 0 && (
                                                <span
                                                    className={`tc-count${hasOverdue ? ' tc-count-overdue' : ''}`}
                                                    aria-hidden="true"
                                                >
                                                    {dayTasks.length}
                                                </span>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>

                            {filtersActive && shownCount === 0 && (
                                <p className="tc-note">
                                    No tasks match your filters.{' '}
                                    <button
                                        type="button"
                                        className="dash-filter-clear"
                                        onClick={clearFilters}
                                    >
                                        Clear filters
                                    </button>
                                </p>
                            )}
                        </section>

                        <p className="tc-sr-only" role="status">
                            {selectedAnnouncement}
                        </p>

                        <section
                            id="tc-day-panel"
                            className="tc-panel"
                            ref={panelRef}
                            aria-label="Selected day"
                        >
                            {selectedDay === null ? (
                                <p className="tc-panel-empty">
                                    Select a day to see its tasks.
                                </p>
                            ) : (
                                <>
                                    <h2 className="tc-panel-title">{selectedLabel}</h2>
                                    {selectedTasks.length === 0 ? (
                                        <p className="tc-panel-empty">No tasks due this day.</p>
                                    ) : (
                                        <ul className="tc-task-list">
                                            {selectedTasks.map((task) => (
                                                <TaskRow key={task._id} task={task} today={today} />
                                            ))}
                                        </ul>
                                    )}
                                </>
                            )}
                        </section>

                        <section className="tc-panel" aria-label="Tasks with no due date">
                            <h2 className="tc-panel-title">No due date ({noDueDate.length})</h2>
                            {noDueDate.length === 0 ? (
                                <p className="tc-panel-empty">
                                    {filtersActive
                                        ? 'No undated tasks match your filters.'
                                        : 'Every task has a due date.'}
                                </p>
                            ) : (
                                <ul className="tc-task-list">
                                    {noDueDate.map((task) => (
                                        <TaskRow key={task._id} task={task} today={today} />
                                    ))}
                                </ul>
                            )}
                        </section>
                    </>
                )}
            </main>
        </div>
    )
}