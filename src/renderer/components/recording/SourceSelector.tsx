import { useEffect, useState } from 'react'
import { Monitor, AppWindow } from 'lucide-react'
import type { DesktopSource } from '../../types'

interface SourceSelectorProps {
  onSelect: (source: DesktopSource) => void
  selected: DesktopSource | null
}

export default function SourceSelector({ onSelect, selected }: SourceSelectorProps) {
  const [sources, setSources] = useState<DesktopSource[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const srcs = await window.electronAPI.getSources()
        setSources(srcs)
        if (srcs.length > 0 && !selected) onSelect(srcs[0])
      } catch (err) {
        console.error('Failed to get sources:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-text-secondary">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mr-3" />
        Loading sources...
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="label">Select Source</p>
      <div className="grid grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-1">
        {sources.map((src) => {
          const isScreen = src.id.startsWith('screen')
          const isSelected = selected?.id === src.id
          return (
            <button
              key={src.id}
              onClick={() => onSelect(src)}
              className={`relative rounded-xl overflow-hidden border-2 transition-all duration-150 text-left group
                ${isSelected
                  ? 'border-accent shadow-[0_0_0_2px_rgba(139,92,246,0.3)]'
                  : 'border-border hover:border-[#444]'
                }`}
            >
              <img
                src={src.thumbnail}
                alt={src.name}
                className="w-full aspect-video object-cover bg-bg-tertiary"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 flex items-center gap-1.5">
                {isScreen
                  ? <Monitor size={12} className="text-accent flex-shrink-0" />
                  : <AppWindow size={12} className="text-text-secondary flex-shrink-0" />
                }
                <span className="text-xs text-white truncate">{src.name}</span>
              </div>
              {isSelected && (
                <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-accent flex items-center justify-center">
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                    <path d="M1 4L3 6L7 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
