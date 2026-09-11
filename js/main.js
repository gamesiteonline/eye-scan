/**
 * main.js – orchestration and state machine
 * States: IDLE, PERMISSION_REQUEST, LOADING_MODEL, MONITORING, ACQUIRING, SCANNING, LOCKING, GRANTED, ERROR
 */

import { CameraManager } from './camera.js';
import { EyeTracker } from './tracker.js';
import { HUDRenderer } from './hud.js';

const $ = (s) => document.querySelector(s);

const STATES = {
  IDLE: 'IDLE',
  LOADING: 'LOADING_MODEL',
  MONITORING: 'MONITORING',
  ACQUIRING: 'ACQUIRING',
  SCANNING: 'SCANNING',
  LOCKING: 'LOCKING',
  GRANTED: 'GRANTED',
  ERROR: 'ERROR'
};

class CyberEyeApp {
  constructor() {
    this.state = STATES.IDLE;
    this.camera = null;
    this.tracker = new EyeTracker();
    this.hud = null;
    this.lastFrameTime = performance.now();
    this.scanStart = 0;
    this.progress = 0;
    this.stagedProgress = [20,32,61,100];
    this.stageIdx = 0;
    this.lookHoldStart = 0;
    this.faceLostSince = 0;
    this.grantedTimeout = null;

    this.ui = {
      video: $('#cam'),
      bgCanvas: $('#bg-canvas'),
      hudCanvas: $('#hud-canvas'),
      pCanvas: $('#particle-canvas'),
      startScreen: $('#start-screen'),
      loader: $('#loader'),
      errorOverlay: $('#error-overlay'),
      errorTitle: $('#error-title'),
      errorMsg: $('#error-msg'),
      btnStart: $('#btn-start'),
      btnRetry: $('#btn-retry'),
      btnRetry2: $('#btn-retry2'),
      panelLeft: $('#panel-left'),
      panelRight: $('#panel-right'),
      hexLeft: $('#hex-left'),
      hexRight: $('#hex-right'),
      metaLeft: $('#meta-left'),
      metaRight: $('#meta-right'),
      leftWave: $('#wave-left'),
      rightWave: $('#wave-right'),
      progressNum: $('#progress-num'),
      progressFill: $('#progress-fill'),
      progressLabel: $('#progress-label'),
      centerReticle: $('#center-reticle'),
      topStatus: $('#top-status'),
      eyeLeft: $('#eye-left'),
      eyeRight: $('#eye-right'),
      accessGranted: $('#access-granted'),
      flash: $('#flash')
    };

    this._bindEvents();
  }

  _bindEvents() {
    this.ui.btnStart.addEventListener('click', () => this.start());
    this.ui.btnRetry.addEventListener('click', () => this.start());
    this.ui.btnRetry2.addEventListener('click', () => this.start());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.reset();
    });
    // click anywhere on start screen already handled, but allow tap on whole app to reset when granted
    this.ui.accessGranted.addEventListener('click', () => {
      if (this.state === STATES.GRANTED) this.resetToMonitoring();
    });
  }

  async start() {
    if (this.state === STATES.LOADING) return;
    this._setState(STATES.LOADING);
    this.ui.startScreen.classList.add('hidden');
    this.ui.loader.classList.add('show');
    this.ui.errorOverlay.classList.remove('show');

    try {
      this.camera = new CameraManager(this.ui.video);
      await this.camera.init();

      this.hud = new HUDRenderer({
        bgCanvas: this.ui.bgCanvas,
        hudCanvas: this.ui.hudCanvas,
        particleCanvas: this.ui.pCanvas,
        video: this.ui.video,
        ui: {
          panelLeft: this.ui.panelLeft,
          panelRight: this.ui.panelRight,
          hexLeft: this.ui.hexLeft,
          hexRight: this.ui.hexRight,
          metaLeft: this.ui.metaLeft,
          metaRight: this.ui.metaRight,
          leftWave: this.ui.leftWave,
          rightWave: this.ui.rightWave,
          progressNum: this.ui.progressNum,
          progressFill: this.ui.progressFill,
          progressLabel: this.ui.progressLabel,
          centerReticle: this.ui.centerReticle,
          topStatus: this.ui.topStatus,
          eyeLeft: this.ui.eyeLeft,
          eyeRight: this.ui.eyeRight
        }
      });

      this.camera.startLoop((results, info) => this._onFaceResults(results, info));
      this.ui.video.classList.add('focused');
      this.ui.loader.classList.remove('show');
      this._setState(STATES.MONITORING);
      this._loop();
      console.log('[MAIN] started monitoring');
    } catch (e) {
      console.error('[MAIN] start failed', e);
      this.ui.loader.classList.remove('show');
      this._showError(e);
    }
  }

  _onFaceResults(results, info) {
    const data = this.tracker.process(results, info);
    if (!this.hud) return;
    this.hud.setEyeData(data, (pt, vp) => this.tracker.toScreen(pt, vp));

    // state transitions based on tracking
    if (this.state === STATES.MONITORING) {
      if (data.hasFace && data.confidence > 0.45) {
        this._setState(STATES.ACQUIRING);
        this.lookHoldStart = performance.now();
      }
    } else if (this.state === STATES.ACQUIRING) {
      if (!data.hasFace) {
        if (performance.now() - this.faceLostSince > 800) this._setState(STATES.MONITORING);
      } else {
        this.faceLostSince = performance.now();
        if (data.lookingAtCamera && data.confidence >= 0.62) {
          if (performance.now() - this.lookHoldStart > 320) {
            this._startScanning();
          }
        } else {
          this.lookHoldStart = performance.now();
          if (data.confidence < 0.35) this._setState(STATES.MONITORING);
        }
      }
    } else if (this.state === STATES.SCANNING) {
      if (!data.hasFace || !data.lookingAtCamera) {
        // allow brief loss
        if (performance.now() - this.faceLostSince > 650) {
          console.log('[MAIN] face lost during scan, abort');
          this._abortScan();
        }
      } else {
        this.faceLostSince = performance.now();
      }
    }
    // store last data for HUD DOM
    this.lastTrackerData = data;
  }

  _startScanning() {
    console.log('[MAIN] start scanning');
    this._setState(STATES.SCANNING);
    this.scanStart = performance.now();
    this.progress = 0;
    this.stageIdx = 0;
    this.hud.setProgress(0);
    this.faceLostSince = performance.now();
  }

  _abortScan() {
    this._setState(STATES.MONITORING);
    this.progress = 0;
    this.hud.setProgress(0);
  }

  _loop() {
    const step = (now) => {
      const dt = now - this.lastFrameTime;
      this.lastFrameTime = now;

      if (this.hud) {
        this.hud.update(dt, this.state);

        if (this.state === STATES.SCANNING) {
          const elapsed = now - this.scanStart;
          const totalDuration = 4600; // 4.6s total
          let t = elapsed / totalDuration; // 0..1
          if (t >= 1) t = 1;

          // staged easing: hold at 20,32,61 then jump to 100
          let target;
          if (t < 0.22) target = this._ease(t/0.22)*20;
          else if (t < 0.38) target = 20 + this._ease((t-0.22)/0.16)*(12);
          else if (t < 0.68) target = 32 + this._ease((t-0.38)/0.30)*(29);
          else target = 61 + this._ease((t-0.68)/0.32)*39;

          // add micro jitter
          target += Math.sin(now*0.02)*0.3;

          this.progress = target;
          this.hud.setProgress(this.progress);

          if (t >= 1) {
            this._triggerLock();
          }
        }

        this.hud.render(this.state);
        this.hud.updateDOM(this.ui, this.state, this.lastTrackerData);
      }

      if (this.state !== STATES.IDLE && this.state !== STATES.ERROR) {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  }

  _ease(x) { // cubic in-out
    return x < 0.5 ? 4*x*x*x : 1 - Math.pow(-2*x+2,3)/2;
  }

  _triggerLock() {
    if (this.state !== STATES.SCANNING) return;
    console.log('[MAIN] lock');
    this._setState(STATES.LOCKING);
    this.hud.setProgress(100);
    this.ui.video.classList.add('zoomed');
    this.ui.flash.classList.add('show');
    setTimeout(()=> this.ui.flash.classList.remove('show'), 180);
    const center = this.hud.eyeData ? this.hud.eyeData.faceCenter : { x: window.innerWidth/2, y: window.innerHeight/2 };
    this.hud.triggerExplosion(center);

    setTimeout(() => {
      this.ui.accessGranted.classList.add('show');
      this._setState(STATES.GRANTED);
      this.grantedTimeout = setTimeout(() => this.resetToMonitoring(), 3200);
    }, 320);
  }

  resetToMonitoring() {
    this.ui.accessGranted.classList.remove('show');
    this.ui.video.classList.remove('zoomed');
    this.progress = 0;
    if (this.hud) this.hud.setProgress(0);
    this.tracker.reset();
    this._setState(STATES.MONITORING);
  }

  reset() {
    console.log('[MAIN] reset');
    if (this.grantedTimeout) clearTimeout(this.grantedTimeout);
    this.ui.accessGranted.classList.remove('show');
    this.ui.flash.classList.remove('show');
    this.ui.video.classList.remove('zoomed');
    this.ui.video.classList.add('focused');
    this.progress = 0;
    if (this.hud) this.hud.setProgress(0);
    this.tracker.reset();
    if (this.state === STATES.GRANTED || this.state === STATES.SCANNING || this.state === STATES.LOCKING) {
      this._setState(STATES.MONITORING);
    } else if (this.state === STATES.ERROR || this.state === STATES.IDLE) {
      // do nothing
    } else {
      this._setState(STATES.MONITORING);
    }
  }

  _setState(s) {
    console.log(`[STATE] ${this.state} -> ${s}`);
    this.state = s;
  }

  _showError(e) {
    this._setState(STATES.ERROR);
    let title = 'CAMERA ERROR';
    let msg = e.message || String(e);
    if (msg.includes('Permission') || msg.includes('NotAllowed')) {
      title = 'PERMISSION DENIED';
      msg = 'Camera access was blocked. Please allow camera permission in your browser settings and reload. On iOS Safari, tap the AA icon → Website Settings → Allow Camera.';
    } else if (msg.includes('NotFound') || msg.includes('no camera')) {
      title = 'NO CAMERA FOUND';
      msg = 'No front-facing camera detected. Please connect a webcam or try on a device with a camera.';
    } else if (msg.toLowerCase().includes('mediapipe') || msg.toLowerCase().includes('wasm') || msg.toLowerCase().includes('model')) {
      title = 'MODEL LOAD FAILED';
      msg = 'Failed to load the face tracking model. Check your internet connection and reload. If you are offline, the model requires online CDN access on first load.';
    }
    this.ui.errorTitle.textContent = title;
    this.ui.errorMsg.textContent = msg;
    this.ui.errorOverlay.classList.add('show');
  }
}

// boot
window.addEventListener('DOMContentLoaded', () => {
  const app = new CyberEyeApp();
  window.CyberEyeApp = app;
  // PWA install prompt handling optional
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('[PWA] SW failed', err));
  }
});
