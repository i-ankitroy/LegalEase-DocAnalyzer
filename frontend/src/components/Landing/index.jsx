import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import ThemeToggle from '../ThemeToggle'
import './index.scss'

const features = [
  { icon: '📤', title: 'Easy Upload', desc: 'Support for PDF, DOCX, and TXT files. Drag and drop or browse to upload your documents instantly.' },
  { icon: '🧠', title: 'Smart Analysis', desc: 'Powered by advanced AI models using Ollama for intelligent document understanding and analysis.' },
  { icon: '💬', title: 'Interactive Chat', desc: 'Ask questions about your documents and get instant, accurate answers in natural language.' },
  { icon: '⚖️', title: 'Legal Assistance', desc: 'Get general legal information and guidance without uploading any documents.' },
  { icon: '🔒', title: 'Secure & Private', desc: 'Your documents are encrypted and private. Only you can access your uploaded files.' },
  { icon: '⚡', title: 'Lightning Fast', desc: 'Get instant responses with our optimized AI pipeline and efficient processing.' },
]

const Landing = ({ isAuthenticated = false, loading = false }) => {
  const navigate = useNavigate()
  const [currentSlide, setCurrentSlide] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % features.length)
    }, 5000)
    return () => clearInterval(timer)
  }, [])

  const handleGetStarted = () => navigate(isAuthenticated ? '/home' : '/signup')
  const handleSignIn = () => navigate(isAuthenticated ? '/home' : '/signin')

  const nextSlide = () => setCurrentSlide((prev) => (prev + 1) % features.length)
  const prevSlide = () => setCurrentSlide((prev) => (prev - 1 + features.length) % features.length)

  return (
    <div className="landing">
      <ThemeToggle />
      
      {/* Static Background Objects (Performance Optimized) */}
      <div className="dynamic-bg-glow glow-1" />
      <div className="dynamic-bg-glow glow-2" />
      <div className="dynamic-bg-glow glow-3" />
      <div className="dynamic-bg-glow glow-4" />
      <div className="dynamic-bg-glow glow-5" />

      {/* Hero Section */}
      <section className="hero">
        <motion.div 
          className="hero-content"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <h1 className="hero-title">
            Unlock the Power of Your Documents with
            <span className="brand-highlight"> LegalEase</span>
          </h1>
          <p className="hero-subtitle">
            AI-powered document analysis and legal assistance at your fingertips.
            Upload, analyze, and get instant insights from your documents.
          </p>
          <div className="hero-buttons">
            {!loading && (
              <>
                <motion.button 
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="btn-primary" 
                  onClick={handleGetStarted}
                >
                  {isAuthenticated ? 'Go to App' : 'Get Started Free'}
                </motion.button>
                {!isAuthenticated && (
                  <motion.button 
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="btn-secondary" 
                    onClick={handleSignIn}
                  >
                    Sign In
                  </motion.button>
                )}
              </>
            )}
          </div>
        </motion.div>

        <div className="hero-visual">
          <motion.div 
            className="floating-card card-1"
            animate={{ y: [0, -20, 0], rotate: [0, 2, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          >
            <span className="card-icon">📄</span>
            <p>Document Upload</p>
          </motion.div>
          <motion.div 
            className="floating-card card-2"
            animate={{ y: [0, 20, 0], rotate: [0, -2, 0] }}
            transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          >
            <span className="card-icon">🤖</span>
            <p>AI Analysis</p>
          </motion.div>
          <motion.div 
            className="floating-card card-3"
            animate={{ y: [0, -15, 0], x: [0, 10, 0] }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          >
            <span className="card-icon">⚖️</span>
            <p>Legal Insights</p>
          </motion.div>
        </div>
      </section>

      {/* Features Carousel Section */}
      <section className="features">
        <motion.h2 
          className="section-title"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
        >
          Powerful Features
        </motion.h2>
        
        <div className="carousel-container">
          <button className="carousel-btn prev" onClick={prevSlide}>❮</button>
          
          <div className="carousel-track-wrapper">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentSlide}
                className="feature-card carousel-active"
                initial={{ opacity: 0, scale: 0.9, x: 100 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.9, x: -100 }}
                transition={{ duration: 0.4, type: 'spring', bounce: 0.3 }}
              >
                <div className="feature-icon-wrapper">
                  <span className="feature-icon">{features[currentSlide].icon}</span>
                </div>
                <h3>{features[currentSlide].title}</h3>
                <p>{features[currentSlide].desc}</p>
                
                {/* Carousel Indicators */}
                <div className="carousel-indicators">
                  {features.map((_, idx) => (
                    <div 
                      key={idx} 
                      className={`indicator ${idx === currentSlide ? 'active' : ''}`}
                      onClick={() => setCurrentSlide(idx)}
                    />
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          <button className="carousel-btn next" onClick={nextSlide}>❯</button>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="how-it-works">
        <h2 className="section-title">How It Works</h2>
        <div className="steps">
          {[
            { num: 1, title: 'Create Account', desc: 'Sign up in seconds with just your email' },
            { num: 2, title: 'Upload Document', desc: 'Upload your PDF, DOCX, or TXT files securely' },
            { num: 3, title: 'Ask Questions', desc: 'Chat with your document and get instant insights' }
          ].map((step, idx) => (
            <motion.div 
              className="step-wrapper" 
              key={step.num}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.2 }}
            >
              <div className="step">
                <motion.div 
                  className="step-number"
                  whileHover={{ scale: 1.1, rotate: 360 }}
                  transition={{ duration: 0.5 }}
                >
                  {step.num}
                </motion.div>
                <h3>{step.title}</h3>
                <p>{step.desc}</p>
              </div>
              {idx < 2 && <div className="step-arrow">→</div>}
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA Section */}
      <section className="cta">
        <motion.div 
          className="cta-content"
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <h2>Ready to Transform Your Document Workflow?</h2>
          <p>Join thousands of users who trust LegalEase for their document analysis needs</p>
          <motion.button 
            className="btn-primary-large" 
            onClick={handleGetStarted}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            {isAuthenticated ? 'Go to App' : 'Start Analyzing Now'}
          </motion.button>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <p>&copy; 2026 LegalEase. Powered by Ollama & FastAPI.</p>
      </footer>
    </div>
  )
}

export default Landing