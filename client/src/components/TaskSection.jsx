import { useEffect, useRef, useState } from 'react'
import api from '../api/axios.js'
import CreateTaskModal from './CreateTaskModal.jsx'
import '../pages/Dashboard.css'
import './CreateProjectModal.css'
import './TaskSection.css'

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

const REFRESH_WARNING =
    'The task list could not be refreshed and may be out of date.'

// Returns a clean array of tasks, or null if the response has an unexpected shape
const parseTasks = (data) => {
    if (!data || !Array.isArray(data.tasks)) return null

    const seen = new Set()
    return data.tasks.filter((task) => {
        const usable =
            task &&
            typeof task === 'object' &&
            typeof task._id === 'string' &&
            typeof task.title === 'string'
        if (!usable || seen.has(task._id)) return false
        seen.add(task._id)
        return true
    })
}

const STATUS_FILTERS = ['All', 'To Do', 'In Progress', 'Done']
const PRIORITY_FILTERS = ['All', 'Low', 'Medium', 'High']

const timeOf = (value) => {
    const time = value ? Date.parse(value) : NaN
    return Number.isNaN(time) ? null : time
}

const matchesFilters = (task, status, priority) =>
    (status === 'All' || task.status === status) &&
    (priority === 'All' || task.priority === priority)

const byNewest = (a, b) => {
    if (a._id === b._id) return 0
    const diff = (timeOf(b.createdAt) ?? 0) - (timeOf(a.createdAt) ?? 0)
    if (diff !== 0) return diff
    return a._id < b._id ? 1 : -1
}

const byDueDate = (a, b) => {
    const aDue = timeOf(a.dueDate)
    const bDue = timeOf(b.dueDate)
    if (aDue === null && bDue === null) return byNewest(a, b)
    if (aDue === null) return 1 // tasks without a due date go last
    if (bDue === null) return -1
    return aDue - bDue || byNewest(a, b)
}

const getVisibleTasks = (tasks, status, priority, sortBy) =>
    tasks
        .filter((task) => matchesFilters(task, status, priority))
        .sort(sortBy === 'due' ? byDueDate : byNewest)

// Counts and completion percentage for ALL tasks of the project (never the filtered view).
// percent = Done / Total * 100, rounded down so 100% only means every task is done.
// Written as (done * 100) / total to avoid floating point errors such as 29/100*100 = 28.999...
const getTaskStats = (tasks) => {
    const stats = { total: tasks.length, todo: 0, inProgress: 0, done: 0, percent: 0 }

    for (const task of tasks) {
        if (task.status === 'To Do') stats.todo += 1
        else if (task.status === 'In Progress') stats.inProgress += 1
        else if (task.status === 'Done') stats.done += 1
    }

    if (stats.total > 0) {
        stats.percent = Math.floor((stats.done * 100) / stats.total)
    }
    return stats
}

function TaskSectionContent({ projectId }) {
    const [tasks, setTasks] = useState([])
    const [taskState, setTaskState] = useState('loading') // loading | ready | error
    const [taskError, setTaskError] = useState('')
    const [refreshWarning, setRefreshWarning] = useState('')
    const [reloadKey, setReloadKey] = useState(0)
    const [showCreate, setShowCreate] = useState(false)
    const [editingTask, setEditingTask] = useState(null)
    const [deleteTarget, setDeleteTarget] = useState(null)
    const [deleting, setDeleting] = useState(false)
    const [deleteError, setDeleteError] = useState('')
    const [successMessage, setSuccessMessage] = useState('')

    const [statusFilter, setStatusFilter] = useState('All')
    const [priorityFilter, setPriorityFilter] = useState('All')
    const [sortBy, setSortBy] = useState('newest') // newest | due

    const filtersActive = statusFilter !== 'All' || priorityFilter !== 'All'
    const visibleTasks = getVisibleTasks(tasks, statusFilter, priorityFilter, sortBy)
    const stats = getTaskStats(tasks) // always from all tasks, not visibleTasks

    const clearFilters = () => {
        setStatusFilter('All')
        setPriorityFilter('All')
    }

    // true once a task list has loaded successfully at least once
    const loadedRef = useRef(false)
    const deletingRef = useRef(false)

    useEffect(() => {
        let cancelled = false
        // Before the first successful load, a failure is shown as the error state.
        // After it, a failed refresh only shows a warning and keeps the current list.
        const background = loadedRef.current

        const fail = (message) => {
            if (background) {
                setRefreshWarning(REFRESH_WARNING)
            } else {
                setTaskError(message)
                setTaskState('error')
            }
        }

        api
            .get(`/projects/${projectId}/tasks`)
            .then(({ data }) => {
                if (cancelled) return
                const list = parseTasks(data)
                if (!list) {
                    fail('Received an unexpected response from the server.')
                    return
                }
                loadedRef.current = true
                setTasks(list)
                setTaskState('ready')
                setRefreshWarning('')
            })
            .catch((err) => {
                if (cancelled) return
                fail(err.response?.data?.message || 'Could not load tasks.')
            })

        return () => {
            cancelled = true
        }
    }, [projectId, reloadKey])

    const retry = () => {
        // Only use the full loading state before the first successful load
        if (!loadedRef.current) {
            setTaskError('')
            setTaskState('loading')
        }
        setReloadKey((key) => key + 1)
    }

    const refreshNow = () => {
        setRefreshWarning('')
        setReloadKey((key) => key + 1)
    }

    // Hide the success message after a few seconds
    useEffect(() => {
        if (!successMessage) return
        const timer = setTimeout(() => setSuccessMessage(''), 4000)
        return () => clearTimeout(timer)
    }, [successMessage])

    // Close the delete confirmation with Escape (not while deleting)
    useEffect(() => {
        if (!deleteTarget) return
        const onKeyDown = (e) => {
            if (e.key === 'Escape' && !deleting) {
                setDeleteTarget(null)
                setDeleteError('')
            }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [deleteTarget, deleting])

    const closeForm = () => {
        setShowCreate(false)
        setEditingTask(null)
    }

    const handleSaved = (task) => {
        const wasEditing = Boolean(editingTask)
        const hidden =
            Boolean(task && task._id) &&
            !matchesFilters(task, statusFilter, priorityFilter)

        if (loadedRef.current && task && task._id) {
            // Apply the change right away, without ever adding the same task twice
            setTasks((prev) => {
                if (prev.some((t) => t._id === task._id)) {
                    return prev.map((t) => (t._id === task._id ? task : t))
                }
                return wasEditing ? prev : [task, ...prev]
            })
        } else if (!loadedRef.current) {
            // The list never loaded, so reload it fully instead of showing a partial one
            setTaskError('')
            setTaskState('loading')
        }

        closeForm()
        setSuccessMessage(
            (wasEditing ? 'Task updated successfully.' : 'Task created successfully.') +
            (hidden ? ' It is hidden by your current filters.' : '')
        )
        setReloadKey((key) => key + 1) // sync with the server in the background
    }

    const openDelete = (task) => {
        setDeleteError('')
        setDeleteTarget(task)
    }

    const cancelDelete = () => {
        if (deleting) return
        setDeleteTarget(null)
        setDeleteError('')
    }

    const finishDelete = (target, message) => {
        setTasks((prev) => prev.filter((t) => t._id !== target._id))
        setDeleteTarget(null)
        setSuccessMessage(message)
        setReloadKey((key) => key + 1) // sync with the server in the background
    }

    const confirmDelete = async () => {
        if (deletingRef.current || !deleteTarget) return // ignore duplicate clicks
        deletingRef.current = true
        setDeleting(true)
        setDeleteError('')

        const target = deleteTarget

        try {
            await api.delete(`/projects/${projectId}/tasks/${target._id}`)
            finishDelete(target, 'Task deleted.')
        } catch (err) {
            if (
                err.response?.status === 404 &&
                err.response?.data?.message === 'Task not found'
            ) {
                // Already gone (for example deleted in another tab), so bring the list in line
                finishDelete(target, 'That task was already deleted.')
            } else {
                setDeleteError(
                    err.response?.data?.message ||
                    'Could not delete the task. Please try again.'
                )
            }
        } finally {
            deletingRef.current = false
            setDeleting(false)
        }
    }

    return (
        <section className="ts-section" aria-label="Tasks">
            <div className="ts-head">
                <h2 className="ts-title">Tasks</h2>
                <button
                    type="button"
                    className="dash-create"
                    onClick={() => setShowCreate(true)}
                >
                    + Create Task
                </button>
            </div>

            {successMessage && (
                <div className="dash-success" role="status">
                    {successMessage}
                </div>
            )}

            {refreshWarning && (
                <div className="ts-warning" role="status">
                    <span>{refreshWarning}</span>
                    <button type="button" className="ts-link" onClick={refreshNow}>
                        Refresh
                    </button>
                </div>
            )}

            {taskState === 'loading' && (
                <p className="dash-state" role="status">
                    Loading tasks...
                </p>
            )}

            {taskState === 'error' && (
                <div className="dash-error" role="alert">
                    <p>{taskError}</p>
                    <button type="button" className="dash-retry" onClick={retry}>
                        Try again
                    </button>
                </div>
            )}

            {taskState === 'ready' && (
                <div className="ts-overview" aria-label="Task progress overview">
                    <div className="ts-stats">
                        <div className="ts-stat">
                            <span className="ts-stat-value">{stats.total}</span>
                            <span className="ts-stat-label">Total tasks</span>
                        </div>
                        <div className="ts-stat ts-stat-todo">
                            <span className="ts-stat-value">{stats.todo}</span>
                            <span className="ts-stat-label">To Do</span>
                        </div>
                        <div className="ts-stat ts-stat-progress">
                            <span className="ts-stat-value">{stats.inProgress}</span>
                            <span className="ts-stat-label">In Progress</span>
                        </div>
                        <div className="ts-stat ts-stat-done">
                            <span className="ts-stat-value">{stats.done}</span>
                            <span className="ts-stat-label">Done</span>
                        </div>
                    </div>

                    <div className="ts-progress">
                        <div className="ts-progress-head">
                            <span>Completion</span>
                            <strong>{stats.percent}%</strong>
                        </div>
                        <div
                            className="ts-progress-track"
                            role="progressbar"
                            aria-label="Task completion"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={stats.percent}
                        >
                            <div
                                className={`ts-progress-fill${stats.total > 0 && stats.percent === 100 ? ' ts-progress-fill-complete' : ''}`}
                                style={{ width: `${stats.percent}%` }}
                            />
                        </div>
                        <span className="ts-progress-note">
                            {stats.done} of {stats.total} {stats.total === 1 ? 'task' : 'tasks'} done
                        </span>
                    </div>
                </div>
            )}

            {taskState === 'ready' && tasks.length === 0 && (
                <div className="dash-empty">
                    <strong>No tasks yet</strong>
                    <span className="dash-muted">
                        Click &quot;Create Task&quot; to add the first task to this project.
                    </span>
                </div>
            )}

            {taskState === 'ready' && tasks.length > 0 && (
                <div className="ts-toolbar">
                    <div className="ts-control">
                        <label htmlFor="task-filter-status">Status</label>
                        <select
                            id="task-filter-status"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                        >
                            {STATUS_FILTERS.map((s) => (
                                <option key={s} value={s}>
                                    {s}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="ts-control">
                        <label htmlFor="task-filter-priority">Priority</label>
                        <select
                            id="task-filter-priority"
                            value={priorityFilter}
                            onChange={(e) => setPriorityFilter(e.target.value)}
                        >
                            {PRIORITY_FILTERS.map((p) => (
                                <option key={p} value={p}>
                                    {p}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="ts-control">
                        <label htmlFor="task-sort">Sort by</label>
                        <select
                            id="task-sort"
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value)}
                        >
                            <option value="newest">Newest first</option>
                            <option value="due">Due date (earliest first)</option>
                        </select>
                    </div>

                    <div className="ts-toolbar-meta" aria-live="polite">
                        <span>
                            Showing {visibleTasks.length} of {tasks.length}
                        </span>
                        {filtersActive && (
                            <button type="button" className="ts-link" onClick={clearFilters}>
                                Clear filters
                            </button>
                        )}
                    </div>
                </div>
            )}

            {taskState === 'ready' && tasks.length > 0 && visibleTasks.length === 0 && (
                <div className="dash-empty">
                    <strong>No tasks match your filters</strong>
                    <span className="dash-muted">
                        Try a different filter, or clear the filters to see all tasks.
                    </span>
                    <button type="button" className="ts-link" onClick={clearFilters}>
                        Clear filters
                    </button>
                </div>
            )}

            {taskState === 'ready' && visibleTasks.length > 0 && (
                <ul className="ts-list">
                    {visibleTasks.map((task) => (
                        <li key={task._id} className="ts-item">
                            <div className="ts-item-main">
                                <strong className="ts-item-title">{task.title}</strong>
                                {task.description && (
                                    <p className="ts-item-desc">{task.description}</p>
                                )}
                            </div>
                            <div className="ts-item-side">
                                <div className="ts-item-meta">
                                    <span
                                        className={`dash-status dash-status-${statusClass[task.status]}`}
                                    >
                                        {task.status}
                                    </span>
                                    <span
                                        className={`dash-status ts-priority-${priorityClass[task.priority]}`}
                                    >
                                        {task.priority} priority
                                    </span>
                                    {task.dueDate && (
                                        <span className="ts-due">
                                            Due{' '}
                                            {new Date(task.dueDate).toLocaleDateString(undefined, {
                                                dateStyle: 'medium',
                                                timeZone: 'UTC',
                                            })}
                                        </span>
                                    )}
                                </div>
                                <div className="ts-actions">
                                    <button
                                        type="button"
                                        className="ts-action"
                                        onClick={() => setEditingTask(task)}
                                    >
                                        Edit
                                    </button>
                                    <button
                                        type="button"
                                        className="ts-action ts-action-danger"
                                        onClick={() => openDelete(task)}
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {(showCreate || editingTask) && (
                <CreateTaskModal
                    key={editingTask?._id ?? 'new'}
                    projectId={projectId}
                    task={editingTask}
                    onClose={closeForm}
                    onSaved={handleSaved}
                />
            )}

            {deleteTarget && (
                <div
                    className="dash-modal-overlay"
                    onMouseDown={(e) => {
                        if (e.target === e.currentTarget) cancelDelete()
                    }}
                >
                    <div
                        className="dash-modal"
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby="delete-task-title"
                    >
                        <h2 id="delete-task-title" className="dash-modal-title">
                            Delete task?
                        </h2>
                        <p className="ts-confirm-text">
                            &quot;{deleteTarget.title}&quot; will be permanently deleted. This
                            can&apos;t be undone.
                        </p>

                        {deleteError && (
                            <div className="dash-modal-error" role="alert">
                                {deleteError}
                            </div>
                        )}

                        <div className="dash-modal-actions">
                            <button
                                type="button"
                                className="dash-modal-cancel"
                                onClick={cancelDelete}
                                disabled={deleting}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="ts-danger-submit"
                                onClick={confirmDelete}
                                disabled={deleting}
                            >
                                {deleting ? 'Deleting...' : 'Delete task'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    )
}

// Keying by projectId remounts the section whenever the project changes. That resets
// the task list, loading and error state, filters, sorting, modals and messages,
// so tasks from the previous project can never show under the new one.
export default function TaskSection({ projectId }) {
    return <TaskSectionContent key={projectId} projectId={projectId} />
}