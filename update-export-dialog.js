const fs = require('fs');

let content = fs.readFileSync('src/renderer/components/editor/ExportDialog.tsx', 'utf-8');

// Add imports
if (!content.includes('@ffmpeg/ffmpeg')) {
  content = "import { FFmpeg } from '@ffmpeg/ffmpeg'\nimport { fetchFile } from '@ffmpeg/util'\n" + content;
}

// Modify handleExport download flow
const oldSave = `      const mimeType = filteredOption.mimeTypes[0] || 'video/webm'
      const blob = new Blob([exportedBuffer], { type: mimeType })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.style.display = 'none'
      a.href = url
      a.download = \`focra-export.\${filteredOption.extension}\`
      document.body.appendChild(a)
      a.click()
      
      // Cleanup
      setTimeout(() => {
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }, 100)

      setDone(true)`;

const newSave = `      const mimeType = filteredOption.mimeTypes[0] || 'video/webm'
      let finalBlob = new Blob([exportedBuffer], { type: mimeType })
      let finalExtension = filteredOption.extension

      if (filteredOption.value === 'mp4' && mimeType.includes('webm')) {
        setExportDetail('Remuxing WebM to MP4... This may take a moment.')
        try {
          const ffmpeg = new FFmpeg()
          // For electron environment, basic load() might require specifying core URLs, 
          // but we'll try the default.
          await ffmpeg.load()
          await ffmpeg.writeFile('input.webm', await fetchFile(finalBlob))
          await ffmpeg.exec(['-i', 'input.webm', '-c', 'copy', 'output.mp4'])
          const data = await ffmpeg.readFile('output.mp4')
          finalBlob = new Blob([data], { type: 'video/mp4' })
          finalExtension = 'mp4'
        } catch (e) {
          console.error('MP4 Remux failed, saving as WebM fallback.', e)
          setExportDetail('MP4 conversion failed, falling back to WebM.')
          finalExtension = 'webm'
        }
      }

      const url = URL.createObjectURL(finalBlob)
      const a = document.createElement('a')
      a.style.display = 'none'
      a.href = url
      a.download = \`focra-export.\${finalExtension}\`
      document.body.appendChild(a)
      a.click()
      
      // Cleanup
      setTimeout(() => {
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }, 100)

      setDone(true)`;

content = content.replace(oldSave, newSave);
fs.writeFileSync('src/renderer/components/editor/ExportDialog.tsx', content);
