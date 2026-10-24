import { useEffect, useRef, useState } from 'react'
import api from '../api/axios.js'
import './CreateProjectModal.css'

const STATUSES = ['Planning', 'Active', 'On Hold', 'Completed']

// Edit form for an existing project. The parent calls onSaved(updatedProject)
// and is responsible for closing the modal.
export default function EditProjectModal({ project, onClose, onSaved }) {
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? '')
  const [status, setStatus] = useState(project.status)
  const [nameError, setNameError] = useState('')
  const [apiError, setApiError] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

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
    if (savingRef.current) return // ignore duplicate submits
    setApiError('')

    const trimmedName = name.trim()
    if (trimmedName === '') {
      setNameError('Project name is required')
      return
    }
    setNameError('')

    // Send only the fields that really changed
    const updates = {}
    if (trimmedName !== project.name) updates.name = trimmedName
    if (description.trim() !== (project.description ?? '').trim()) {
      updates.description = description.trim()
    }
    if (status !== project.status) updates.status = status

    // Nothing changed, so there is nothing to save
    if (Object.keys(updates).length === 0) {
      onClose()
      return
    }

    savingRef.current = true
    setSaving(true)

    try {
      const { data } = await api.put(`/projects/${project._id}`, updates)
      if (!data?.project) {
        setApiError(
          'The server sent an unexpected response. Please close this form and reload the page to check your changes.'
        )
        savingRef.current = false
        setSaving(false)
        return
      }
      onSaved(data.project)
    } catch (err) {
      setApiError(
        err.response?.data?.message ||
          'Could not save the project. Please try again.'
      )
      savingRef.current = false
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
        aria-labelledby="edit-project-title"
        onSubmit={handleSubmit}
        noValidate
      >
        <h2 id="edit-project-title" className="dash-modal-title">
          Edit Project
        </h2>

        {apiError && (
          <div className="dash-modal-error" role="alert">
            {apiError}
          </div>
        )}

        <label htmlFor="edit-project-name">Name</label>
        <input
          id="edit-project-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={nameError ? 'true' : 'false'}
          aria-describedby={nameError ? 'edit-project-name-error' : undefined}
          autoFocus
        />
        {nameError && (
          <p id="edit-project-name-error" className="dash-modal-field-error">
            {nameError}
          </p>
        )}

        <label htmlFor="edit-project-description">
          Description <span className="dash-modal-optional">(optional)</span>
        </label>
        <textarea
          id="edit-project-description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <label htmlFor="edit-project-status">Status</label>
        <select
          id="edit-project-status"
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
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  )
}