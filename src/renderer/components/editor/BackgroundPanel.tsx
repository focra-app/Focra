import { useState } from 'react'
import { Image, Palette } from 'lucide-react'
import { useEditorStore } from '../../store/useEditorStore'
import type { Background } from '../../types'

type Tab = 'solid' | 'gradient' | 'image'

const PRESET_COLORS = [
  '#0f0f0f', '#1a1a2e', '#16213e', '#0f3460',
  '#533483', '#2d132c', '#1b1b2f', '#222831'
]

export default function BackgroundPanel() {
  const { project, setBackground } = useEditorStore()
  const [tab, setTab] = useState<Tab>('solid')

  if (!project) return null
  const bg = project.background

  const updateBg = (partial: Partial<Background>) => {
    setBackground({ ...bg, ...partial })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Palette size={15} className="text-accent" />
        <span className="text-sm font-semibold text-text-primary">Background</span>
      </div>

      {/* Tabs */}
      <div className="flex bg-bg-tertiary rounded-lg p-0.5">
        {(['solid', 'gradient', 'image'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t)
              updateBg({ type: t })
            }}
            className={`flex-1 text-xs py-1.5 rounded-md capitalize transition-colors
              ${tab === t ? 'bg-bg-secondary text-text-primary font-medium' : 'text-text-secondary hover:text-text-primary'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Solid color */}
      {tab === 'solid' && (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                className={`h-10 rounded-lg border-2 transition-transform hover:scale-105
                  ${bg.color === c ? 'border-accent' : 'border-border'}`}
                style={{ backgroundColor: c }}
                onClick={() => updateBg({ color: c })}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={bg.color || '#0f0f0f'}
              onChange={(e) => updateBg({ color: e.target.value })}
              className="w-10 h-10 rounded-lg cursor-pointer border-0"
            />
            <input
              type="text"
              value={bg.color || '#0f0f0f'}
              onChange={(e) => updateBg({ color: e.target.value })}
              className="input-field flex-1 text-sm font-mono"
            />
          </div>
        </div>
      )}

      {/* Gradient */}
      {tab === 'gradient' && (
        <div className="space-y-3">
          <div className="space-y-1">
            <span className="label">Type</span>
            <div className="flex bg-bg-tertiary rounded-lg p-0.5">
              {(['linear', 'radial'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => updateBg({ gradient: { ...bg.gradient!, type: t, stops: bg.gradient?.stops || [{ color: '#8b5cf6', position: 0 }, { color: '#0f0f0f', position: 1 }] } })}
                  className={`flex-1 text-xs py-1.5 rounded-md capitalize transition-colors
                    ${bg.gradient?.type === t ? 'bg-bg-secondary text-text-primary' : 'text-text-secondary'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {bg.gradient?.type === 'linear' && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="label mb-0">Angle</span>
                <span className="text-xs text-text-secondary">{bg.gradient?.angle || 0}°</span>
              </div>
              <input
                type="range"
                min={0}
                max={360}
                value={bg.gradient?.angle || 0}
                onChange={(e) => updateBg({ gradient: { ...bg.gradient!, angle: parseInt(e.target.value) } })}
                className="w-full accent-accent cursor-pointer"
              />
            </div>
          )}

          {/* Color stops */}
          <div className="space-y-2">
            <span className="label">Color Stops</span>
            {(bg.gradient?.stops || [{ color: '#8b5cf6', position: 0 }, { color: '#0f0f0f', position: 1 }]).map((stop, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="color"
                  value={stop.color}
                  onChange={(e) => {
                    const newStops = [...(bg.gradient?.stops || [])]
                    newStops[i] = { ...newStops[i], color: e.target.value }
                    updateBg({ gradient: { ...bg.gradient!, stops: newStops } })
                  }}
                  className="w-8 h-8 rounded cursor-pointer border-0 flex-shrink-0"
                />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={stop.position}
                  onChange={(e) => {
                    const newStops = [...(bg.gradient?.stops || [])]
                    newStops[i] = { ...newStops[i], position: parseFloat(e.target.value) }
                    updateBg({ gradient: { ...bg.gradient!, stops: newStops } })
                  }}
                  className="flex-1 accent-accent cursor-pointer"
                />
                <span className="text-xs text-text-muted w-8">{Math.round(stop.position * 100)}%</span>
              </div>
            ))}
          </div>

          {/* Preview */}
          <div
            className="h-12 rounded-lg"
            style={{
              background: bg.gradient?.type === 'linear'
                ? `linear-gradient(${bg.gradient?.angle || 0}deg, ${(bg.gradient?.stops || []).map((s) => `${s.color} ${s.position * 100}%`).join(', ')})`
                : `radial-gradient(circle, ${(bg.gradient?.stops || []).map((s) => `${s.color} ${s.position * 100}%`).join(', ')})`
            }}
          />
        </div>
      )}

      {/* Image */}
      {tab === 'image' && (
        <div className="space-y-3">
          <button
            onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = 'image/*'
              input.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0]
                if (file) {
                  const url = URL.createObjectURL(file)
                  updateBg({ imageUrl: url })
                }
              }
              input.click()
            }}
            className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-border rounded-xl py-6 text-text-secondary hover:border-accent hover:text-accent transition-colors"
          >
            <Image size={20} />
            <span className="text-sm">Choose Image</span>
          </button>
          {bg.imageUrl && (
            <img
              src={bg.imageUrl}
              alt="Background"
              className="w-full rounded-xl aspect-video object-cover"
            />
          )}
        </div>
      )}
    </div>
  )
}
