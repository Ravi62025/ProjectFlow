import { useEffect, useRef, useState } from 'react'
import api from '../api/axios.js'
import '../pages/Dashboard.css'
import './ActivityTimeline.css'

const ACTIVITY_LIMIT = 20

const REFRESH_WARNING =
    'Activity could not be refreshed and may be out of date.'

const EVENT_LABELS = {
    task_created: 'Task created',
    task_updated: 'Task updated',
    task_status_changed: 'Status changed',
    task_deleted: 'Task deleted',
    project_created: 'Project created',
    project_updated: 'Project updated',
}

// How a changed field name from the server is shown to the user
const FIELD_LABELS = {
    title: 'title',
    description: 'description',
    status: 'status',
    priority: 'priority',
    dueDate: 'due date',
    name: 'name',
}

const statusClass = {
    'To Do': 'todo',
    'In Progress': 'progress',
    Done: 'done',
}

// Returns a clean array of activities, or null if the response has an unexpected shape
const parseActivities = (data) => {
    if (!data || !Array.isArray(data.activities)) return null

    const seen = new Set()
    return data.activities.filter((activity) => {
        const usable =
            activity &&
            typeof activity === 'object' &&
            typeof activity._id === 'string' &&
            typeof activity.type === 'string'
        if (!usable || seen.has(activity._id)) return false
        seen.add(activity._id)
        return true
    })
}

// The name shown in bold: the task title for task events, the project name for project events
const getSubject = (activity) => {
    if (activity.type.startsWith('task_')) return activity.taskTitle || 'Untitled task'
    if (activity.type.startsWith('project_')) return activity.projectName || 'Unnamed project'
    return ''
}

// Readable names of the changed fields, optionally leaving one out
const getChangedFields = (activity, skip) => {
    const changed = Array.isArray(activity.meta?.changed) ? activity.meta.changed : []
    return changed
        .filter((field) => typeof field === 'string' && field !== skip)
        .map((field) => FIELD_LABELS[field] || field)
}

const formatTime = (value) => {
    const date = new Date(value)
    if (!value || Number.isNaN(date.getTime())) return null
    return {
        iso: date.toISOString(),
        text: date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
    }
}

const statusPill = (value) => (
    <span className={`dash-status${statusClass[value] ? ` dash-status-${statusClass[value]}` : ''}`}>
        {value}
    </span>
)

function ActivityTimelineContent({ projectId, refreshKey }) {
    const [activities, setActivities] = useState([])
    const [state, setState] = useState('loading') // loading | ready | error
    const [error, setError] = useState('')
    const [refreshWarning, setRefreshWarning] = useState('')
    const [reloadKey, setReloadKey] = useState(0)
    const [settledKey, setSettledKey] = useState('')

    // Changes whenever a new request is needed: the parent bumps refreshKey after a
    // task or project change, and reloadKey changes for Refresh and Try again.
    const requestKey = `${refreshKey}-${reloadKey}`
    const refreshing = state === 'ready' && settledKey !== requestKey

    // true once activities have loaded successfully at least once
    const loadedRef = useRef(false)

    useEffect(() => {
        let cancelled = false
        // Before the first successful load, a failure is shown as the error state.
        // After it, a failed refresh only shows a warning and keeps the current list.
        const background = loadedRef.current

        const fail = (message) => {
            if (background) {
                setRefreshWarning(REFRESH_WARNING)
            } else {
                setError(message)
                setState('error')
            }
            setSettledKey(requestKey)
        }

        api
            .get(`/projects/${projectId}/activity?limit=${ACTIVITY_LIMIT}`)
            .then(({ data }) => {
                if (cancelled) return
                const list = parseActivities(data)
                if (!list) {
                    fail('Received an unexpected response from the server.')
                    return
                }
                loadedRef.current = true
                setActivities(list)
                setState('ready')
                setRefreshWarning('')
                setSettledKey(requestKey)
            })
            .catch((err) => {
                if (cancelled) return
                fail(err.response?.data?.message || 'Could not load activity.')
            })

        return () => {
            cancelled = true
        }
    }, [projectId, requestKey])

    const retry = () => {
        // Only use the full loading state before the first successful load
        if (!loadedRef.current) {
            setError('')
            setState('loading')
        }
        setReloadKey((key) => key + 1)
    }

    const refreshNow = () => {
        setRefreshWarning('')
        setReloadKey((key) => key + 1)
    }

    return (
        <section className="at-section" aria-label="Project activity">
            <div className="at-head">
                <h2 className="at-title">Activity</h2>
                {state === 'ready' && (
                    <button
                        type="button"
                        className="at-refresh"
                        onClick={refreshNow}
                        disabled={refreshing}
                    >
                        {refreshing ? 'Refreshing...' : 'Refresh'}
                    </button>
                )}
            </div>

            {refreshWarning && (
                <div className="at-warning" role="status">
                    {refreshWarning}
                </div>
            )}

            {state === 'loading' && (
                <p className="dash-state" role="status">
                    Loading activity...
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

            {state === 'ready' && activities.length === 0 && (
                <div className="dash-empty">
                    <strong>No activity yet</strong>
                    <span className="dash-muted">
                        Changes to this project and its tasks will appear here.
                    </span>
                </div>
            )}

            {state === 'ready' && activities.length > 0 && (
                <ol className="at-list">
                    {activities.map((activity) => {
                        const subject = getSubject(activity)
                        const time = formatTime(activity.createdAt)
                        const from = activity.meta?.from
                        const to = activity.meta?.to

                        const isStatusChange = activity.type === 'task_status_changed'
                        const showTransition =
                            isStatusChange &&
                            typeof from === 'string' &&
                            typeof to === 'string'
                        // A status change can also list other fields edited in the same save
                        const changedFields = getChangedFields(
                            activity,
                            isStatusChange ? 'status' : undefined
                        )

                        return (
                            <li
                                key={activity._id}
                                className={`at-item at-type-${activity.type}`}
                            >
                                <span className="at-dot" aria-hidden="true" />
                                <div className="at-body">
                                    <p className="at-line">
                                        <span className="at-label">
                                            {EVENT_LABELS[activity.type] || 'Activity'}
                                        </span>
                                        {subject && (
                                            <>
                                                {' '}
                                                <strong className="at-subject">{subject}</strong>
                                            </>
                                        )}
                                    </p>

                                    {showTransition && (
                                        <p className="at-detail">
                                            {statusPill(from)}
                                            <span className="at-sr"> changed to </span>
                                            <span aria-hidden="true">→</span>
                                            {statusPill(to)}
                                        </p>
                                    )}

                                    {changedFields.length > 0 && (
                                        <p className="at-detail">
                                            {isStatusChange ? 'Also changed' : 'Changed'}:{' '}
                                            {changedFields.join(', ')}
                                        </p>
                                    )}
                                </div>
                                {time && (
                                    <time className="at-time" dateTime={time.iso}>
                                        {time.text}
                                    </time>
                                )}
                            </li>
                        )
                    })}
                </ol>
            )}

            {state === 'ready' && activities.length >= ACTIVITY_LIMIT && (
                <p className="at-note">
                    Showing the {ACTIVITY_LIMIT} most recent activities.
                </p>
            )}
        </section>
    )
}

// refreshKey is optional: a parent can raise it after a task or project change to
// reload the timeline. Keying by projectId remounts the timeline whenever the project
// changes, so activity from the previous project can never show under the new one.
export default function ActivityTimeline({ projectId, refreshKey = 0 }) {
    return (
        <ActivityTimelineContent
            key={projectId}
            projectId={projectId}
            refreshKey={refreshKey}
        />
    )
}
