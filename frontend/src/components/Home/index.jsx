import { useNavigate } from 'react-router-dom'
import './index.scss'

const Home = () => {
  const navigate = useNavigate()

  return (
    <div className="home">
      <div className="home-content">
        <h1>Welcome to LegalEase</h1>
        <p className="subtitle">
          Upload your documents and ask questions about them using the power of AI
        </p>

        <div className="features">
          <div className="feature-card">
            <span className="feature-icon">📄</span>
            <h3>Upload Documents</h3>
            <p>Support for PDF, TXT, and DOCX files</p>
          </div>
          <div className="feature-card">
            <span className="feature-icon">🤖</span>
            <h3>AI-Powered Analysis</h3>
            <p>Powered by Ollama for intelligent responses</p>
          </div>
          <div className="feature-card">
            <span className="feature-icon">💡</span>
            <h3>Ask Anything</h3>
            <p>Summarize, explain, or extract information</p>
          </div>
        </div>

        <button className="cta-button" onClick={() => navigate('/upload')}>
          Get Started
        </button>
      </div>
    </div>
  )
}

export default Home