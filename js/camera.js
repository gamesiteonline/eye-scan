/**
 * camera.js – stream & MediaPipe setup
 * Handles front camera at 720p+, loads FaceLandmarker via CDN, runs at ~30fps
 */

export class CameraManager {
  constructor(videoEl) {
    this.video = videoEl;
    this.stream = null;
    this.faceLandmarker = null;
    this.lastVideoTime = -1;
    this.isReady = false;
    this.onResults = null;
    this.running = false;
    this.rafId = null;
    this.fpsThrottle = 0;
  }

  async init() {
    console.log('[CAMERA] init start');
    try {
      await this._initCamera();
      await this._initMediaPipe();
      this.isReady = true;
      console.log('[CAMERA] ready');
      return true;
    } catch (e) {
      console.error('[CAMERA] init failed', e);
      throw e;
    }
  }

  async _initCamera() {
    const constraints = {
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 1280, min: 640 },
        height: { ideal: 720, min: 480 },
        frameRate: { ideal: 30, max: 60 }
      }
    };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      console.warn('[CAMERA] ideal constraints failed, trying fallback', e);
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    }
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', 'true');
    await this.video.play();
    await new Promise(res => {
      if (this.video.readyState >= 2) return res();
      this.video.onloadeddata = () => res();
      setTimeout(res, 2000);
    });
    console.log(`[CAMERA] stream ${this.video.videoWidth}x${this.video.videoHeight}`);
  }

  async _initMediaPipe() {
    const { FilesetResolver, FaceLandmarker } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
    const wasmPath = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
    console.log('[CAMERA] loading wasm from', wasmPath);
    const fileset = await FilesetResolver.forVisionTasks(wasmPath);

    const modelUrl = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
    console.log('[CAMERA] loading model', modelUrl);

    let delegate = 'GPU';
    try {
      this.faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelUrl, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: true
      });
    } catch (e) {
      console.warn('[CAMERA] GPU delegate failed, fallback CPU', e);
      this.faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelUrl, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFacialTransformationMatrixes: true
      });
    }
    console.log('[CAMERA] FaceLandmarker created');
  }

  startLoop(callback) {
    this.onResults = callback;
    this.running = true;
    const loop = (now) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(loop);
      // throttle to ~33ms (30fps)
      this.fpsThrottle += 16.66;
      if (this.fpsThrottle < 30) return;
      this.fpsThrottle = 0;
      this._processFrame(now);
    };
    loop(performance.now());
  }

  stopLoop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  _processFrame(now) {
    if (!this.faceLandmarker || !this.video || this.video.readyState < 2) return;
    const videoTime = this.video.currentTime;
    if (videoTime === this.lastVideoTime) return;
    this.lastVideoTime = videoTime;
    try {
      const results = this.faceLandmarker.detectForVideo(this.video, now);
      if (this.onResults) this.onResults(results, { width: this.video.videoWidth, height: this.video.videoHeight, time: now });
    } catch (e) {
      console.warn('[CAMERA] detect error', e);
    }
  }

  getVideoElement() { return this.video; }

  destroy() {
    this.stopLoop();
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.faceLandmarker) {
      try { this.faceLandmarker.close(); } catch {}
      this.faceLandmarker = null;
    }
  }
}
