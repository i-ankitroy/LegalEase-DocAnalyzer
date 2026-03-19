import { useState } from 'react'
import { uploadDocument } from '../../utils/api'
import './index.scss'

const ALLOWED_EXTENSIONS = ['.pdf', '.txt', '.docx']
const MAX_SIZE_MB = 100

const Upload = () => {
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)


  const validateFile = (f) => {
    if (!f) return 'No file selected.'
    const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return `Unsupported file type "${ext}". Allowed: PDF, TXT, DOCX.`
    }
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      return `File is too large. Maximum size is ${MAX_SIZE_MB}MB.`
    }
    return null
  }

  const handleFileChange = (e) => {
    const selected = e.target.files[0]
    if (!selected) return
    const validationError = validateFile(selected)
    if (validationError) {
      setError(validationError)
      setFile(null)
    } else {
      setFile(selected)
      setError(null)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    const dropped = e.dataTransfer.files[0]
    if (!dropped) return
    const validationError = validateFile(dropped)
    if (validationError) {
      setError(validationError)
      setFile(null)
    } else {
      setFile(dropped)
      setError(null)
    }
  }

  const handleDragOver = (e) => e.preventDefault()

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)
    setError(null)

    try {
      const data = await uploadDocument(file)
      // Store document reference for the analyze page
      localStorage.setItem('currentDocumentId', data.document_id)
      localStorage.setItem('currentDocumentName', data.filename)
      window.location.href = '/analyze-document'
    } catch (err) {
      setError(err.message || 'Failed to upload document. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="upload">
      <h1>Upload Your Document</h1>
      <p className="description">
        Upload a PDF, TXT, or DOCX file to start asking questions
      </p>

      <div
        className="upload-area"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <div className="upload-content">
          <span className="upload-icon">📁</span>
          <h3>Drag and drop your file here</h3>
          <p>or</p>
          <label className="file-label">
            <input
              type="file"
              accept=".pdf,.txt,.docx"
              onChange={handleFileChange}
            />
            Browse Files
          </label>
          <p className="file-types">Supported: PDF, TXT, DOCX (max {MAX_SIZE_MB}MB)</p>
        </div>
      </div>

      {error && (
        <div className="error-message">
          <span>⚠️</span>
          <p>{error}</p>
        </div>
      )}

      {file && (
        <div className="file-preview">
          <div className="file-info">
            <span className="file-icon">📄</span>
            <div className="file-details">
              <p className="file-name">{file.name}</p>
              <p className="file-size">{(file.size / 1024).toFixed(2)} KB</p>
            </div>
            <button className="remove-btn" onClick={() => setFile(null)}>✕</button>
          </div>

          <button
            className="upload-btn"
            onClick={handleUpload}
            disabled={uploading}
          >
            {uploading ? 'Uploading...' : 'Upload and Continue'}
          </button>
        </div>
      )}
    </div>
  )
}

export default Upload