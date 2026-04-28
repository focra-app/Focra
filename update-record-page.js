const fs = require('fs');

let content = fs.readFileSync('src/renderer/pages/RecordPage.tsx', 'utf-8');

// 1. Remove the "Video Settings" panel entirely since we capture at native resolution now
content = content.replace(/<div className="panel p-3\.5 space-y-3">[\s\S]*?<p className="label flex items-center gap-2"><Video size={14} \/> Video Settings<\/p>[\s\S]*?<\/div>\s*<\/div>\s*<div className="panel p-3\.5 space-y-3">/, '<div className="panel p-3.5 space-y-3">');

// Also remove `recordingResolution` state and map
content = content.replace(/const \[recordingResolution, setRecordingResolution\] = useState.*?;\n/, '');
content = content.replace(/const resolutionMap: Record<string, \{ width: number; height: number \}> = \{[\s\S]*?\n  }\n/, '');

// Fix startPreview to capture native
content = content.replace(/let targetWidth = captureBounds\.width[\s\S]*?const clampedHeight = Math\.max\(MIN_CAPTURE_HEIGHT, Math\.min\(MAX_CAPTURE_HEIGHT, targetHeight\)\)/, 
`const clampedWidth = captureBounds.width; const clampedHeight = captureBounds.height;`);

content = content.replace(/maxWidth: clampedWidth,\s*maxHeight: clampedHeight,\s*maxFrameRate: TARGET_FRAME_RATE/, '');
content = content.replace(/chromeMediaSourceId: selectedSource\.id,/, `chromeMediaSourceId: selectedSource.id,\n            },\n            frameRate: { ideal: 30, max: 60 }`);

// Fix startRecording
content = content.replace(/let targetWidth = captureBounds\.width[\s\S]*?const clampedHeight = Math\.max\(MIN_CAPTURE_HEIGHT, Math\.min\(MAX_CAPTURE_HEIGHT, targetHeight\)\)/, 
`const clampedWidth = captureBounds.width; const clampedHeight = captureBounds.height;`);

content = content.replace(/maxWidth: clampedWidth,\s*maxHeight: clampedHeight,\s*maxFrameRate: TARGET_FRAME_RATE/, '');

// Audio Context mixing
content = content.replace(/const sysGain = audioContext\.createGain\(\)[\s\S]*?systemGainRef\.current = sysGain/, 'sysSource.connect(dest)');
content = content.replace(/const micGain = audioContext\.createGain\(\)[\s\S]*?micGainRef\.current = micGain/, 'micSource.connect(dest)');

// Remove gain refs
content = content.replace(/const micGainRef = useRef<GainNode \| null>\(null\)\n  const systemGainRef = useRef<GainNode \| null>\(null\)\n/, '');
content = content.replace(/micGainRef\.current = null\n      systemGainRef\.current = null\n/, '');

// Update Toggles
content = content.replace(/onToggle=\{\(\) => setMicEnabled\(\(prev\) => !prev\)\}/, `onToggle={() => {
                  if (mediaRecorderRef.current && (mediaRecorderRef.current.state === 'recording' || mediaRecorderRef.current.state === 'paused')) {
                    if (micAudioTrackRef.current) {
                      micAudioTrackRef.current.enabled = !micAudioTrackRef.current.enabled;
                      setMicEnabled(micAudioTrackRef.current.enabled);
                    }
                  } else {
                    setMicEnabled(prev => !prev);
                  }
                }}`);

content = content.replace(/onToggle=\{\(\) => setSystemAudioEnabled\(\(prev\) => !prev\)\}/, `onToggle={() => {
                  if (mediaRecorderRef.current && (mediaRecorderRef.current.state === 'recording' || mediaRecorderRef.current.state === 'paused')) {
                    if (systemAudioTrackRef.current) {
                      systemAudioTrackRef.current.enabled = !systemAudioTrackRef.current.enabled;
                      setSystemAudioEnabled(systemAudioTrackRef.current.enabled);
                    }
                  } else {
                    setSystemAudioEnabled(prev => !prev);
                  }
                }}`);

// Pass original resolution
content = content.replace(/onRecordingComplete\(\{ videoUrl, videoBlob: blob, duration, zoomKeyframes \}\)/, 'onRecordingComplete({ videoUrl, videoBlob: blob, duration, zoomKeyframes, captureWidth: clampedWidth, captureHeight: clampedHeight })');

fs.writeFileSync('src/renderer/pages/RecordPage.tsx', content);
