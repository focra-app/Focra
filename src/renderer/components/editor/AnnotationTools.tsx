import { Type, ArrowRight, Trash2 } from 'lucide-react'
import { useEditorStore } from '../../store/useEditorStore'

const PRESET_COLORS = ['#ffffff', '#000000', '#ff4444', '#44ff44', '#4488ff', '#ffaa00', '#ff44ff', '#44ffff']

export default function AnnotationTools() {
  const {
    project,
    selectedTool,
    selectedAnnotationId,
    setSelectedTool,
    updateAnnotation,
    deleteAnnotation
  } = useEditorStore()

  if (!project) return null

  const selected = project.annotations.find((a) => a.id === selectedAnnotationId)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Type size={15} className="text-accent" />
        <span className="text-sm font-semibold text-text-primary">Annotations</span>
      </div>

      {/* Tool buttons */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setSelectedTool(selectedTool === 'text' ? 'select' : 'text')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors
            ${selectedTool === 'text' ? 'bg-accent text-white' : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'}`}
        >
          <Type size={13} />
          Text
        </button>
        <button
          onClick={() => setSelectedTool(selectedTool === 'arrow' ? 'select' : 'arrow')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors
            ${selectedTool === 'arrow' ? 'bg-accent text-white' : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'}`}
        >
          <ArrowRight size={13} />
          Arrow
        </button>
      </div>

      {selectedTool === 'text' && (
        <p className="text-xs text-text-muted bg-bg-tertiary rounded-lg p-2">
          Click on the preview to place text
        </p>
      )}

      {/* Annotation list */}
      <div className="space-y-1 max-h-24 overflow-y-auto">
        {project.annotations.length === 0 && (
          <p className="text-xs text-text-muted text-center py-2">No annotations yet</p>
        )}
        {project.annotations.map((ann) => (
          <div
            key={ann.id}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer transition-colors
              ${selectedAnnotationId === ann.id ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:bg-bg-tertiary'}`}
            onClick={() => useEditorStore.getState().selectAnnotation(ann.id)}
          >
            {ann.type === 'text' ? <Type size={11} /> : <ArrowRight size={11} />}
            <span className="truncate">{ann.type === 'text' ? (ann.text || 'Text') : 'Arrow'}</span>
            <span className="text-text-muted ml-auto">{ann.time.toFixed(1)}s</span>
          </div>
        ))}
      </div>

      {/* Selected annotation properties */}
      {selected && (
        <div className="space-y-3 pt-3 border-t border-border">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary font-medium">Properties</span>
            <button
              onClick={() => deleteAnnotation(selected.id)}
              className="text-red-400 hover:text-red-300 transition-colors"
            >
              <Trash2 size={13} />
            </button>
          </div>

          {selected.type === 'text' && (
            <>
              <div className="space-y-1">
                <span className="label">Text Content</span>
                <input
                  type="text"
                  value={selected.text || ''}
                  onChange={(e) => updateAnnotation(selected.id, { text: e.target.value })}
                  className="input-field text-sm"
                  placeholder="Enter text..."
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="label mb-0">Font Size</span>
                  <span className="text-xs text-text-secondary">{selected.fontSize || 24}px</span>
                </div>
                <input
                  type="range"
                  min={12}
                  max={72}
                  value={selected.fontSize || 24}
                  onChange={(e) => updateAnnotation(selected.id, { fontSize: parseInt(e.target.value) })}
                  className="w-full accent-accent cursor-pointer"
                />
              </div>
            </>
          )}

          {selected.type === 'arrow' && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="label mb-0">Stroke Width</span>
                <span className="text-xs text-text-secondary">{selected.strokeWidth || 3}px</span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                value={selected.strokeWidth || 3}
                onChange={(e) => updateAnnotation(selected.id, { strokeWidth: parseInt(e.target.value) })}
                className="w-full accent-accent cursor-pointer"
              />
            </div>
          )}

          {/* Timing */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <span className="label">Start (s)</span>
              <input
                type="number"
                min={0}
                step={0.1}
                value={selected.time.toFixed(1)}
                onChange={(e) => updateAnnotation(selected.id, { time: parseFloat(e.target.value) })}
                className="input-field text-sm"
              />
            </div>
            <div className="space-y-1">
              <span className="label">Duration (s)</span>
              <input
                type="number"
                min={0.1}
                step={0.1}
                value={selected.duration.toFixed(1)}
                onChange={(e) => updateAnnotation(selected.id, { duration: parseFloat(e.target.value) })}
                className="input-field text-sm"
              />
            </div>
          </div>

          {/* Color */}
          <div className="space-y-2">
            <span className="label">Color</span>
            <div className="flex items-center gap-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110
                    ${selected.color === c ? 'border-white scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                  onClick={() => updateAnnotation(selected.id, { color: c })}
                />
              ))}
              <input
                type="color"
                value={selected.color}
                onChange={(e) => updateAnnotation(selected.id, { color: e.target.value })}
                className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                title="Custom color"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
