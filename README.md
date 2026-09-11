# CyberEye HUD – Reactive Biometric Scan Interface

High-fidelity, real-time cyberpunk eye-scan and HUD overlay that activates only when a human looks toward the camera. Built to feel like a Blade Runner / Cyberpunk 2077 biometric authentication trailer.

## Features
- **Continuous Monitoring**: Front camera 720p+, MediaPipe FaceLandmarker 478 landmarks + iris at 30fps, confidence ≥0.62 and gaze-centered detection
- **Cinematic Scan (0–5s)**: Real eye tracking, cyan iris glow + specular highlights, holographic corner frames anchored to eyes, traveling energy line between eyes, orbiting particles, per-eye scan-line, hex data streams, waveform graphs, glitch progress 0→100 staged (20→32→61→100)
- **Lock Sequence**: Particle explosion, flash, zoom, ACCESS GRANTED collapse, auto-reset
- **UX**: Permission handling, low-light/far warnings, mobile adaptive (48 vs 110 particles), fullscreen immersive, ESC to reset, PWA installable, 100% client-side

## Tech
- ES2022 modules, no build step
- `@mediapipe/tasks-vision` via CDN (FaceLandmarker)
- Canvas 2D for background, HUD, particles + DOM for panels
- CSS: custom cyberpunk palette #00F0FF / #FF0055 / #050510 / #1A0033 / #330011
- Fonts: Orbitron + Share Tech Mono

## File Structure
```
index.html
css/style.css
js/
  camera.js – getUserMedia + MediaPipe loader + 30fps loop
  tracker.js – eye openness, iris ratio, orientation, confidence, smoothing
  hud.js – background gradients, eye glows, frames, scanlines, particles, waveforms, DOM sync
  main.js – state machine: IDLE→LOADING→MONITORING→ACQUIRING→SCANNING→LOCKING→GRANTED
manifest.json
sw.js
```

## How to Run

### 1. Local (no build)
Because MediaPipe loads WASM via CDN, you need a local http server (not file://).

```bash
# Python
python3 -m http.server 8000
# or Node
npx serve .
```
Open http://localhost:8000 – click INITIATE SCAN SEQUENCE, allow camera.

### 2. Phone testing (same Wi-Fi)
```bash
# Find your IP
ifconfig | grep inet
# Run server bound to 0.0.0.0
python3 -m http.server 8000 --bind 0.0.0.0
```
On phone, open http://YOUR_PC_IP:8000 (e.g., http://192.168.1.23:8000). Must be same Wi-Fi. iOS requires HTTPS for camera? Safari allows http on local network if you allow, but best deploy to Netlify/Vercel for https.

### Deploy to Netlify/Vercel
- Drag folder to Netlify Drop, or `vercel --prod`
- Ensure `manifest.json` and `sw.js` are at root.

### 3. Permissions notes
- Browser will prompt for camera. Choose Allow.
- If denied: click lock icon in address bar → Site settings → Camera Allow → Reload.
- iOS Safari: AA icon → Website Settings → Camera Allow. Needs HTTPS when not localhost.
- No data leaves device; all inference in browser via WebAssembly.

### 4. Recommended usage
- Lighting: soft frontal light, avoid strong backlight.
- Distance: 30–60 cm, face centered, eyes clearly visible, no sunglasses.
- Look directly at camera lens, keep head relatively still for 0.3s to trigger.
- If tracking jitters: reduce background apps, close other camera tabs.
- ESC resets anytime. Tap ACCESS GRANTED to rescan.

## Expected Behavior (Verification)
1. Start screen with CYBEREYE logo, description, INITIATE button.
2. Loader spinner while model downloads (~5 MB).
3. MONITORING: subtle center reticle, top status STANDBY, video slightly blurred.
4. When face enters: ACQUIRING – crosshair snaps to face center, panels slide in.
5. Look at lens: SCANNING – eye frames glow, iris rings rotate, scan line sweeps each eye, particles orbit and connect, hex scrolls, waveforms animate, bottom progress counts 0→20→32→61→100 with glitch shadow.
6. At 100%: flash + explosion outward from face, video zooms 1.18x, ACCESS GRANTED appears.
7. After 3.2s auto-resets to MONITORING.

## Performance
- Mobile: particle density halved, DPR capped to 2, canvas cleared efficiently.
- If fps <20, reduce to 30 particles automatically (check `isMobile`).
- Model runs GPU delegate, falls back to CPU.

## License
MIT – use freely, keep credit.
