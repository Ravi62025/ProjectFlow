import { useEffect, useRef, useState } from 'react'
import api from '../api/axios.js'
import '../pages/Dashboard.css'
import './DashboardAnalytics.css'

const REFRESH_WARNING =
    'Analytics could not be refreshed and may be out of date.'

// Number of projects shown in the per-project progress list
const PROJECT_LIST_LIMIT = 5

// Chart colors. Text never relies on color alone: every segment also has a
// label and a count in the legend.
const PROJECT_STATUSES = [
    { label: 'Planning', color: '#64748b' },
    { label: 'Active', color: '#2563eb' },
    { label: 'On Hold', color: '#d97706' },
    { label: 'Completed', color: '#16a34a' },
]

const DONUT_RADIUS = 44
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS

const isCount = (value) => Number.isInteger(value) && value >= 0

// Returns the stats in a safe shape, or null if the response is not what we expect
const parseStats = (data) => {
    const stats = data?.taskStats
    if (!stats || typeof stats !== 'object' || !Array.isArray(data.projectProgress)) {
        return null
    }

    const required = [
        'totalTasks',
        'todoTasks',
        'inProgressTasks',
        'completedTasks',
        'overallProgress',
    ]
    if (!required.every((field) => isCount(stats[field]))) return null

    const seen = new Set()
    const projectProgress = data.projectProgress.filter((project) => {
        const usable =
            project &&
            typeof project === 'object' &&
            typeof project.projectId === 'string' &&
            typeof project.name === 'string' &&
            isCount(project.totalTasks) &&
            isCount(project.completedTasks) &&
            isCount(project.completionPercent)
        if (!usable || seen.has(project.projectId)) return false
        seen.add(project.projectId)
        return true
    })

    return { taskStats: stats, projectProgress }
}

// Keeps a percentage usable as a CSS width, whatever the server sends
const clampPercent = (value) => Math.min(100, Math.max(0, value))

// projects: the user's projects, already loaded by the Dashboard (used for the status chart)
// refreshKey: raise it to reload the statistics, for example after a project is created
// onStatsChange: optional. Called as ('ready', taskStats) after a successful load, and as
//   ('error', null) when the first load fails or ('loading', null) when it is retried.
//   A failed refresh after a successful load is not reported, so the last numbers stay.
function DashboardAnalyticsContent({ projects, refreshKey, onStatsChange }) {
    const [stats, setStats] = useState(null)
    const [state, setState] = useState('loading') // loading | ready | error
    const [error, setError] = useState('')
    const [refreshWarning, setRefreshWarning] = useState('')
    const [reloadKey, setReloadKey] = useState(0)

    // true once statistics have loaded successfully at least once
    const loadedRef = useRef(false)
    // Always call the latest callback without restarting the request when it changes
    const onStatsChangeRef = useRef(onStatsChange)
    useEffect(() => {
        onStatsChangeRef.current = onStatsChange
    })


    useEffect(() => {
        let cancelled = false
        // Before the first successful load, a failure is shown as the error state.
        // After it, a failed refresh only shows a warning and keeps the current numbers.
        const background = loadedRef.current

        const fail = (message) => {
            if (background) {
                setRefreshWarning(REFRESH_WARNING)
            } else {
                setError(message)
                setState('error')
                onStatsChangeRef.current?.('error', null)
            }
        }

        api
            .get('/dashboard/stats')
            .then(({ data }) => {
                if (cancelled) return
                const parsed = parseStats(data)
                if (!parsed) {
                    fail('Received an unexpected response from the server.')
                    return
                }
                loadedRef.current = true
                setStats(parsed)
                setState('ready')
                setRefreshWarning('')
                onStatsChangeRef.current?.('ready', parsed.taskStats)
            })
            .catch((err) => {
                if (cancelled) return
                fail(err.response?.data?.message || 'Could not load analytics.')
            })

        return () => {
            cancelled = true
        }
    }, [refreshKey, reloadKey])

    const retry = () => {
        // Only use the full loading state before the first successful load
        if (!loadedRef.current) {
            setError('')
            setState('loading')
            onStatsChangeRef.current?.('loading', null)
        }
        setReloadKey((key) => key + 1)
    }

    // ---- Project status donut (from the projects the Dashboard already has) ----
    const projectList = Array.isArray(projects) ? projects : []
    const projectCounts = PROJECT_STATUSES.map((status) => ({
        ...status,
        count: projectList.filter((project) => project.status === status.label).length,
    }))
    const projectTotal = projectCounts.reduce((sum, status) => sum + status.count, 0)

    const visibleStatuses = projectCounts.filter((status) => status.count > 0)
    const gap = visibleStatuses.length > 1 ? 2 : 0 // small white gap between segments
    let offset = 0
    const donutSegments = visibleStatuses.map((status) => {
        const length = (status.count / projectTotal) * DONUT_CIRCUMFERENCE
        const segment = { ...status, length: Math.max(length - gap, 0.1), offset }
        offset += length
        return segment
    })

    // ---- Task status bar and progress (numbers come straight from the server) ----
    const taskStats = stats?.taskStats
    const taskParts = taskStats
        ? [
            { label: 'To Do', color: '#64748b', count: taskStats.todoTasks },
            { label: 'In Progress', color: '#2563eb', count: taskStats.inProgressTasks },
            { label: 'Done', color: '#16a34a', count: taskStats.completedTasks },
        ]
        : []

    // slice() copies the list, so the server's order is kept and nothing is mutated
    const recentProjects = stats ? stats.projectProgress.slice(0, PROJECT_LIST_LIMIT) : []

    return (
        <section className="da-section" aria-label="Dashboard analytics">
            <h2 className="da-title">Analytics</h2>

            {refreshWarning && (
                <div className="da-warning" role="status">
                    {refreshWarning}
                </div>
            )}

            {state === 'loading' && (
                <p className="dash-state" role="status">
                    Loading analytics...
                </p>
            )}

            {state === 'error' && (
                <div className="dash-error" role="alert">
                    <p>{error}</p>
                    <button type="button" className="dash-retry" onClick={retry}>
                        Try again
                    </button>
                </div>
            )}

            {state === 'ready' && taskStats && (
                <div className="da-grid">
                    {/* 1. Project status distribution */}
                    <article className="da-card">
                        <h3 className="da-card-title">Project status</h3>

                        {projectTotal === 0 ? (
                            <div className="da-empty">
                                <strong>No projects yet</strong>
                                <span>Create a project to see its status here.</span>
                            </div>
                        ) : (
                            <div className="da-donut-layout">
                                <svg
                                    className="da-donut"
                                    viewBox="0 0 120 120"
                                    role="img"
                                    aria-label={`Project status distribution: ${projectCounts
                                        .map((status) => `${status.count} ${status.label}`)
                                        .join(', ')}`}
                                >
                                    <circle
                                        cx="60"
                                        cy="60"
                                        r={DONUT_RADIUS}
                                        fill="none"
                                        stroke="#e2e8f0"
                                        strokeWidth="16"
                                    />
                                    {donutSegments.map((segment) => (
                                        <circle
                                            key={segment.label}
                                            cx="60"
                                            cy="60"
                                            r={DONUT_RADIUS}
                                            fill="none"
                                            stroke={segment.color}
                                            strokeWidth="16"
                                            strokeDasharray={`${segment.length} ${DONUT_CIRCUMFERENCE}`}
                                            strokeDashoffset={-segment.offset}
                                            transform="rotate(-90 60 60)"
                                        />
                                    ))}
                                    <text x="60" y="58" className="da-donut-value" textAnchor="middle">
                                        {projectTotal}
                                    </text>
                                    <text x="60" y="74" className="da-donut-label" textAnchor="middle">
                                        {projectTotal === 1 ? 'project' : 'projects'}
                                    </text>
                                </svg>

                                <ul className="da-legend">
                                    {projectCounts.map((status) => (
                                        <li key={status.label}>
                                            <span
                                                className="da-swatch"
                                                style={{ background: status.color }}
                                                aria-hidden="true"
                                            />
                                            <span className="da-legend-label">{status.label}</span>
                                            <strong className="da-legend-count">{status.count}</strong>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </article>

                    {/* 2. Task status distribution */}
                    <article className="da-card">
                        <h3 className="da-card-title">Task status</h3>

                        {taskStats.totalTasks === 0 ? (
                            <div className="da-empty">
                                <strong>No tasks yet</strong>
                                <span>Tasks you create will show up here.</span>
                            </div>
                        ) : (
                            <>
                                <div
                                    className="da-stack"
                                    role="img"
                                    aria-label={`Task status distribution: ${taskParts
                                        .map((part) => `${part.count} ${part.label}`)
                                        .join(', ')}`}
                                >
                                    {taskParts
                                        .filter((part) => part.count > 0)
                                        .map((part) => (
                                            <span
                                                key={part.label}
                                                className="da-stack-part"
                                                style={{ flex: `${part.count} 1 0`, background: part.color }}
                                            />
                                        ))}
                                </div>

                                <ul className="da-legend">
                                    {taskParts.map((part) => (
                                        <li key={part.label}>
                                            <span
                                                className="da-swatch"
                                                style={{ background: part.color }}
                                                aria-hidden="true"
                                            />
                                            <span className="da-legend-label">{part.label}</span>
                                            <strong className="da-legend-count">{part.count}</strong>
                                        </li>
                                    ))}
                                    <li className="da-legend-total">
                                        <span className="da-swatch da-swatch-none" aria-hidden="true" />
                                        <span className="da-legend-label">Total tasks</span>
                                        <strong className="da-legend-count">{taskStats.totalTasks}</strong>
                                    </li>
                                </ul>
                            </>
                        )}
                    </article>

                    {/* 3. Overall task progress */}
                    <article className="da-card">
                        <h3 className="da-card-title">Overall progress</h3>
                        <p className="da-percent">{taskStats.overallProgress}%</p>
                        <div
                            className="da-bar"
                            role="progressbar"
                            aria-label="Overall task completion"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={clampPercent(taskStats.overallProgress)}
                        >
                            <div
                                className={`da-bar-fill${taskStats.totalTasks > 0 && taskStats.overallProgress === 100
                                        ? ' da-bar-fill-complete'
                                        : ''
                                    }`}
                                style={{ width: `${clampPercent(taskStats.overallProgress)}%` }}
                            />
                        </div>
                        <p className="da-note">
                            {taskStats.completedTasks} of {taskStats.totalTasks}{' '}
                            {taskStats.totalTasks === 1 ? 'task' : 'tasks'} completed
                        </p>
                    </article>

                    {/* 4. Progress of the most recent projects */}
                    <article className="da-card">
                        <h3 className="da-card-title">Project progress</h3>

                        {recentProjects.length === 0 ? (
                            <div className="da-empty">
                                <strong>No projects yet</strong>
                                <span>Progress for your recent projects will show up here.</span>
                            </div>
                        ) : (
                            <ul className="da-project-list">
                                {recentProjects.map((project) => (
                                    <li key={project.projectId} className="da-project">
                                        <div className="da-project-head">
                                            <span className="da-project-name">{project.name}</span>
                                            <strong>{project.completionPercent}%</strong>
                                        </div>
                                        <div
                                            className="da-bar da-bar-small"
                                            role="progressbar"
                                            aria-label={`${project.name} completion`}
                                            aria-valuemin={0}
                                            aria-valuemax={100}
                                            aria-valuenow={clampPercent(project.completionPercent)}
                                        >
                                            <div
                                                className={`da-bar-fill${project.totalTasks > 0 &&
                                                        project.completionPercent === 100
                                                        ? ' da-bar-fill-complete'
                                                        : ''
                                                    }`}
                                                style={{
                                                    width: `${clampPercent(project.completionPercent)}%`,
                                                }}
                                            />
                                        </div>
                                        <span className="da-note">
                                            {project.completedTasks} of {project.totalTasks}{' '}
                                            {project.totalTasks === 1 ? 'task' : 'tasks'} completed
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </article>
                </div>
            )}
        </section>
    )
}

export default function DashboardAnalytics({ projects = [], refreshKey = 0, onStatsChange }) {
    return (
        <DashboardAnalyticsContent
            projects={projects}
            refreshKey={refreshKey}
            onStatsChange={onStatsChange}
        />
    )
 }