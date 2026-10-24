import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import api from '../api/axios.js'
import CreateProjectModal from '../components/CreateProjectModal.jsx'
import DashboardAnalytics from '../components/DashboardAnalytics.jsx'
import './Dashboard.css'

// DEMO DATA: My Tasks is not connected to the API yet


const myTasks = [
    { title: 'Review homepage wireframes', project: 'Website Redesign', status: 'In Progress' },
    { title: 'Write API documentation', project: 'Mobile App Launch', status: 'To Do' },
    { title: 'Finalize campaign budget', project: 'Q4 Marketing Campaign', status: 'Done' },
    { title: 'Fix signup form bug', project: 'Mobile App Launch', status: 'Overdue' },
]

const statusClass = {
    'To Do': 'todo',
    'In Progress': 'progress',
    Done: 'done',
    Overdue: 'overdue',
}

const projectStatusClass = {
    Planning: 'planning',
    Active: 'active',
    'On Hold': 'onhold',
    Completed: 'done',
}



const RECENT_LIMIT = 5
const STATUS_FILTERS = ['All', 'Planning', 'Active', 'On Hold', 'Completed']

// Search matches the project name only (case-insensitive). Search and status combine (AND).
const matchesFilters = (project, searchText, status) =>
    (searchText === '' || (project.name || '').toLowerCase().includes(searchText)) &&
    (status === 'All' || project.status === status)



export default function Dashboard() {
    const { user, logout } = useAuth()
    const navigate = useNavigate()

    const [projects, setProjects] = useState([])
    const [projectsState, setProjectsState] = useState('loading') // loading | ready | error
    const [projectsError, setProjectsError] = useState('')
    const [reloadKey, setReloadKey] = useState(0)
    const [showCreate, setShowCreate] = useState(false)
    const [successMessage, setSuccessMessage] = useState('')
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState('All')

    // Task numbers for the summary cards. DashboardAnalytics loads them and reports here,
    // so /dashboard/stats is requested once and reloads with reloadKey.
    const [taskSummary, setTaskSummary] = useState({ status: 'loading', stats: null })
    const handleStatsChange = useCallback(
        (status, stats) => setTaskSummary({ status, stats }),
        []
    )

    useEffect(() => {
        if (!user?.id) return

        let cancelled = false

        api
            .get('/projects')
            .then(({ data }) => {
                if (cancelled) return
                setProjects(data.projects)
                setProjectsState('ready')
            })
            .catch((err) => {
                if (cancelled) return
                setProjectsError(
                    err.response?.data?.message || 'Could not load your projects.'
                )
                setProjectsState('error')
            })

        return () => {
            cancelled = true
        }
    }, [user?.id, reloadKey])

    const retry = () => {
        setProjectsError('')
        setProjectsState('loading')
        setReloadKey((key) => key + 1)
    }

    // Hide the success message after a few seconds
    useEffect(() => {
        if (!successMessage) return
        const timer = setTimeout(() => setSuccessMessage(''), 4000)
        return () => clearTimeout(timer)
    }, [successMessage])

    const handleCreated = (project) => {
        // Show the new project right away, then refetch to stay in sync with the server
        setProjects((prev) => [project, ...prev])
        setProjectsError('')
        setProjectsState('ready')
        setShowCreate(false)
        const hidden = !matchesFilters(project, search.trim().toLowerCase(), statusFilter)
        setSuccessMessage(
            'Project created successfully.' +
            (hidden ? ' It is hidden by your current filters.' : '')
        )
        setReloadKey((key) => key + 1)
    }

    const handleLogout = () => {
        logout()
        navigate('/login', { replace: true })
    }

    const totalProjects = projectsState === 'ready' ? projects.length : '-'

    // Real numbers only: a dash while loading or when they could not be loaded
    const taskStats = taskSummary.status === 'ready' ? taskSummary.stats : null
    const taskCards = [
        { label: 'Total Tasks', tone: 'blue', value: taskStats ? taskStats.totalTasks : '–' },
        { label: 'Completed Tasks', tone: 'green', value: taskStats ? taskStats.completedTasks : '–' },
        {
            label: 'Overall Progress',
            tone: 'indigo',
            value: taskStats ? `${taskStats.overallProgress}%` : '–',
        },
    ]



    const searchText = search.trim().toLowerCase()
    const filtersActive = searchText !== '' || statusFilter !== 'All'
    const matchingProjects = projects.filter((project) =>
        matchesFilters(project, searchText, statusFilter)
    )
    // No filters: the five most recent projects. With filters: every match.
    const recentProjects = filtersActive
        ? matchingProjects
        : projects.slice(0, RECENT_LIMIT)

    let resultNote = ''
    if (filtersActive) {
        resultNote = `Showing ${matchingProjects.length} of ${projects.length}`
    } else if (projects.length > RECENT_LIMIT) {
        resultNote = `Showing the ${RECENT_LIMIT} most recent of ${projects.length}. Search or filter to see them all.`
    }

    const clearFilters = () => {
        setSearch('')
        setStatusFilter('All')
    }

    return (
        <div className="dash-layout">
            <aside className="dash-sidebar">
                <div className="dash-brand">ProjectFlow</div>
                <nav className="dash-nav" aria-label="Main navigation">
                    <Link to="/dashboard" className="dash-nav-item dash-nav-active">
                        Overview
                    </Link>
                    <span className="dash-nav-item dash-nav-disabled" aria-disabled="true">
                        Projects <small>Soon</small>
                    </span>
                    <Link to="/my-tasks" className="dash-nav-item">
                        My Tasks
                    </Link>
                    <Link to="/calendar" className="dash-nav-item">
                        Calendar
                    </Link>
                    <span className="dash-nav-item dash-nav-disabled" aria-disabled="true">
                        Settings <small>Soon</small>
                    </span>
                </nav>
            </aside>

            <div className="dash-main">
                <header className="dash-topbar">
                    <h1 className="dash-welcome">Welcome back, {user?.name}</h1>
                    <button type="button" className="dash-logout" onClick={handleLogout}>
                        Log out
                    </button>
                </header>

                <main className="dash-content">
                    <p className="dash-demo-note">
                        Track your projects, manage tasks, and monitor your progress.
                    </p>

                    {successMessage && (
                        <div className="dash-success" role="status">
                            {successMessage}
                        </div>
                    )}

                    <section className="dash-cards" aria-label="Summary">
                        <div className="dash-card dash-card-indigo">
                            <span className="dash-card-label">Total Projects</span>
                            <span className="dash-card-value">{totalProjects}</span>
                        </div>
                        {taskCards.map((card) => (
                            <div key={card.label} className={`dash-card dash-card-${card.tone}`}>
                                <span className="dash-card-label">{card.label}</span>
                                <span
                                    className="dash-card-value"
                                    title={
                                        taskSummary.status === 'error'
                                            ? 'Could not load task statistics'
                                            : undefined
                                    }
                                >
                                    {card.value}
                                </span>
                            </div>
                        ))}
                    </section>

                    <div className="dash-grid">
                        <section className="dash-panel">
                            <div className="dash-panel-head">
                                <h2 className="dash-panel-title">Recent Projects</h2>
                                <button
                                    type="button"
                                    className="dash-create"
                                    onClick={() => setShowCreate(true)}
                                >
                                    + Create Project
                                </button>
                            </div>


                            {projectsState === 'ready' && projects.length > 0 && (
                                <div className="dash-filters">
                                    <div className="dash-filter-field dash-filter-search">
                                        <label htmlFor="project-search">Search</label>
                                        <input
                                            id="project-search"
                                            type="search"
                                            value={search}
                                            onChange={(e) => setSearch(e.target.value)}
                                            placeholder="Search by project name"
                                        />
                                    </div>
                                    <div className="dash-filter-field">
                                        <label htmlFor="project-status-filter">Status</label>
                                        <select
                                            id="project-status-filter"
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
                                    <div className="dash-filter-meta" aria-live="polite">
                                        {resultNote && <span>{resultNote}</span>}
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



                            {projectsState === 'loading' && (
                                <p className="dash-state" role="status">
                                    Loading your projects...
                                </p>
                            )}

                            {projectsState === 'error' && (
                                <div className="dash-error" role="alert">
                                    <p>{projectsError}</p>
                                    <button type="button" className="dash-retry" onClick={retry}>
                                        Try again
                                    </button>
                                </div>
                            )}

                            {projectsState === 'ready' && projects.length === 0 && (
                                <div className="dash-empty">
                                    <strong>No projects yet</strong>
                                    <span className="dash-muted">
                                        Projects you create will show up here.
                                    </span>
                                </div>
                            )}
                            {projectsState === 'ready' &&
                                projects.length > 0 &&
                                matchingProjects.length === 0 && (
                                    <div className="dash-empty">
                                        <strong>No projects match your search</strong>
                                        <span className="dash-muted">
                                            Try a different name or status, or clear the filters.
                                        </span>
                                        <div>
                                            <button
                                                type="button"
                                                className="dash-filter-clear"
                                                onClick={clearFilters}
                                            >
                                                Clear filters
                                            </button>
                                        </div>
                                    </div>
                                )}
                            {projectsState === 'ready' && recentProjects.length > 0 && (
                                <ul className="dash-list">
                                    {recentProjects.map((project) => (
                                        <li key={project._id} className="dash-project">
                                            <div className="dash-project-head">
                                                <Link to={`/projects/${project._id}`} className="dash-project-link">
                                                    {project.name}
                                                </Link>
                                                <span
                                                    className={`dash-status dash-status-${projectStatusClass[project.status]}`}
                                                >
                                                    {project.status}
                                                </span>
                                            </div>
                                            <span className="dash-muted dash-project-desc">
                                                {project.description || 'No description'}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        <section className="dash-panel">
                            <h2 className="dash-panel-title">
                                My Tasks <span className="dash-tag">Demo</span>
                            </h2>
                            <ul className="dash-list">
                                {myTasks.map((task) => (
                                    <li key={task.title} className="dash-task">
                                        <div>
                                            <strong>{task.title}</strong>
                                            <span className="dash-muted">{task.project}</span>
                                        </div>
                                        <span className={`dash-status dash-status-${statusClass[task.status]}`}>
                                            {task.status}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    </div>
                    <DashboardAnalytics
                        projects={projects}
                        refreshKey={reloadKey}
                        onStatsChange={handleStatsChange}
                    />
                </main>
            </div>

            {showCreate && (
                <CreateProjectModal
                    onClose={() => setShowCreate(false)}
                    onCreated={handleCreated}
                />
            )}
        </div>
    )
}