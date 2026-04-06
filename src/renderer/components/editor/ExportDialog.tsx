import { useState } from 'react'
import { Download, X, Check } from 'lucide-react'
import { useEditorStore } from '../../store/useEditorStore'
import type { ExportSettings } from '../../types'

interface ExportDialogProps {
  onClose: () => void
  videoBlob: Blob
}

const ASPECT_RATIOS: ExportSettings['aspectRatio'][] = ['16:9', '4:3', '1:1', '9:16']
const RESOLUTIONS: ExportSettings['resolution'][] = ['720p', '1080p', '1440p', '4k']
const FORMATS: ExportSettings['format'][] = ['mp4', 'webm']
const FPS_OPTIONS: ExportSettings['fps'][] = [30, 60]

function AspectRatioIcon({ ratio }: { ratio: string }) {
  const dims: Record<string, { w: number; h: number }> = {
    '16:9': { w: 32, h: 18 },
    '4:3': { w: 28, h: 21 },
    '1:1': { w: 24, h: 24 },
    '9:16': { w: 18, h: 32 }
  }
  const d = dims[ratio] || { w: 32, h: 18 }
  return (
    <div className="flex items-center justify-center" style={{ width: 40, height: 40 }}>
      <div className="border-2 border-current rounded-sm" style={{ width: d.w, height: d.h }} />
    </div>
  )
}

export default function ExportDialog({ onClose, videoBlob }: ExportDialogProps) {
  const { project, setExportSettings } = useEditorStore()
  const [exporting, setExporting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!project) return null
  const settings = project.exportSettings

  const update = (partial: Partial<ExportSettings>) => {
    setExportSettings({ ...settings, ...partial })
  }

  const handleExport = async () => {
    setExporting(true)
    setError(null)
    try {
      const result = await window.electronAPI.showSaveDialog(
        `focra-export.${settings.format === 'mp4' ? 'mp4' : 'webm'}`
      )
      if (result.canceled || !result.filePath) {
        setExporting(false)
        return
      }

      const buffer = await videoBlob.arrayBuffer()
      await window.electronAPI.saveFile(buffer, result.filePath)
      setDone(true)
    } catch (err) {
      setError(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-bg-secondary rounded-2xl border border-border w-[520px] shadow-2xl animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Download size={18} className="text-accent" />
            <h2 className="text-base font-semibold text-text-primary">Export Video</h2>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Aspect Ratio */}
          <div className="space-y-2">
            <span className="label">Aspect Ratio</span>
            <div className="grid grid-cols-4 gap-2">
              {ASPECT_RATIOS.map((r) => (
                <button
                  key={r}
                  onClick={() => update({ aspectRatio: r })}
                  className={`flex flex-col items-center gap-1 py-3 rounded-xl border-2 transition-all
                    ${settings.aspectRatio === r
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border text-text-secondary hover:border-[#444]'}`}
                >
                  <AspectRatioIcon ratio={r} />
                  <span className="text-xs font-medium">{r}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Resolution */}
          <div className="space-y-2">
            <span className="label">Resolution</span>
            <div className="grid grid-cols-4 gap-2">
              {RESOLUTIONS.map((r) => (
                <button
                  key={r}
                  onClick={() => update({ resolution: r })}
                  className={`py-2 rounded-xl border-2 text-sm font-medium transition-all
                    ${settings.resolution === r
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border text-text-secondary hover:border-[#444]'}`}
                >
                  {r === '4k' ? '4K' : r}
                </button>
              ))}
            </div>
          </div>

          {/* Format + FPS */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <span className="label">Format</span>
              <div className="flex gap-2">
                {FORMATS.map((f) => (
                  <button
                    key={f}
                    onClick={() => update({ format: f })}
                    className={`flex-1 py-2 rounded-lg border-2 text-sm font-medium uppercase transition-all
                      ${settings.format === f
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border text-text-secondary hover:border-[#444]'}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <span className="label">Frame Rate</span>
              <div className="flex gap-2">
                {FPS_OPTIONS.map((f) => (
                  <button
                    key={f}
                    onClick={() => update({ fps: f })}
                    className={`flex-1 py-2 rounded-lg border-2 text-sm font-medium transition-all
                      ${settings.fps === f
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border text-text-secondary hover:border-[#444]'}`}
                  >
                    {f} fps
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className="text-xs text-text-muted bg-bg-tertiary rounded-lg p-3">
            Note: The current MVP exports the recorded WebM file directly. Full rendering pipeline with zoom effects, annotations, and background compositing is planned for a future release.
          </p>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="btn-secondary flex-1">
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={exporting || done}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl font-semibold transition-all
                ${done
                  ? 'bg-green-700 text-white'
                  : 'bg-accent hover:bg-accent-hover text-white disabled:opacity-60'}`}
            >
              {done ? (
                <><Check size={18} /> Exported!</>
              ) : exporting ? (
                <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Exporting...</>
              ) : (
                <><Download size={18} /> Export</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
