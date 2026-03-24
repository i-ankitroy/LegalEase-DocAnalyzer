import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { analyzeDocument, analyzeDocumentStream, suggestAlternative, chatWithDocument, chatWithDocumentStream, getSession } from '../../utils/api'
import './index.scss'

const SEVERITY_CONFIG = {
  HIGH:   { label: 'HIGH',   icon: '🔴', color: 'high'   },
  MEDIUM: { label: 'MEDIUM', icon: '🟡', color: 'medium' },
  LOW:    { label: 'LOW',    icon: '🟢', color: 'low'    },
}

const AnalyzeDocument = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const chatMessagesRef = useRef(null)

  // session state
  const [currentSessionId, setCurrentSessionId] = useState(null)

  // document state
  const [documentId,   setDocumentId]   = useState(null)
  const [documentName, setDocumentName] = useState('')

  // analysis state
  const [analyzing,  setAnalyzing]  = useState(false)
  const [analyzed,   setAnalyzed]   = useState(false)
  const [summary,    setSummary]    = useState('')
  const [redFlags,   setRedFlags]   = useState([])
  const [analyzeErr, setAnalyzeErr] = useState(null)
  const [streamingLog, setStreamingLog] = useState('')
  const [abortController, setAbortController] = useState(null)

  // per-flag alternatives state  { index: { loading, text, shown } }
  const [alternatives, setAlternatives] = useState({})

  // chat state
  const [messages,     setMessages]     = useState([])
  const [chatInput,    setChatInput]    = useState('')
  const [chatLoading,  setChatLoading]  = useState(false)
  const [chatError,    setChatError]    = useState(null)

  /* ── on mount: read document from localStorage OR load session ─────────── */
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const sessionIdParam = params.get('session_id')

    if (sessionIdParam) {
      // Load an existing session from history
      setAnalyzing(true)
      getSession(sessionIdParam)
        .then(data => {
          setDocumentId(data.session.document_id)
          setDocumentName(data.session.document_name)
          setCurrentSessionId(data.session_id)
          setMessages(data.messages || [])
          setAnalyzed(true) // Open the UI
          // Optional: we don't restore red flags here, just the chat that shows the summary
        })
        .catch(err => {
          console.error("Failed to load session:", err)
          setAnalyzeErr("Failed to load this chat session.")
        })
        .finally(() => setAnalyzing(false))
    } else {
      // No session param, so start fresh from the uploaded document
      const docId   = localStorage.getItem('currentDocumentId')
      const docName = localStorage.getItem('currentDocumentName')
      if (!docId) {
        navigate('/upload')
      } else {
        setDocumentId(docId)
        setDocumentName(docName || 'Document')
        setCurrentSessionId(null)
        setMessages([])
        setAnalyzed(false)
        setSummary('')
        setRedFlags([])
      }
    }
  }, [location.search, navigate])

  /* ── auto-scroll chat ───────────────────────────────────────────────────── */
  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight
    }
  }, [messages])

  /* ── start analysis ─────────────────────────────────────────────────────── */
  const handleAnalyze = async () => {
    if (!documentId || analyzing) return
    setAnalyzing(true)
    setAnalyzeErr(null)
    setRedFlags([])
    setSummary('')
    setAlternatives({})
    setStreamingLog('Starting deep scan...')

    try {
      const controller = new AbortController()
      setAbortController(controller)

      let finalJSON = ''
      await analyzeDocumentStream(
        documentId,
        (chunk) => {
          if (chunk.type === 'metadata') {
            if (chunk.data.session_id && !currentSessionId) {
              setCurrentSessionId(chunk.data.session_id)
              navigate(`/analyze-document?session_id=${chunk.data.session_id}`, { replace: true })
            }
          } else if (chunk.type === 'partial_json') {
            finalJSON = chunk.data
            // Show a tiny bit of the stream so user knows it's working
            setStreamingLog(`Analyzing document structure... ${finalJSON.length} chars processed.`)
          }
        },
        controller.signal,
        'llama3.2',
        currentSessionId
      )

      // Once finished, parse the final JSON
      try {
        const data = JSON.parse(finalJSON)
        setSummary(data.summary || 'Analysis complete.')
        setRedFlags(data.red_flags || [])
        setAnalyzed(true)
      } catch (e) {
        console.error("Failed to parse analysis JSON", e)
        setAnalyzeErr("The AI generated a response that couldn't be parsed. Please try again.")
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setAnalyzeErr("Analysis canceled by user.")
      } else if (err.message === 'Access denied.' || err.message === 'Document not found.') {
        localStorage.removeItem('currentDocumentId')
        localStorage.removeItem('currentDocumentName')
        navigate('/upload')
      } else {
        setAnalyzeErr(err.message || 'Analysis failed. Please try again.')
      }
    } finally {
      setAnalyzing(false)
      setStreamingLog('')
      setAbortController(null)
    }
  }

  /* ── suggest alternative for one flag ──────────────────────────────────── */
  const handleSuggestAlternative = async (index, flag) => {
    setAlternatives(prev => ({
      ...prev,
      [index]: { loading: true, text: '', shown: true }
    }))
    try {
      const data = await suggestAlternative(
        documentId,
        flag.title,
        flag.excerpt,
        flag.issue
      )
      setAlternatives(prev => ({
        ...prev,
        [index]: { loading: false, text: data.alternative, shown: true }
      }))
    } catch (err) {
      setAlternatives(prev => ({
        ...prev,
        [index]: { loading: false, text: `Error: ${err.message}`, shown: true }
      }))
    }
  }

  const toggleAlternative = (index) => {
    setAlternatives(prev => ({
      ...prev,
      [index]: { ...(prev[index] || {}), shown: !prev[index]?.shown }
    }))
  }

  /* ── chat ───────────────────────────────────────────────────────────────── */
  const handleChatSend = async () => {
    if (!chatInput.trim() || !documentId || chatLoading) return
    const userMsg = chatInput.trim()
    setChatInput('')
    setChatError(null)
    
    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: userMsg }])
    
    // Add empty assistant message to be filled by stream
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])
    
    setChatLoading(true)

    try {
      let currentContent = ''
      await chatWithDocumentStream(
        documentId, 
        userMsg, 
        (chunk) => {
          if (chunk.type === 'metadata') {
            if (chunk.data.session_id && !currentSessionId) {
              setCurrentSessionId(chunk.data.session_id)
              navigate(`/analyze-document?session_id=${chunk.data.session_id}`, { replace: true })
            }
          } else if (chunk.type === 'text') {
            currentContent += chunk.data
            // Update the last message in the list
            setMessages(prev => {
              const newMsgs = [...prev]
              newMsgs[newMsgs.length - 1] = { 
                ...newMsgs[newMsgs.length - 1], 
                content: currentContent 
              }
              return newMsgs
            })
          }
        },
        null,
        'llama3.2',
        currentSessionId
      )
    } catch (err) {
      setChatError(err.message || 'Failed to get a response.')
      // Remove the empty assistant bubble on error
      setMessages(prev => prev.slice(0, -1))
    } finally {
      setChatLoading(false)
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleChatSend()
    }
  }

  const countBySeverity = (sev) => redFlags.filter(f => f.severity === sev).length

  /* ── render ─────────────────────────────────────────────────────────────── */
  return (
    <div className="analyze-document">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="analyze-header">
        <div className="analyze-header__left">
          <h1>🔍 Analyze Document</h1>
          <p>AI-powered red flag detection for contracts &amp; legal documents</p>
        </div>
        {documentName && (
          <span className="doc-badge">📄 {documentName}</span>
        )}
      </div>

      {/* ── Start button / loading ──────────────────────────────────────────── */}
      {!analyzed && (
        <div className="analyze-cta">
          {analyzing ? (
            <div className="analyzing-state">
              <div className="pulse-ring" />
              <div className="analyzing-text">
                <span className="analyzing-icon">⚖️</span>
                <div>
                  <p className="analyzing-title">Analyzing document…</p>
                  <p className="analyzing-sub">{streamingLog || 'This may take 30–60 seconds depending on document length'}</p>
                </div>
              </div>
              <button 
                className="cancel-btn error"
                onClick={() => {
                  if (abortController) {
                    abortController.abort()
                  }
                }}
                style={{ marginTop: '1rem', background: 'transparent', border: '1px solid var(--text-error)', color: 'var(--text-error)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer' }}
              >
                Cancel Analysis
              </button>
            </div>
          ) : (
            <button className="start-btn" onClick={handleAnalyze}>
              <span>🔍</span> Start Analysis
            </button>
          )}
          {analyzeErr && (
            <div className="error-banner">⚠️ {analyzeErr}</div>
          )}
        </div>
      )}

      {/* ── Results ────────────────────────────────────────────────────────── */}
      {analyzed && (
        <div className="analyze-results">

          {/* Summary */}
          {summary && (
            <div className="result-summary">
              <div className="summary-header">
                <span className="summary-icon">📊</span>
                <h2>Overall Assessment</h2>
              </div>
              <div className="summary-content">
                {summary.split('\n').map((paragraph, i) => (
                  paragraph.trim() ? <p key={i}>{paragraph}</p> : null
                ))}
              </div>
              <div className="severity-badges">
                {countBySeverity('HIGH') > 0 && (
                  <span className="badge badge--high">🔴 {countBySeverity('HIGH')} High</span>
                )}
                {countBySeverity('MEDIUM') > 0 && (
                  <span className="badge badge--medium">🟡 {countBySeverity('MEDIUM')} Medium</span>
                )}
                {countBySeverity('LOW') > 0 && (
                  <span className="badge badge--low">🟢 {countBySeverity('LOW')} Low</span>
                )}
                {redFlags.length === 0 && (
                  <span className="badge badge--clean">✅ No Red Flags Found</span>
                )}
              </div>
            </div>
          )}

          {/* Re-analyse button */}
          <button className="reanalyze-btn" onClick={() => { setAnalyzed(false); setRedFlags([]); setSummary('') }}>
            🔄 Re-analyze
          </button>

          {/* Red flag cards */}
          {redFlags.length > 0 && (
            <div className="flags-section">
              <h2 className="flags-title">🚨 Red Flags Found ({redFlags.length})</h2>
              <div className="flags-list">
                {redFlags.map((flag, idx) => {
                  const cfg = SEVERITY_CONFIG[flag.severity] || SEVERITY_CONFIG.MEDIUM
                  const alt = alternatives[idx]
                  return (
                    <div key={idx} className={`flag-card flag-card--${cfg.color}`}>
                      <div className="flag-card__header">
                        <div className="flag-card__title-row">
                          <span className="flag-sev-icon">{cfg.icon}</span>
                          <h3 className="flag-title">{flag.title}</h3>
                          <span className={`sev-badge sev-badge--${cfg.color}`}>{cfg.label}</span>
                        </div>
                      </div>

                      {flag.excerpt && (
                        <blockquote className="flag-excerpt">
                          "{flag.excerpt}"
                        </blockquote>
                      )}

                      <p className="flag-issue">{flag.issue}</p>

                      {/* Suggest Alternative button */}
                      <div className="flag-actions">
                        {!alt ? (
                          <button
                            className="alt-btn"
                            onClick={() => handleSuggestAlternative(idx, flag)}
                          >
                            💡 Suggest Alternative
                          </button>
                        ) : (
                          <button
                            className="alt-btn alt-btn--toggle"
                            onClick={() => toggleAlternative(idx)}
                          >
                            {alt.shown ? '▲ Hide Alternative' : '💡 Show Alternative'}
                          </button>
                        )}
                      </div>

                      {/* Alternative content */}
                      {alt && alt.shown && (
                        <div className="alternative-panel">
                          {alt.loading ? (
                            <div className="alt-loading">
                              <div className="typing-indicator">
                                <span /><span /><span />
                              </div>
                              <p>Generating alternative…</p>
                            </div>
                          ) : (
                            <div className="alt-content">
                              <div className="alt-content__header">💡 Alternative &amp; Negotiation Advice</div>
                              <pre className="alt-text">{alt.text}</pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Chat section ───────────────────────────────────────────────────── */}
      <div className="chat-section">
        <div className="chat-divider">
          <span>💬 Ask Questions About This Document</span>
        </div>

        <div className="chat-messages" ref={chatMessagesRef}>
          {messages.length === 0 ? (
            <div className="chat-empty">
              <p className="chat-empty__hint">Ask anything about the document — clauses, obligations, definitions, or follow-ups on any red flag.</p>
              <div className="example-pills">
                {['What are my cancellation rights?', 'Summarize my obligations', 'What data is collected?'].map(q => (
                  <button key={q} className="pill" onClick={() => setChatInput(q)}>{q}</button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg, idx) => (
                <div key={idx} className={`chat-msg chat-msg--${msg.role}`}>
                  <div className="chat-msg__avatar">
                    {msg.role === 'user' ? '👤' : '🤖'}
                  </div>
                  <div className="chat-msg__bubble">
                    <pre className="chat-msg__text">{msg.content}</pre>
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="chat-msg chat-msg--assistant">
                  <div className="chat-msg__avatar">🤖</div>
                  <div className="chat-msg__bubble">
                    <div className="typing-indicator">
                      <span /><span /><span />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {chatError && <div className="error-banner">⚠️ {chatError}</div>}

        <div className="chat-input-bar">
          <textarea
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask a question about this document…"
            rows={1}
            disabled={chatLoading}
            maxLength={2000}
          />
          <button
            onClick={handleChatSend}
            disabled={!chatInput.trim() || chatLoading || !documentId}
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  )
}

export default AnalyzeDocument
