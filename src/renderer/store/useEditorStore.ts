import { create } from 'zustand'
import type {
  EditorProject,
  ZoomKeyframe,
  Annotation,
  TrimPoints,
  Background,
  CropSettings,
  ExportSettings,
  Tool
} from '../types'

interface EditorState {
  project: EditorProject | null
  currentTime: number
  selectedTool: Tool
  selectedAnnotationId: string | null
  selectedZoomId: string | null
  isPlaying: boolean
}

interface EditorActions {
  loadProject: (project: EditorProject) => void
  setCurrentTime: (time: number) => void
  setIsPlaying: (playing: boolean) => void
  setSelectedTool: (tool: Tool) => void
  selectAnnotation: (id: string | null) => void
  selectZoom: (id: string | null) => void

  // Zoom keyframe actions
  addZoom: (kf: ZoomKeyframe) => void
  updateZoom: (id: string, updates: Partial<ZoomKeyframe>) => void
  deleteZoom: (id: string) => void

  // Annotation actions
  addAnnotation: (annotation: Annotation) => void
  updateAnnotation: (id: string, updates: Partial<Annotation>) => void
  deleteAnnotation: (id: string) => void

  // Project settings
  setTrimPoints: (trimPoints: TrimPoints) => void
  setBackground: (background: Background) => void
  setCrop: (crop: CropSettings | null) => void
  setExportSettings: (settings: ExportSettings) => void
}

export const useEditorStore = create<EditorState & EditorActions>((set) => ({
  project: null,
  currentTime: 0,
  selectedTool: 'select',
  selectedAnnotationId: null,
  selectedZoomId: null,
  isPlaying: false,

  loadProject: (project) => set({ project, currentTime: 0 }),

  setCurrentTime: (time) => set({ currentTime: time }),

  setIsPlaying: (playing) => set({ isPlaying: playing }),

  setSelectedTool: (tool) =>
    set({ selectedTool: tool, selectedAnnotationId: null, selectedZoomId: null }),

  selectAnnotation: (id) => set({ selectedAnnotationId: id, selectedZoomId: null }),

  selectZoom: (id) => set({ selectedZoomId: id, selectedAnnotationId: null }),

  addZoom: (kf) =>
    set((state) => {
      if (!state.project) return state
      return {
        project: {
          ...state.project,
          zoomKeyframes: [...state.project.zoomKeyframes, kf]
        },
        selectedZoomId: kf.id
      }
    }),

  updateZoom: (id, updates) =>
    set((state) => {
      if (!state.project) return state
      return {
        project: {
          ...state.project,
          zoomKeyframes: state.project.zoomKeyframes.map((kf) =>
            kf.id === id ? { ...kf, ...updates } : kf
          )
        }
      }
    }),

  deleteZoom: (id) =>
    set((state) => {
      if (!state.project) return state
      return {
        project: {
          ...state.project,
          zoomKeyframes: state.project.zoomKeyframes.filter((kf) => kf.id !== id)
        },
        selectedZoomId: null
      }
    }),

  addAnnotation: (annotation) =>
    set((state) => {
      if (!state.project) return state
      return {
        project: {
          ...state.project,
          annotations: [...state.project.annotations, annotation]
        },
        selectedAnnotationId: annotation.id
      }
    }),

  updateAnnotation: (id, updates) =>
    set((state) => {
      if (!state.project) return state
      return {
        project: {
          ...state.project,
          annotations: state.project.annotations.map((a) =>
            a.id === id ? { ...a, ...updates } : a
          )
        }
      }
    }),

  deleteAnnotation: (id) =>
    set((state) => {
      if (!state.project) return state
      return {
        project: {
          ...state.project,
          annotations: state.project.annotations.filter((a) => a.id !== id)
        },
        selectedAnnotationId: null
      }
    }),

  setTrimPoints: (trimPoints) =>
    set((state) => {
      if (!state.project) return state
      return { project: { ...state.project, trimPoints } }
    }),

  setBackground: (background) =>
    set((state) => {
      if (!state.project) return state
      return { project: { ...state.project, background } }
    }),

  setCrop: (cropSettings) =>
    set((state) => {
      if (!state.project) return state
      return { project: { ...state.project, cropSettings } }
    }),

  setExportSettings: (exportSettings) =>
    set((state) => {
      if (!state.project) return state
      return { project: { ...state.project, exportSettings } }
    })
}))
