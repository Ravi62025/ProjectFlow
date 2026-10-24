import { useEffect, useState } from 'react'
import api from '../api/axios.js'
import './CreateProjectModal.css'

const STATUSES = ['Planning', 'Active', 'On Hold', 'Completed']

export default function CreateProjectModal({ onClose, onCreated }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState('Active')
  const [nameError, setNameError] = useState('')
  const [apiError, setApiError] = useState('')
  const [saving, setSaving] = useState(false)

  // Close with the Escape key (not while saving)
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [saving, onClose])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setApiError('')

    if (name.trim() === '') {
      setNameError('Project name is required')
      return
    }
    setNameError('')
    setSaving(true)

    try {
      const { data } = await api.post('/projects', {
        name: name.trim(),
        description: description.trim(),
        status,
      })
      onCreated(data.project)
    } catch (err) {
      setApiError(
        err.response?.data?.message ||
          'Could not create the project. Please try again.'
      )
      setSaving(false)
    }
  }

  return (
    <div
      className="dash-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose()
      }}
    >
      <form
        className="dash-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-project-title"
        onSubmit={handleSubmit}
        noValidate
      >
        <h2 id="create-project-title" className="dash-modal-title">
          Create Project
        </h2>

        {apiError && (
          <div className="dash-modal-error" role="alert">
            {apiError}
          </div>
        )}

        <label htmlFor="project-name">Name</label>
        <input
          id="project-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={nameError ? 'true' : 'false'}
          autoFocus
        />
        {nameError && <p className="dash-modal-field-error">{nameError}</p>}

        <label htmlFor="project-description">
          Description <span className="dash-modal-optional">(optional)</span>
        </label>
        <textarea
          id="project-description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <label htmlFor="project-status">Status</label>
        <select
          id="project-status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <div className="dash-modal-actions">
          <button
            type="button"
            className="dash-modal-cancel"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button type="submit" className="dash-modal-submit" disabled={saving}>
            {saving ? 'Creating...' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  )
}