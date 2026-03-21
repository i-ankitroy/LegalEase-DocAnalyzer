import { useState, useEffect } from 'react'
import './index.scss'

const ThemeToggle = ({ isFixed = true }) => {
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light')
  }

  return (
    <button 
      className={`theme-toggle-component ${isFixed ? 'fixed-toggle' : ''}`} 
      onClick={toggleTheme} 
      title="Toggle Dark/Light Mode"
    >
      <span>{theme === 'light' ? '🌙' : '☀️'}</span>
    </button>
  )
}

export default ThemeToggle
