import { useState } from 'react'
import RecordPage from './pages/RecordPage'
import EditorPage from './pages/EditorPage'
import type { AppPage, RecordingResult } from './types'

export default function App() {
  const [page, setPage] = useState<AppPage>('record')
  const [recordingResult, setRecordingResult] = useState<RecordingResult | null>(null)

  const handleRecordingComplete = (result: RecordingResult) => {
    setRecordingResult(result)
    setPage('editor')
  }

  const handleBackToRecord = () => {
    if (recordingResult) {
      URL.revokeObjectURL(recordingResult.videoUrl)
    }
    setRecordingResult(null)
    setPage('record')
  }

  return (
    <div className="h-screen flex flex-col bg-bg-primary overflow-hidden">
      {page === 'record' && (
        <RecordPage onRecordingComplete={handleRecordingComplete} />
      )}
      {page === 'editor' && recordingResult && (
        <EditorPage result={recordingResult} onBack={handleBackToRecord} />
      )}
    </div>
  )
}
