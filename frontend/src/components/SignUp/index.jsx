import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import './index.scss'

const SignUp = () => {
  const navigate = useNavigate()
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    full_name: ''
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match')
      setLoading(false)
      return
    }

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters long')
      setLoading(false)
      return
    }

    try {
      const response = await fetch('http://localhost:8000/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',          // receive httpOnly cookie
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          full_name: formData.full_name,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.detail || 'Sign up failed')
      }

      // Clear legacy state from previous user sessions
      localStorage.removeItem('currentDocumentId')
      localStorage.removeItem('currentDocumentName')
      
      // Hard redirect so App.jsx re-runs checkAuth() and isAuthenticated becomes true
      localStorage.setItem('user', JSON.stringify(data.user))
      window.location.href = '/home'
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-left">
          <div className="auth-branding">
            <h1>Join <span>LegalEase</span> Today</h1>
            <p>Create your account and start analyzing documents with the power of AI</p>
            <div className="features-list">
              <div className="feature-item">
                <span className="check-icon">✓</span>
                <p>Unlimited document uploads</p>
              </div>
              <div className="feature-item">
                <span className="check-icon">✓</span>
                <p>AI-powered document analysis</p>
              </div>
              <div className="feature-item">
                <span className="check-icon">✓</span>
                <p>24/7 legal assistance chatbot</p>
              </div>
              <div className="feature-item">
                <span className="check-icon">✓</span>
                <p>Secure and private storage</p>
              </div>
            </div>
          </div>
        </div>

        <div className="auth-right">
          <div className="auth-form-wrapper">
            <div className="auth-header">
              <h2>Create Account</h2>
              <p>Get started with your free account</p>
            </div>

            <form onSubmit={handleSubmit} className="auth-form">
              {error && (
                <div className="error-message">
                  <span>⚠️</span> {error}
                </div>
              )}

              <div className="form-group">
                <label htmlFor="full_name">Full Name</label>
                <input
                  type="text"
                  id="full_name"
                  name="full_name"
                  value={formData.full_name}
                  onChange={handleChange}
                  placeholder="John Doe"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="email">Email Address</label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="you@example.com"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="password">Password</label>
                <input
                  type="password"
                  id="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="At least 8 characters"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="confirmPassword">Confirm Password</label>
                <input
                  type="password"
                  id="confirmPassword"
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  placeholder="Re-enter your password"
                  required
                />
              </div>

              <button type="submit" className="submit-btn" disabled={loading}>
                {loading ? 'Creating Account...' : 'Create Account'}
              </button>
            </form>

            <div className="auth-footer">
              <p>Already have an account? <Link to="/signin">Sign In</Link></p>
              <Link to="/" className="back-link">← Back to Home</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SignUp