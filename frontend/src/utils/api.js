// API utility for making authenticated requests
// Auth tokens are stored in httpOnly cookies (inaccessible to JS).
// Every request must include credentials: 'include' so the browser
// automatically attaches those cookies.

const API_BASE_URL = 'http://localhost:8000'

// ── Core request helper ────────────────────────────────────────────────────────
export const apiRequest = async (endpoint, options = {}) => {
  const config = {
    ...options,
    credentials: 'include',   // send cookies on every request
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  }

  let response = await fetch(`${API_BASE_URL}${endpoint}`, config)

  // Attempt a silent token refresh on 401, then retry once
  if (response.status === 401) {
    const refreshed = await _tryRefresh()
    if (refreshed) {
      response = await fetch(`${API_BASE_URL}${endpoint}`, config)
    }
    if (response.status === 401) {
      // Refresh failed or second attempt also 401 → redirect to sign in
      _clearUserAndRedirect()
      throw new Error('Session expired. Please sign in again.')
    }
  }

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.detail || 'Request failed')
  }
  return data
}

// ── Token refresh ──────────────────────────────────────────────────────────────
async function _tryRefresh() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
    return res.ok
  } catch {
    return false
  }
}

// ── Clear local state and navigate to sign-in ──────────────────────────────────
function _clearUserAndRedirect() {
  localStorage.removeItem('user')
  localStorage.removeItem('currentDocumentId')
  localStorage.removeItem('currentDocumentName')
  window.location.href = '/signin'
}

// ── Specific API functions ─────────────────────────────────────────────────────

export const uploadDocument = async (file) => {
  const _buildForm = () => {
    const fd = new FormData()
    fd.append('file', file)
    return fd
  }

  let response = await fetch(`${API_BASE_URL}/upload`, {
    method: 'POST',
    credentials: 'include',
    body: _buildForm(),
    // Do NOT set Content-Type — browser sets it automatically with the boundary
  })

  if (response.status === 401) {
    const refreshed = await _tryRefresh()
    if (refreshed) {
      // Rebuild FormData — original stream was already consumed
      response = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        credentials: 'include',
        body: _buildForm(),
      })
    }
    if (response.status === 401) {
      _clearUserAndRedirect()
      throw new Error('Session expired. Please sign in again.')
    }
  }

  if (!response.ok) {
    let detail = 'Upload failed'
    try { detail = (await response.json()).detail || detail } catch { /* non-JSON body */ }
    throw new Error(detail)
  }

  return response.json()
}

export const chatWithDocument = async (documentId, question, model = 'llama3.2', sessionId = null) =>
  apiRequest('/chat', {
    method: 'POST',
    body: JSON.stringify({ 
      document_id: documentId, 
      question, 
      model,
      stream: false,
      ...(sessionId && { session_id: sessionId })
    }),
  })

export const chatWithDocumentStream = async (documentId, question, onChunk, signal = null, model = 'llama3.2', sessionId = null) => {
  const config = {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...(signal && { signal }),
    body: JSON.stringify({
      document_id: documentId,
      question,
      model,
      stream: true,
      ...(sessionId && { session_id: sessionId })
    }),
  }

  const response = await fetch(`${API_BASE_URL}/chat`, config)
  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.detail || 'Streaming failed')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    
    const chunk = decoder.decode(value, { stream: true })
    buffer += chunk

    // Handle METADATA prefix if present in the first chunk
    if (buffer.startsWith('METADATA:')) {
      const parts = buffer.split('\n\n')
      if (parts.length > 1) {
        const metadataStr = parts[0].replace('METADATA:', '')
        try {
          const metadata = JSON.parse(metadataStr)
          onChunk({ type: 'metadata', data: metadata })
          buffer = parts.slice(1).join('\n\n')
        } catch (e) {
          console.error("Failed to parse metadata", e)
        }
      }
    }

    if (buffer) {
      onChunk({ type: 'text', data: buffer })
      buffer = '' // for simple text streaming, we yield everything we have
    }
  }
}

export const legalChat = async (message) =>
  apiRequest('/api/legal/chat', {
    method: 'POST',
    body: JSON.stringify({ message }),
  })

export const legalChatWithHistory = async (messages) =>
  apiRequest('/api/legal/chat-history', {
    method: 'POST',
    body: JSON.stringify({ messages }),
  })

export const getDocument = async (documentId) =>
  apiRequest(`/document/${documentId}`)

export const listModels = async () =>
  apiRequest('/models')

export const analyzeDocument = async (documentId, model = 'llama3.2', sessionId = null) =>
  apiRequest('/analyze', {
    method: 'POST',
    body: JSON.stringify({
      document_id: documentId,
      model,
      stream: false,
      ...(sessionId && { session_id: sessionId })
    }),
  })

export const analyzeDocumentStream = async (documentId, onChunk, signal = null, model = 'llama3.2', sessionId = null) => {
  const config = {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...(signal && { signal }),
    body: JSON.stringify({
      document_id: documentId,
      model,
      stream: true,
      ...(sessionId && { session_id: sessionId })
    }),
  }

  const response = await fetch(`${API_BASE_URL}/analyze`, config)
  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.detail || 'Analysis stream failed')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let fullJSON = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    
    const chunk = decoder.decode(value, { stream: true })
    if (chunk.startsWith('METADATA:')) {
      const parts = chunk.split('\n\n')
      const metadataStr = parts[0].replace('METADATA:', '')
      try {
        const metadata = JSON.parse(metadataStr)
        onChunk({ type: 'metadata', data: metadata })
      } catch(e) {}
      fullJSON += parts.slice(1).join('\n\n')
    } else {
      fullJSON += chunk
    }

    // Attempt to parse partially to show progress
    // This is hard for complex JSON, so we'll just yield the text for now
    onChunk({ type: 'partial_json', data: fullJSON })
  }
}

export const suggestAlternative = async (documentId, redFlagTitle, redFlagExcerpt, redFlagIssue, model = 'llama3.2', sessionId = null) =>
  apiRequest('/suggest-alternative', {
    method: 'POST',
    body: JSON.stringify({
      document_id: documentId,
      red_flag_title: redFlagTitle,
      red_flag_excerpt: redFlagExcerpt,
      red_flag_issue: redFlagIssue,
      model,
      ...(sessionId && { session_id: sessionId })
    }),
  })

export const getHistory = async () =>
  apiRequest('/history')

export const getSession = async (sessionId) =>
  apiRequest(`/history/${sessionId}`)

export const deleteSession = async (sessionId) =>
  apiRequest(`/history/${sessionId}`, { method: 'DELETE' })

export const signOut = async () => {
  try {
    await fetch(`${API_BASE_URL}/api/auth/signout`, {
      method: 'POST',
      credentials: 'include',
    })
  } catch (error) {
    console.error("Signout error:", error)
  }
  _clearUserAndRedirect()
}