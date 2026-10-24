import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import './Login.css'

export default function Login() {
    const { login } = useAuth()
    const navigate = useNavigate()

    const location = useLocation()
    const success = location.state?.message

    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [submitting, setSubmitting] = useState(false)

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError('')
        setSubmitting(true)

        try {
            await login(email, password)
            navigate('/dashboard', { replace: true })
        } catch (err) {

            setError(err.response?.data?.message || 'Login failed. Please try again.')
            setSubmitting(false)
        }
    }

    return (
        <div className="auth-page">
            <form className="auth-card" onSubmit={handleSubmit}>
                <h1 className="auth-brand">ProjectFlow</h1>
                <p className="auth-subtitle">Sign in to your account</p>

                {success && (
                    <div className="auth-success" role="status">
                        {success}
                    </div>
                )}

                {error && (
                    <div className="auth-error" role="alert">
                        {error}
                    </div>
                )}

                <label htmlFor="email">Email</label>
                <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                />

                <label htmlFor="password">Password</label>
                <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                />

                <button type="submit" disabled={submitting}>
                    {submitting ? 'Signing in...' : 'Sign in'}
                </button>

                <p className="auth-footer">
                    Don&apos;t have an account? <Link to="/register">Create one</Link>
                </p>
            </form>
        </div>
    )
}