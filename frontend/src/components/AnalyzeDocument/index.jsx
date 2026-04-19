import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { analyzeDocument, analyzeDocumentStream, suggestAlternative, chatWithDocument, chatWithDocumentStream, getSession } from '../../utils/api'
import jsPDF from 'jspdf'
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

  // re-analyze click counter (shows Force button after 2 clicks)
  const [reanalyzeCount, setReanalyzeCount] = useState(0)

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

          // Restore cached red flags + summary if available
          if (data.analysis) {
            setSummary(data.analysis.summary || '')
            setRedFlags(data.analysis.red_flags || [])
          } else {
            setSummary('')
            setRedFlags([])
          }

          setAnalyzed(true) // Open the UI
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
  const handleAnalyze = async (force = false) => {
    if (!documentId || analyzing) return
    setAnalyzing(true)
    setAnalyzeErr(null)
    setRedFlags([])
    setSummary('')
    setAlternatives({})
    setStreamingLog(force ? 'Running fresh analysis...' : 'Loading analysis...')

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
            setStreamingLog(`Analyzing document structure... ${finalJSON.length} chars processed.`)
          }
        },
        controller.signal,
        'llama3.2',
        currentSessionId,
        force
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

  /* ── PDF download ──────────────────────────────────────────────────────── */
  const handleDownloadPDF = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageW = doc.internal.pageSize.getWidth()
    const pageH = doc.internal.pageSize.getHeight()
    const margin = 18
    const contentW = pageW - margin * 2
    const footerH = 14
    const bottomLimit = pageH - footerH - 4
    let y = margin

    // Safe page-break: if not enough space, start new page
    const ensureSpace = (needed) => {
      if (y + needed > bottomLimit) {
        doc.addPage()
        y = margin
      }
    }

    // Helper: draw wrapped text line-by-line with page breaks
    const drawWrappedText = (lines, x, lineH) => {
      for (let i = 0; i < lines.length; i++) {
        ensureSpace(lineH)
        doc.text(lines[i], x, y)
        y += lineH
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // HEADER BAR
    // ─────────────────────────────────────────────────────────────────────
    doc.setFillColor(42, 45, 52)
    doc.rect(0, 0, pageW, 32, 'F')
    doc.setFillColor(212, 175, 55)
    doc.rect(0, 32, pageW, 1.5, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(18)
    doc.setTextColor(245, 197, 24)
    doc.text('LegalEase', margin, 14)

    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(180, 180, 180)
    doc.text('AI-Powered Document Analysis Report', margin, 22)

    const dateStr = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    })
    doc.text(dateStr, pageW - margin, 14, { align: 'right' })

    const truncDocName = (documentName || 'Document').substring(0, 50)
    doc.text(truncDocName, pageW - margin, 22, { align: 'right' })

    y = 40

    // ─────────────────────────────────────────────────────────────────────
    // SUMMARY SECTION
    // ─────────────────────────────────────────────────────────────────────
    if (summary) {
      // Section divider line
      doc.setDrawColor(212, 175, 55)
      doc.setLineWidth(0.3)
      doc.line(margin, y, margin + contentW, y)
      y += 6

      ensureSpace(10)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(13)
      doc.setTextColor(30, 30, 30)
      doc.text('Overall Assessment', margin, y)
      y += 8

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(60, 60, 60)
      const summaryLines = doc.splitTextToSize(summary, contentW)
      drawWrappedText(summaryLines, margin, 5.5)
      y += 4
    }

    // ─────────────────────────────────────────────────────────────────────
    // SEVERITY COUNTS BAR
    // ─────────────────────────────────────────────────────────────────────
    ensureSpace(14)
    const highCount = countBySeverity('HIGH')
    const medCount = countBySeverity('MEDIUM')
    const lowCount = countBySeverity('LOW')

    doc.setFillColor(245, 245, 248)
    doc.roundedRect(margin, y, contentW, 10, 2, 2, 'F')
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    let badgeX = margin + 6

    if (highCount > 0) {
      doc.setFillColor(220, 38, 38)
      doc.circle(badgeX, y + 5, 1.5, 'F')
      doc.setTextColor(220, 38, 38)
      doc.text(`${highCount} High`, badgeX + 4, y + 6.5)
      badgeX += 28
    }
    if (medCount > 0) {
      doc.setFillColor(217, 119, 6)
      doc.circle(badgeX, y + 5, 1.5, 'F')
      doc.setTextColor(217, 119, 6)
      doc.text(`${medCount} Medium`, badgeX + 4, y + 6.5)
      badgeX += 32
    }
    if (lowCount > 0) {
      doc.setFillColor(5, 150, 105)
      doc.circle(badgeX, y + 5, 1.5, 'F')
      doc.setTextColor(5, 150, 105)
      doc.text(`${lowCount} Low`, badgeX + 4, y + 6.5)
      badgeX += 26
    }
    if (redFlags.length === 0) {
      doc.setTextColor(5, 150, 105)
      doc.text('No Red Flags Found', badgeX + 4, y + 6.5)
    }
    y += 16

    // ─────────────────────────────────────────────────────────────────────
    // RED FLAG CARDS
    // ─────────────────────────────────────────────────────────────────────
    if (redFlags.length > 0) {
      ensureSpace(12)
      doc.setDrawColor(212, 175, 55)
      doc.setLineWidth(0.3)
      doc.line(margin, y, margin + contentW, y)
      y += 6

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(13)
      doc.setTextColor(30, 30, 30)
      doc.text(`Red Flags Found (${redFlags.length})`, margin, y)
      y += 10

      const sevColors = {
        HIGH:   [239, 68, 68],
        MEDIUM: [245, 158, 11],
        LOW:    [16, 185, 129]
      }

      redFlags.forEach((flag, idx) => {
        const sevColor = sevColors[flag.severity] || sevColors.MEDIUM

        // ── Pre-calculate all text lines for this card ──
        const titleText = `${idx + 1}. ${flag.title}`
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(10)
        const titleLines = doc.splitTextToSize(titleText, contentW - 30)

        let excerptLines = []
        if (flag.excerpt) {
          doc.setFont('helvetica', 'italic')
          doc.setFontSize(9)
          excerptLines = doc.splitTextToSize('"' + flag.excerpt + '"', contentW - 20)
        }

        let issueLines = []
        if (flag.issue) {
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(9.5)
          issueLines = doc.splitTextToSize(flag.issue, contentW - 10)
        }

        const alt = alternatives[idx]
        let altLines = []
        if (alt && alt.text && !alt.loading) {
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(9)
          altLines = doc.splitTextToSize(alt.text, contentW - 20)
        }

        // ── Calculate total card height ──
        const titleH = titleLines.length * 5 + 6
        const excerptH = excerptLines.length > 0 ? excerptLines.length * 4.5 + 8 : 0
        const issueH = issueLines.length > 0 ? issueLines.length * 5 + 4 : 0
        const altH = altLines.length > 0 ? altLines.length * 4.5 + 14 : 0
        const totalCardH = titleH + excerptH + issueH + altH + 4

        // Page break if card doesn't fit (but min 40mm to avoid infinite loop)
        ensureSpace(Math.min(totalCardH, 40))

        const cardTop = y

        // ── Title background ──
        doc.setFillColor(248, 248, 250)
        doc.roundedRect(margin, y, contentW, titleH, 2, 2, 'F')



        // Title text
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(10)
        doc.setTextColor(30, 30, 30)
        let titleY = y + 5
        titleLines.forEach((line) => {
          doc.text(line, margin + 6, titleY)
          titleY += 5
        })

        // Severity label
        doc.setFontSize(8)
        doc.setTextColor(...sevColor)
        doc.text(`[${flag.severity}]`, pageW - margin - 4, y + 5, { align: 'right' })

        y += titleH + 2

        // ── Excerpt block ──
        if (excerptLines.length > 0) {
          ensureSpace(excerptH)
          const exTop = y

          // Background
          doc.setFillColor(244, 244, 248)
          doc.roundedRect(margin + 6, exTop, contentW - 12, excerptH - 2, 1.5, 1.5, 'F')



          // Excerpt text
          doc.setFont('helvetica', 'italic')
          doc.setFontSize(9)
          doc.setTextColor(90, 90, 90)
          y = exTop + 4
          excerptLines.forEach((line) => {
            doc.text(line, margin + 12, y)
            y += 4.5
          })
          y += 2
        }

        // ── Issue text ──
        if (issueLines.length > 0) {
          ensureSpace(6)
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(9.5)
          doc.setTextColor(55, 55, 55)
          y += 1
          issueLines.forEach((line) => {
            ensureSpace(5)
            doc.text(line, margin + 6, y)
            y += 5
          })
          y += 2
        }

        // ── Alternative block ──
        if (altLines.length > 0) {
          ensureSpace(14)
          const altTop = y

          // Background
          doc.setFillColor(255, 250, 230)
          const altBlockH = altLines.length * 4.5 + 12
          doc.roundedRect(margin + 6, altTop, contentW - 12, altBlockH, 1.5, 1.5, 'F')

          // Header label
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(8)
          doc.setTextColor(180, 140, 10)
          doc.text('SUGGESTED ALTERNATIVE', margin + 10, altTop + 5)

          // Alt text
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(9)
          doc.setTextColor(70, 60, 30)
          y = altTop + 10
          altLines.forEach((line) => {
            ensureSpace(5)
            doc.text(line, margin + 10, y)
            y += 4.5
          })
          y += 4
        }

        // Bottom spacing between cards
        y += 8

        // Thin separator between cards
        if (idx < redFlags.length - 1) {
          doc.setDrawColor(220, 220, 225)
          doc.setLineWidth(0.2)
          doc.line(margin + 10, y - 4, pageW - margin - 10, y - 4)
        }
      })
    }

    // ─────────────────────────────────────────────────────────────────────
    // FOOTER on every page
    // ─────────────────────────────────────────────────────────────────────
    const totalPages = doc.internal.getNumberOfPages()
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i)
      doc.setFillColor(245, 245, 248)
      doc.rect(0, pageH - footerH, pageW, footerH, 'F')
      doc.setFillColor(212, 175, 55)
      doc.rect(0, pageH - footerH, pageW, 0.5, 'F')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(140, 140, 140)
      doc.text('Generated by LegalEase - AI Document Analysis', margin, pageH - 5)
      doc.text(`Page ${i} of ${totalPages}`, pageW - margin, pageH - 5, { align: 'right' })
    }

    // Save file
    const safeName = (documentName || 'document').replace(/[^a-zA-Z0-9]/g, '_')
    doc.save(`LegalEase_Analysis_${safeName}.pdf`)
  }

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
            <button className="start-btn" onClick={() => handleAnalyze(false)}>
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
          {/* Re-analyse (from cache) + Force Re-analyse (fresh API call) */}
          <div className="reanalyze-actions">
            <button className="reanalyze-btn" onClick={() => { setReanalyzeCount(c => c + 1); setAnalyzed(false); setRedFlags([]); setSummary('') }}>
              🔄 Re-analyze
            </button>
            {reanalyzeCount >= 2 && (
              <button className="reanalyze-btn reanalyze-btn--force" onClick={() => { setReanalyzeCount(0); setAnalyzed(false); setRedFlags([]); setSummary(''); setTimeout(() => handleAnalyze(true), 100) }}>
                ⚡ Force Re-analyze
              </button>
            )}
          </div>

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

      {/* ── Download PDF ───────────────────────────────────────────────────── */}
      {analyzed && (
        <div className="download-section">
          <button className="download-btn" onClick={handleDownloadPDF}>
            <span className="download-btn__icon">📥</span>
            <span className="download-btn__text">Download Analysis Report (PDF)</span>
          </button>
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
