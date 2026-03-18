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
  // Only user display info remains in localStorage (no tokens)
  localStorage.removeItem('user')
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

export const chatWithDocument = async (documentId, question, model = 'llama3.2') =>
  apiRequest('/chat', {
    method: 'POST',
    body: JSON.stringify({ document_id: documentId, question, model }),
  })

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

export const signOut = async () => {
  await fetch(`${API_BASE_URL}/api/auth/signout`, {
    method: 'POST',
    credentials: 'include',
  })
  localStorage.removeItem('user')
  window.location.href = '/signin'
}