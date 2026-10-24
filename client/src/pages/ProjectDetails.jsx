import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../api/axios.js'
import './Dashboard.css'
import './ProjectDetails.css'
import TaskSection from '../components/TaskSection.jsx'
import ActivityTimeline from '../components/ActivityTimeline.jsx'
import EditProjectModal from '../components/EditProjectModal.jsx'

const projectStatusClass = {
  Planning: 'planning',
  Active: 'active',
  'On Hold': 'onhold',
  Completed: 'done',
}

function ProjectView({ id }) {
  const [project, setProject] = useState(null)
  const [viewState, setViewState] = useState('loading') // loading | ready | notfound | error
  const [errorMessage, setErrorMessage] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [showEdit, setShowEdit] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [activityVersion, setActivityVersion] = useState(0)

  useEffect(() => {
    let cancelled = false

    api
      .get(`/projects/${id}`)
      .then(({ data }) => {
        if (cancelled) return
        setProject(data.project)
        setViewState('ready')
      })
      .catch((err) => {
        if (cancelled) return
        const status = err.response?.status
        if (status === 404 || status === 400) {
          setViewState('notfound')
        } else {
          setErrorMessage(
            err.response?.data?.message || 'Could not load this project.'
          )
          setViewState('error')
        }
      })

    return () => {
      cancelled = true
    }
  }, [id, reloadKey])

  const retry = () => {
    setErrorMessage('')
    setViewState('loading')
    setReloadKey((key) => key + 1)
  }

  // Hide the success banner after a few seconds. It restarts on every save.
  useEffect(() => {
    if (!successMessage) return
    const timer = setTimeout(() => setSuccessMessage(''), 4000)
    return () => clearTimeout(timer)
  }, [successMessage, activityVersion])

  const handleSaved = (updated) => {
    setProject(updated)
    setShowEdit(false)
    setSuccessMessage('Project updated successfully.')
    setActivityVersion((version) => version + 1) // reloads the activity timeline
  }


  return (
    <div className="pd-page">
      <header className="pd-header">
        <span className="pd-brand">ProjectFlow</span>
        <Link to="/dashboard" className="pd-back">
          ← Back to dashboard
        </Link>
      </header>

      <main className="pd-content">
        {successMessage && (
          <div className="dash-success" role="status">
            {successMessage}
          </div>
        )}
        {viewState === 'loading' && (
          <p className="pd-state" role="status">
            Loading project...
          </p>
        )}

        {viewState === 'notfound' && (
          <div className="pd-card pd-center">
            <h1 className="pd-title">Project not found</h1>
            <p className="pd-muted">
              This project doesn&apos;t exist, or it isn&apos;t in your account.
            </p>
            <Link to="/dashboard" className="pd-button">
              Back to dashboard
            </Link>
          </div>
        )}

        {viewState === 'error' && (
          <div className="pd-card pd-center" role="alert">
            <h1 className="pd-title">Something went wrong</h1>
            <p className="pd-error">{errorMessage}</p>
            <div className="pd-actions">
              <button type="button" className="pd-button" onClick={retry}>
                Try again
              </button>
              <Link to="/dashboard" className="pd-link-button">
                Back to dashboard
              </Link>
            </div>
          </div>
        )}

        {viewState === 'ready' && project && (
          <article className="pd-card">
            <div className="pd-title-row">
              <h1 className="pd-title">{project.name}</h1>
              <span
                className={`dash-status dash-status-${projectStatusClass[project.status]}`}
              >
                {project.status}
              </span>
              <button
                type="button"
                className="pd-button"
                onClick={() => setShowEdit(true)}
              >
                Edit project
              </button>
            </div>

            <h2 className="pd-label">Description</h2>
            <p className="pd-description">
              {project.description || 'No description provided.'}
            </p>

            <dl className="pd-meta">
              <div>
                <dt>Status</dt>
                <dd>{project.status}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>
                  {new Date(project.createdAt).toLocaleDateString(undefined, {
                    dateStyle: 'long',
                  })}
                </dd>
              </div>
            </dl>
          </article>
        )}
        {viewState === 'ready' && <TaskSection projectId={id} />}
        {viewState === 'ready' && (
          <ActivityTimeline projectId={id} refreshKey={activityVersion} />
        )}

        {viewState === 'ready' && project && showEdit && (
          <EditProjectModal
            project={project}
            onClose={() => setShowEdit(false)}
            onSaved={handleSaved}
          />
        )}
      </main>
    </div>
  )
}

export default function ProjectDetails() {
  const { id } = useParams()
  // key resets the page state if the project ID in the URL changes
  return <ProjectView key={id} id={id} />
}