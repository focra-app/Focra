import { useEditorStore } from '../../store/useEditorStore'
import { ZoomIn, Plus, Trash2 } from 'lucide-react'
import type { ZoomKeyframe } from '../../types'

export default function ZoomEditor() {
  const { project, selectedZoomId, currentTime, addZoom, updateZoom, deleteZoom, selectZoom } = useEditorStore()

  if (!project) return null

  const selectedZoom = project.zoomKeyframes.find((kf) => kf.id === selectedZoomId)

  const handleAddZoom = () => {
    const id = `zoom-${Date.now()}`
    addZoom({
      id,
      time: currentTime,
      duration: 2,
      x: 0.5,
      y: 0.5,
      scale: 2,
      easing: 'ease-in-out',
      motionBlur: false
    })
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ZoomIn size={15} className="text-accent" />
          <span className="text-sm font-semibold text-text-primary">Zoom Keyframes</span>
        </div>
        <button
          onClick={handleAddZoom}
          className="flex items-center gap-1 text-xs bg-accent/20 hover:bg-accent/30 text-accent px-2 py-1 rounded-lg transition-colors"
        >
          <Plus size={13} />
          Add
        </button>
      </div>

      {/* Keyframe list */}
      <div className="space-y-1 max-h-32 overflow-y-auto">
        {project.zoomKeyframes.length === 0 && (
          <p className="text-xs text-text-muted text-center py-3">No zoom keyframes. Add one or enable auto-zoom during recording.</p>
        )}
        {project.zoomKeyframes.map((kf) => (
          <button
            key={kf.id}
            onClick={() => selectZoom(kf.id)}
            className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors
              ${selectedZoomId === kf.id ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:bg-bg-tertiary'}`}
          >
            <ZoomIn size={12} />
            <span>{kf.scale.toFixed(1)}x zoom</span>
            <span className="text-text-muted ml-auto">{kf.time.toFixed(1)}s</span>
          </button>
        ))}
      </div>

      {/* Selected keyframe properties */}
      {selectedZoom && (
        <div className="space-y-3 pt-3 border-t border-border">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary font-medium">Keyframe Properties</span>
            <button
              onClick={() => deleteZoom(selectedZoom.id)}
              className="text-red-400 hover:text-red-300 transition-colors"
              title="Delete keyframe"
            >
              <Trash2 size={13} />
            </button>
          </div>

          {/* Time */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="label mb-0">Start Time</span>
              <span className="text-xs text-text-secondary">{selectedZoom.time.toFixed(2)}s</span>
            </div>
            <input
              type="range"
              min={0}
              max={project.duration}
              step={0.1}
              value={selectedZoom.time}
              onChange={(e) => updateZoom(selectedZoom.id, { time: parseFloat(e.target.value) })}
              className="w-full accent-accent cursor-pointer"
            />
          </div>

          {/* Duration */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="label mb-0">Duration</span>
              <span className="text-xs text-text-secondary">{selectedZoom.duration.toFixed(1)}s</span>
            </div>
            <input
              type="range"
              min={0.5}
              max={10}
              step={0.1}
              value={selectedZoom.duration}
              onChange={(e) => updateZoom(selectedZoom.id, { duration: parseFloat(e.target.value) })}
              className="w-full accent-accent cursor-pointer"
            />
          </div>

          {/* Scale */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="label mb-0">Scale</span>
              <span className="text-xs text-text-secondary">{selectedZoom.scale.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min={1}
              max={4}
              step={0.1}
              value={selectedZoom.scale}
              onChange={(e) => updateZoom(selectedZoom.id, { scale: parseFloat(e.target.value) })}
              className="w-full accent-accent cursor-pointer"
            />
          </div>

          {/* Position X */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="label mb-0">Center X</span>
                <span className="text-xs text-text-secondary">{Math.round(selectedZoom.x * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={selectedZoom.x}
                onChange={(e) => updateZoom(selectedZoom.id, { x: parseFloat(e.target.value) })}
                className="w-full accent-accent cursor-pointer"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="label mb-0">Center Y</span>
                <span className="text-xs text-text-secondary">{Math.round(selectedZoom.y * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={selectedZoom.y}
                onChange={(e) => updateZoom(selectedZoom.id, { y: parseFloat(e.target.value) })}
                className="w-full accent-accent cursor-pointer"
              />
            </div>
          </div>

          {/* Easing */}
          <div className="space-y-1">
            <span className="label">Easing</span>
            <select
              value={selectedZoom.easing}
              onChange={(e) => updateZoom(selectedZoom.id, { easing: e.target.value as ZoomKeyframe['easing'] })}
              className="input-field text-sm"
            >
              <option value="ease-in-out">Ease In-Out (default)</option>
              <option value="ease-in">Ease In</option>
              <option value="ease-out">Ease Out</option>
              <option value="linear">Linear</option>
            </select>
          </div>

          {/* Motion Blur */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-primary">Motion Blur</span>
            <button
              onClick={() => updateZoom(selectedZoom.id, { motionBlur: !selectedZoom.motionBlur })}
              className={`w-10 h-6 rounded-full transition-colors duration-200 relative
                ${selectedZoom.motionBlur ? 'bg-accent' : 'bg-border'}`}
            >
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200
                ${selectedZoom.motionBlur ? 'translate-x-5' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
