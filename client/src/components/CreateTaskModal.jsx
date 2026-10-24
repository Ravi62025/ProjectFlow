import { useEffect, useState } from 'react'
import api from '../api/axios.js'
import './CreateProjectModal.css'
import './TaskSection.css'

const STATUSES = ['To Do', 'In Progress', 'Done']
const PRIORITIES = ['Low', 'Medium', 'High']

export default function CreateTaskModal({ projectId, task, onClose, onSaved }) {
  const isEdit = Boolean(task)

  const [form, setForm] = useState({
    title: task?.title ?? '',
    description: task?.description ?? '',
    status: task?.status ?? 'To Do',
    priority: task?.priority ?? 'Medium',
    dueDate: task?.dueDate ? task.dueDate.slice(0, 10) : '',
  })
  const [titleError, setTitleError] = useState('')
  const [apiError, setApiError] = useState('')
  const [saving, setSaving] = useState(false)

  const setField = (field) => (e) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }))

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
    if (saving) return // ignore duplicate submissions
    setApiError('')

    if (form.title.trim() === '') {
      setTitleError('Task title is required')
      return
    }
    setTitleError('')
    setSaving(true)

    const formData = {
      title: form.title.trim(),
      description: form.description.trim(),
      status: form.status,
      priority: form.priority,
    }
    if (form.dueDate) {
      formData.dueDate = form.dueDate
    } else if (isEdit) {
      formData.dueDate = null // clear the due date when editing
    }

    try {
      const { data } = isEdit
        ? await api.put(`/projects/${projectId}/tasks/${task._id}`, formData)
        : await api.post(`/projects/${projectId}/tasks`, formData)
      onSaved(data.task)
    } catch (err) {
      // Keep the form values so nothing the user typed is lost
      setApiError(
        err.response?.data?.message ||
          `Could not ${isEdit ? 'update' : 'create'} the task. Please try again.`
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
        aria-labelledby="task-modal-title"
        onSubmit={handleSubmit}
        noValidate
      >
        <h2 id="task-modal-title" className="dash-modal-title">
          {isEdit ? 'Edit Task' : 'Create Task'}
        </h2>

        {apiError && (
          <div className="dash-modal-error" role="alert">
            {apiError}
          </div>
        )}

        <label htmlFor="task-title">Title</label>
        <input
          id="task-title"
          type="text"
          value={form.title}
          onChange={setField('title')}
          aria-invalid={titleError ? 'true' : 'false'}
          autoFocus
        />
        {titleError && <p className="dash-modal-field-error">{titleError}</p>}

        <label htmlFor="task-description">
          Description <span className="dash-modal-optional">(optional)</span>
        </label>
        <textarea
          id="task-description"
          rows={3}
          value={form.description}
          onChange={setField('description')}
        />

        <div className="ts-form-row">
          <div className="ts-field">
            <label htmlFor="task-status">Status</label>
            <select id="task-status" value={form.status} onChange={setField('status')}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="ts-field">
            <label htmlFor="task-priority">Priority</label>
            <select
              id="task-priority"
              value={form.priority}
              onChange={setField('priority')}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label htmlFor="task-due">
          Due date <span className="dash-modal-optional">(optional)</span>
        </label>
        <input
          id="task-due"
          type="date"
          value={form.dueDate}
          onChange={setField('dueDate')}
        />

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
            {saving
              ? isEdit
                ? 'Saving...'
                : 'Creating...'
              : isEdit
                ? 'Save changes'
                : 'Create task'}
          </button>
        </div>
      </form>
    </div>
  )
}