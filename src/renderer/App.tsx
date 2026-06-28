import { useState, Component, ErrorInfo, ReactNode } from 'react'
import RecordPage from './pages/RecordPage'
import EditorPage from './pages/EditorPage'
import type { AppPage, RecordingResult } from './types'

class ErrorBoundary extends Component<{children: ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: {children: ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 bg-red-900/50 text-white h-screen overflow-auto">
          <h1 className="text-xl font-bold mb-4">Something went wrong.</h1>
          <pre className="text-sm whitespace-pre-wrap">{this.state.error?.stack || this.state.error?.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

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
    <ErrorBoundary>
      <div className="h-screen flex flex-col bg-bg-primary overflow-hidden">
        {page === 'record' && (
          <RecordPage onRecordingComplete={handleRecordingComplete} />
        )}
        {page === 'editor' && recordingResult && (
          <EditorPage result={recordingResult} onBack={handleBackToRecord} />
        )}
      </div>
    </ErrorBoundary>
  )
}
