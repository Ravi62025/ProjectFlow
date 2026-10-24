import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/axios.js'
import './Dashboard.css'
import './MyTasks.css'

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

const SORT_OPTIONS = [
    { value: 'newest', label: 'Newest first' },
    { value: 'oldest', label: 'Oldest first' },
    { value: 'due-asc', label: 'Due date: earliest first' },
    { value: 'due-desc', label: 'Due date: latest first' },
    { value: 'priority-desc', label: 'Priority: highest first' },
    { value: 'priority-asc', label: 'Priority: lowest first' },
]
const DEFAULT_SORT = 'newest'

const PAGE_SIZE = 10

const isText = (value) => typeof value === 'string' && value.trim() !== ''

// Lower-case text for searching. Anything that is not a string counts as empty.
const searchable = (value) => (typeof value === 'string' ? value.toLowerCase() : '')

// Due dates are date-only values stored as UTC midnight, so they are shown in UTC
// (the same as the project task list). Returns '' for a missing or invalid date.
const formatDueDate = (value) => {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' })
}

// A calendar day as one number (for example 20261023), so days compare with < and ===.
// `month` is 0-based, like Date.getMonth().
const dayNumber = (year, month, day) => year * 10000 + (month + 1) * 100 + day

// Today's calendar day in the user's local time zone.
const todayNumber = () => {
    const now = new Date()
    return dayNumber(now.getFullYear(), now.getMonth(), now.getDate())
}

// The calendar day a due date refers to, or null if missing or invalid. Due dates are
// date-only values stored as UTC midnight, so the day is read from the UTC parts. This is
// the same rule formatDueDate uses, so the badge always agrees with the date shown.
const dueDayNumber = (value) => {
    if (!value) return null
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return dayNumber(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

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

// Search text, status and priority all have to match.
const matchesView = (task, searchText, statusFilter, priorityFilter) =>
    (searchText === '' ||
        searchable(task.title).includes(searchText) ||
        searchable(task.project?.name).includes(searchText)) &&
    (statusFilter === 'All' || task.status === statusFilter) &&
    (priorityFilter === 'All' || task.priority === priorityFilter)

const withoutKey = (object, key) => {
    const copy = { ...object }
    delete copy[key]
    return copy
}

// Keeps only entries that can be shown safely. The server's order is kept.
const cleanTasks = (tasks) => tasks.filter((task) => task && typeof task === 'object' && isText(task._id))

// Time (ms) a task was created, or null if unknown. Falls back to the timestamp
// embedded in a MongoDB ObjectId when `createdAt` is missing or invalid.
const createdTime = (task) => {
    if (task.createdAt) {
        const time = new Date(task.createdAt).getTime()
        if (!Number.isNaN(time)) return time
    }
    if (/^[0-9a-f]{24}$/i.test(task._id)) return parseInt(task._id.slice(0, 8), 16) * 1000
    return null
}

// Time (ms) a task is due, or null when there is no valid due date.
const dueTime = (task) => {
    if (!task.dueDate) return null
    const time = new Date(task.dueDate).getTime()
    return Number.isNaN(time) ? null : time
}

// Priority as a number so it can be compared (High is the largest). Returns null for a
// missing or unknown priority.
const PRIORITY_RANK = { Low: 1, Medium: 2, High: 3 }
const priorityRank = (task) => PRIORITY_RANK[task.priority] ?? null

// Compares two numbers (times, or priority ranks). A missing value (null) always sorts
// after a known one, in both directions.
const compareTimes = (a, b, direction) => {
    if (a === null && b === null) return 0
    if (a === null) return 1
    if (b === null) return -1
    return direction === 'asc' ? a - b : b - a
}

const SORT_COMPARATORS = {
    newest: (a, b) => compareTimes(createdTime(a), createdTime(b), 'desc'),
    oldest: (a, b) => compareTimes(createdTime(a), createdTime(b), 'asc'),
    'due-asc': (a, b) => compareTimes(dueTime(a), dueTime(b), 'asc'),
    'due-desc': (a, b) => compareTimes(dueTime(a), dueTime(b), 'desc'),
    // Tasks with the same priority are ordered by the earliest due date (no date last)
    'priority-desc': (a, b) =>
        compareTimes(priorityRank(a), priorityRank(b), 'desc') ||
        compareTimes(dueTime(a), dueTime(b), 'asc'),
    'priority-asc': (a, b) =>
        compareTimes(priorityRank(a), priorityRank(b), 'asc') ||
        compareTimes(dueTime(a), dueTime(b), 'asc'),
}

// Returns a sorted copy; the input array is never changed. Ties keep their
// original (server) order.
const sortTasks = (tasks, sortKey) => {
    const compare = SORT_COMPARATORS[sortKey] ?? SORT_COMPARATORS[DEFAULT_SORT]
    return tasks
        .map((task, index) => ({ task, index }))
        .sort((a, b) => compare(a.task, b.task) || a.index - b.index)
        .map(({ task }) => task)
}

export default function MyTasks() {
    const [tasks, setTasks] = useState([])
    const [viewState, setViewState] = useState('loading') // loading | ready | error
    const [errorMessage, setErrorMessage] = useState('')
    const [reloadKey, setReloadKey] = useState(0)
    const [statusFilter, setStatusFilter] = useState('All')
    const [priorityFilter, setPriorityFilter] = useState('All')
    const [sortKey, setSortKey] = useState(DEFAULT_SORT)
    const [page, setPage] = useState(1) // 1-based page number
    const [search, setSearch] = useState('')
    const searchRef = useRef(null)
    const listRef = useRef(null)
    const [pendingStatus, setPendingStatus] = useState({}) // task id -> status being saved
    const [updateErrors, setUpdateErrors] = useState({}) // task id -> error message
    const [notice, setNotice] = useState('')
    const [today, setToday] = useState(todayNumber)
    const updatingRef = useRef(new Set()) // task ids with a request in flight
    const viewRef = useRef(null) // the current search and filters, for use after a request

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

    // Hide the notice after a few seconds
    useEffect(() => {
        if (!notice) return
        const timer = setTimeout(() => setNotice(''), 4000)
        return () => clearTimeout(timer)
    }, [notice])

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
        setPage(1)
        setReloadKey((key) => key + 1)
    }

    const clearFilters = () => {
        setStatusFilter('All')
        setPriorityFilter('All')
        setPage(1)
    }

    const clearSearch = () => {
        setSearch('')
        setPage(1)
        searchRef.current?.focus()
    }

    const clearAll = () => {
        setSearch('')
        clearFilters()
        searchRef.current?.focus()
    }

    // Each of these changes the view and resets to page 1 in the same batched update.
    // Typing only spaces at the ends of the search doesn't reset the page, because the
    // matching tasks haven't changed.
    const changeSearch = (value) => {
        if (value.trim().toLowerCase() !== search.trim().toLowerCase()) setPage(1)
        setSearch(value)
    }

    const changeStatusFilter = (value) => {
        setStatusFilter(value)
        setPage(1)
    }

    const changePriorityFilter = (value) => {
        setPriorityFilter(value)
        setPage(1)
    }

    const changeSort = (value) => {
        setSortKey(value)
        setPage(1)
    }

    // Search and filters work on the tasks already loaded. The search text must be in the
    // task title or the project name (ignoring case and surrounding spaces), and both
    // filters must match. The result is then sorted (as a copy) and finally split into pages.
    const searchText = search.trim().toLowerCase()
    const filtersActive = statusFilter !== 'All' || priorityFilter !== 'All'
    const visibleTasks = sortTasks(
        tasks.filter((task) => matchesView(task, searchText, statusFilter, priorityFilter)),
        sortKey
    )

    // Pagination. `currentPage` is the stored page kept within 1..totalPages. It is only
    // calculated here, never written back, so it can't compete with the resets in the
    // handlers above.
    const totalMatching = visibleTasks.length
    const totalPages = Math.max(1, Math.ceil(totalMatching / PAGE_SIZE))
    const currentPage = Math.min(page, totalPages)
    const pageStart = (currentPage - 1) * PAGE_SIZE
    const pagedTasks = visibleTasks.slice(pageStart, pageStart + PAGE_SIZE)

    // Moves focus to the top of the list so keyboard and screen-reader users land on the
    // new page, even when the button they pressed becomes disabled.
    const goToPage = (target) => {
        setPage(Math.min(Math.max(target, 1), totalPages))
        listRef.current?.focus()
    }

    useEffect(() => {
        viewRef.current = { searchText, statusFilter, priorityFilter }
    })

    // Saves a new status with the same request the project's task list uses.
    // The card changes only after the server confirms, so a failure keeps the old status.
    const changeStatus = async (task, newStatus) => {
        const projectId = task.project?._id
        if (!isText(projectId) || newStatus === task.status) return
        if (updatingRef.current.has(task._id)) return // ignore duplicate changes

        updatingRef.current.add(task._id)
        setPendingStatus((prev) => ({ ...prev, [task._id]: newStatus }))
        setUpdateErrors((prev) => withoutKey(prev, task._id))
        setNotice('')

        try {
            const { data } = await api.put(
                `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(task._id)}`,
                { status: newStatus }
            )
            const saved = data?.task
            if (!saved || !TASK_STATUSES.includes(saved.status)) {
                setUpdateErrors((prev) => ({
                    ...prev,
                    [task._id]:
                        'The server sent an unexpected response. Reload the page to check this task.',
                }))
                return
            }

            // Only the status is taken from the response: its `project` is just an id,
            // and this page needs the { _id, name } object it already has.
            setTasks((prev) =>
                prev.map((t) =>
                    t._id === task._id
                        ? { ...t, status: saved.status, updatedAt: saved.updatedAt ?? t.updatedAt }
                        : t
                )
            )

            const view = viewRef.current
            const hidden =
                view &&
                !matchesView(
                    { ...task, status: saved.status },
                    view.searchText,
                    view.statusFilter,
                    view.priorityFilter
                )
            if (hidden) {
                setNotice(
                    `"${isText(task.title) ? task.title : 'Untitled task'}" is now ${saved.status}. ` +
                        'It is hidden by your current search or filters.'
                )
            }
        } catch (err) {
            let message = 'Could not update the task. Please try again.'
            if (!err.response) {
                message = 'Could not reach the server. Check your connection and try again.'
            } else if (err.response.status === 404) {
                message = 'This task no longer exists. Reload the page to refresh your list.'
            } else if (err.response.data?.message) {
                message = err.response.data.message
            }
            setUpdateErrors((prev) => ({ ...prev, [task._id]: message }))
        } finally {
            updatingRef.current.delete(task._id)
            setPendingStatus((prev) => withoutKey(prev, task._id))
        }
    }


    const projectCount = new Set(
        tasks.map((task) => task.project?._id).filter(isText)
    ).size

    return (
        <div className="mt-page">
            <header className="mt-header">
                <span className="mt-brand">ProjectFlow</span>
                <Link to="/dashboard" className="mt-back">
                    ← Back to dashboard
                </Link>
            </header>

            <main className="mt-content">
                <div className="mt-heading">
                    <h1 className="mt-title">My Tasks</h1>
                    {viewState === 'ready' && tasks.length > 0 && (
                        <p className="mt-summary">
                            {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
                            {projectCount > 0 &&
                                ` in ${projectCount} ${projectCount === 1 ? 'project' : 'projects'}`}
                        </p>
                    )}
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
                    <div className="dash-filters">
                        <div className="dash-filter-field dash-filter-search">
                            <label htmlFor="my-tasks-search">Search</label>
                            <input
                                id="my-tasks-search"
                                ref={searchRef}
                                type="search"
                                value={search}
                                onChange={(e) => changeSearch(e.target.value)}
                                placeholder="Search by task or project name"
                            />
                        </div>
                        <div className="dash-filter-field">
                            <label htmlFor="my-tasks-status-filter">Status</label>
                            <select
                                id="my-tasks-status-filter"
                                value={statusFilter}
                                onChange={(e) => changeStatusFilter(e.target.value)}
                            >
                                {STATUS_FILTERS.map((status) => (
                                    <option key={status} value={status}>
                                        {status}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="dash-filter-field">
                            <label htmlFor="my-tasks-priority-filter">Priority</label>
                            <select
                                id="my-tasks-priority-filter"
                                value={priorityFilter}
                                onChange={(e) => changePriorityFilter(e.target.value)}
                            >
                                {PRIORITY_FILTERS.map((priority) => (
                                    <option key={priority} value={priority}>
                                        {priority}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="dash-filter-field mt-sort-field">
                            <label htmlFor="my-tasks-sort">Sort by</label>
                            <select
                                id="my-tasks-sort"
                                value={sortKey}
                                onChange={(e) => changeSort(e.target.value)}
                            >
                                {SORT_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="dash-filter-meta" aria-live="polite">
                            {(filtersActive || searchText !== '') && (
                                <span>
                                    Showing {visibleTasks.length} of {tasks.length}{' '}
                                    {tasks.length === 1 ? 'task' : 'tasks'}
                                </span>
                            )}
                            {search !== '' && (
                                <button
                                    type="button"
                                    className="dash-filter-clear"
                                    onClick={clearSearch}
                                >
                                    Clear search
                                </button>
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
                )}

                {notice && (
                    <div className="dash-success" role="status">
                        {notice}
                    </div>
                )}

                {viewState === 'ready' && tasks.length > 0 && visibleTasks.length === 0 && (
                    <div className="dash-empty">
                        <strong>
                            {searchText !== ''
                                ? 'No tasks match your search'
                                : 'No tasks match your filters'}
                        </strong>
                        <span className="dash-muted">
                            {searchText !== ''
                                ? 'Try different words, or clear the search and filters.'
                                : 'Try a different status or priority, or clear the filters.'}
                        </span>
                        <div>
                            <button
                                type="button"
                                className="dash-filter-clear"
                                onClick={clearAll}
                            >
                                {searchText !== '' ? 'Clear search and filters' : 'Clear filters'}
                            </button>
                        </div>
                    </div>
                )}

                {viewState === 'ready' && visibleTasks.length > 0 && (
                    <>
                        <ul className="mt-list" ref={listRef} tabIndex={-1}>
                            {pagedTasks.map((task) => {
                                const projectId = task.project?._id
                                const projectName = task.project?.name
                                const due = formatDueDate(task.dueDate)
                                const dueState = getDueState(task, today)
                                const pending = pendingStatus[task._id]
                                const isUpdating = pending !== undefined
                                const currentStatus = isUpdating ? pending : task.status
                                const knownStatus = TASK_STATUSES.includes(currentStatus)
                                const canUpdate = isText(projectId)
                                const cardTitle = isText(task.title) ? task.title : 'Untitled task'

                                return (
                                    <li key={task._id} className="mt-item">
                                        <div className="mt-item-main">
                                            <strong className="mt-item-title">
                                                {isText(task.title) ? task.title : 'Untitled task'}
                                            </strong>
                                            <span className="mt-item-project">
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
                                            {updateErrors[task._id] && (
                                                <span className="mt-item-error" role="alert">
                                                    {updateErrors[task._id]}
                                                </span>
                                            )}
                                        </div>

                                        <div className="mt-item-meta">
                                            <select
                                                className={`mt-status-select mt-status-${
                                                    statusClass[currentStatus] ?? 'other'
                                                }`}
                                                aria-label={`Status for ${cardTitle}`}
                                                aria-busy={isUpdating}
                                                value={knownStatus ? currentStatus : ''}
                                                disabled={isUpdating || !canUpdate}
                                                title={
                                                    canUpdate
                                                        ? undefined
                                                        : "This task's project is unknown, so its status can't be changed."
                                                }
                                                onChange={(e) => changeStatus(task, e.target.value)}
                                            >
                                                {!knownStatus && (
                                                    <option value="" disabled>
                                                        {isText(currentStatus) ? currentStatus : 'No status'}
                                                    </option>
                                                )}
                                                {TASK_STATUSES.map((status) => (
                                                    <option key={status} value={status}>
                                                        {status}
                                                    </option>
                                                ))}
                                            </select>
                                            {isUpdating && (
                                                <span className="mt-saving" role="status">
                                                    Saving...
                                                </span>
                                            )}
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
                                                <span
                                                    className={`mt-due${
                                                        dueState === 'overdue' ? ' mt-due-overdue' : ''
                                                    }`}
                                                >
                                                    Due {due}
                                                </span>
                                            )}
                                        </div>
                                    </li>
                                )
                            })}
                        </ul>

                        {totalPages > 1 && (
                            <nav className="mt-pagination" aria-label="Task pages">
                                <button
                                    type="button"
                                    className="mt-page-btn"
                                    onClick={() => goToPage(currentPage - 1)}
                                    disabled={currentPage <= 1}
                                    aria-label="Previous page"
                                >
                                    ← Previous
                                </button>
                                <div className="mt-page-info" aria-live="polite">
                                    <strong className="mt-page-indicator">
                                        Page {currentPage} of {totalPages}
                                    </strong>
                                    <span className="mt-page-range">
                                        Showing {pageStart + 1}–{pageStart + pagedTasks.length} of{' '}
                                        {totalMatching} {totalMatching === 1 ? 'task' : 'tasks'}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    className="mt-page-btn"
                                    onClick={() => goToPage(currentPage + 1)}
                                    disabled={currentPage >= totalPages}
                                    aria-label="Next page"
                                >
                                    Next →
                                </button>
                            </nav>
                        )}
                    </>
                )}
            </main>
        </div>
    )
}