/**
 * tracker.js – face/eye landmark processing
 * Computes eye centers, openness, gaze, confidence, looking-at-camera
 */

const LEFT_EYE = { outer: 33, inner: 133, top: 159, bottom: 145, top2: 158, bottom2: 153 };
const RIGHT_EYE = { outer: 362, inner: 263, top: 386, bottom: 374, top2: 385, bottom2: 380 };
const LEFT_IRIS = 468;
const RIGHT_IRIS = 473;
const NOSE_TIP = 1;

function dist(a,b){ const dx=a.x-b.x, dy=a.y-b.y; return Math.hypot(dx,dy); }

export class EyeTracker {
  constructor() {
    this.smoothed = null;
    this.alpha = 0.35; // EMA
    this.history = [];
    this.lastConfidence = 0;
    this.faceLostTime = 0;
  }

  process(results, videoInfo) {
    if (!results || !results.faceLandmarks || results.faceLandmarks.length === 0) {
      return { hasFace: false, confidence: 0, lookingAtCamera: false, eyes: null, raw: null };
    }
    const landmarks = results.faceLandmarks[0];
    const matrix = results.facialTransformationMatrixes?.[0];
    const data = this._extract(landmarks, matrix, videoInfo);
    const smoothed = this._smooth(data);
    const confidence = this._computeConfidence(smoothed, landmarks);
    const looking = this._isLookingAtCamera(smoothed, confidence, landmarks);
    // hysteresis
    this.history.push({ confidence, looking, t: performance.now() });
    if (this.history.length > 12) this.history.shift();
    const avgConf = this.history.reduce((s,v)=>s+v.confidence,0)/this.history.length;
    const lookRatio = this.history.filter(v=>v.looking).length / this.history.length;
    const stableLooking = lookRatio > 0.66 && avgConf >= 0.55;

    return {
      hasFace: true,
      confidence: avgConf,
      rawConfidence: confidence,
      lookingAtCamera: stableLooking,
      eyes: smoothed,
      landmarks,
      matrix,
      videoInfo,
      isStable: this.history.length >= 6
    };
  }

  _extract(lm, matrix, videoInfo) {
    const vw = videoInfo.width, vh = videoInfo.height;
    // Helper to get point
    const pt = (i) => lm[i];
    // eye corners
    const lOuter = pt(LEFT_EYE.outer), lInner = pt(LEFT_EYE.inner), lTop = pt(LEFT_EYE.top), lBottom = pt(LEFT_EYE.bottom);
    const rOuter = pt(RIGHT_EYE.outer), rInner = pt(RIGHT_EYE.inner), rTop = pt(RIGHT_EYE.top), rBottom = pt(RIGHT_EYE.bottom);
    const lIris = lm.length > LEFT_IRIS ? pt(LEFT_IRIS) : { x: (lOuter.x+lInner.x)/2, y: (lTop.y+lBottom.y)/2, z: 0 };
    const rIris = lm.length > RIGHT_IRIS ? pt(RIGHT_IRIS) : { x: (rOuter.x+rInner.x)/2, y: (rTop.y+rBottom.y)/2, z: 0 };

    const leftEyeCenter = { x: (lOuter.x + lInner.x)/2, y: (lTop.y + lBottom.y)/2, z: (lOuter.z+lInner.z)/2 };
    const rightEyeCenter = { x: (rOuter.x + rInner.x)/2, y: (rTop.y + rBottom.y)/2, z: (rOuter.z+rInner.z)/2 };

    const leftEyeWidth = dist(lOuter, lInner);
    const rightEyeWidth = dist(rOuter, rInner);
    const leftEyeHeight = (dist(pt(LEFT_EYE.top), pt(LEFT_EYE.bottom)) + dist(pt(LEFT_EYE.top2), pt(LEFT_EYE.bottom2)))/2;
    const rightEyeHeight = (dist(pt(RIGHT_EYE.top), pt(RIGHT_EYE.bottom)) + dist(pt(RIGHT_EYE.top2), pt(RIGHT_EYE.bottom2)))/2;

    const leftOpen = leftEyeHeight / (leftEyeWidth + 1e-6);
    const rightOpen = rightEyeHeight / (rightEyeWidth + 1e-6);

    // iris offset ratio 0..1 within eye
    const leftIrisRatioX = (lIris.x - lOuter.x) / (lInner.x - lOuter.x + 1e-6);
    const leftIrisRatioY = (lIris.y - lTop.y) / (lBottom.y - lTop.y + 1e-6);
    const rightIrisRatioX = (rIris.x - rOuter.x) / (rInner.x - rOuter.x + 1e-6);
    const rightIrisRatioY = (rIris.y - rTop.y) / (rBottom.y - rTop.y + 1e-6);

    const nose = pt(NOSE_TIP);
    const eyeMid = { x: (leftEyeCenter.x + rightEyeCenter.x)/2, y: (leftEyeCenter.y + rightEyeCenter.y)/2 };
    const faceWidth = dist(lOuter, rOuter);

    return {
      left: { center: leftEyeCenter, iris: lIris, corners: { outer:lOuter, inner:lInner, top:lTop, bottom:lBottom }, width:leftEyeWidth, height:leftEyeHeight, openness:leftOpen, irisRatio:{x:leftIrisRatioX, y:leftIrisRatioY} },
      right: { center: rightEyeCenter, iris: rIris, corners: { outer:rOuter, inner:rInner, top:rTop, bottom:rBottom }, width:rightEyeWidth, height:rightEyeHeight, openness:rightOpen, irisRatio:{x:rightIrisRatioX, y:rightIrisRatioY} },
      face: { nose, eyeMid, width: faceWidth, matrix },
      video: videoInfo
    };
  }

  _smooth(data) {
    if (!this.smoothed) { this.smoothed = JSON.parse(JSON.stringify(data)); return this.smoothed; }
    const lerp = (a,b)=> a + (b-a)*this.alpha;
    const sm = this.smoothed;
    const keys = ['left','right'];
    for (const k of keys) {
      sm[k].center.x = lerp(sm[k].center.x, data[k].center.x);
      sm[k].center.y = lerp(sm[k].center.y, data[k].center.y);
      sm[k].iris.x = lerp(sm[k].iris.x, data[k].iris.x);
      sm[k].iris.y = lerp(sm[k].iris.y, data[k].iris.y);
      sm[k].width = lerp(sm[k].width, data[k].width);
      sm[k].height = lerp(sm[k].height, data[k].height);
      sm[k].openness = lerp(sm[k].openness, data[k].openness);
      sm[k].irisRatio.x = lerp(sm[k].irisRatio.x, data[k].irisRatio.x);
      sm[k].irisRatio.y = lerp(sm[k].irisRatio.y, data[k].irisRatio.y);
    }
    sm.face.nose.x = lerp(sm.face.nose.x, data.face.nose.x);
    sm.face.nose.y = lerp(sm.face.nose.y, data.face.nose.y);
    sm.face.eyeMid.x = lerp(sm.face.eyeMid.x, data.face.eyeMid.x);
    sm.face.eyeMid.y = lerp(sm.face.eyeMid.y, data.face.eyeMid.y);
    sm.face.width = lerp(sm.face.width, data.face.width);
    return sm;
  }

  _computeConfidence(s, rawLm) {
    // openness check
    const openScore = Math.min(1, (s.left.openness + s.right.openness)/2 / 0.25);
    // iris centering: ideal ratio ~0.5
    const centerDev = (Math.abs(s.left.irisRatio.x-0.5) + Math.abs(s.right.irisRatio.x-0.5))/2;
    const centerScore = 1 - Math.min(1, centerDev*2.5);
    const vertDev = (Math.abs(s.left.irisRatio.y-0.5) + Math.abs(s.right.irisRatio.y-0.5))/2;
    const vertScore = 1 - Math.min(1, vertDev*2.5);
    // face size (too far = low confidence)
    const sizeScore = Math.min(1, s.face.width / 0.12);
    // face orientation from matrix if available
    let orientScore = 1;
    if (s.face.matrix && s.face.matrix.data) {
      const m = s.face.matrix.data;
      // approximate yaw/pitch from matrix
      const yaw = Math.asin(Math.min(1, Math.max(-1, -m[2])));
      const pitch = Math.atan2(m[6], m[10]);
      orientScore = 1 - Math.min(1, (Math.abs(yaw)+Math.abs(pitch))/0.9);
    } else {
      // fallback: nose vs eyeMid horizontal offset
      const offset = Math.abs(s.face.nose.x - s.face.eyeMid.x) / (s.face.width+1e-6);
      orientScore = 1 - Math.min(1, offset*4);
    }
    const score = openScore*0.25 + centerScore*0.3 + vertScore*0.15 + sizeScore*0.1 + orientScore*0.2;
    this.lastConfidence = score;
    return Math.max(0, Math.min(1, score));
  }

  _isLookingAtCamera(s, conf, rawLm) {
    if (conf < 0.45) return false;
    const irisCentered = Math.abs(s.left.irisRatio.x-0.5) < 0.28 && Math.abs(s.right.irisRatio.x-0.5) < 0.28;
    const vertCentered = Math.abs(s.left.irisRatio.y-0.5) < 0.35 && Math.abs(s.right.irisRatio.y-0.5) < 0.35;
    const eyesOpen = s.left.openness > 0.12 && s.right.openness > 0.12;
    const notTooFar = s.face.width > 0.08;
    return irisCentered && vertCentered && eyesOpen && notTooFar && conf >= 0.55;
  }

  // Convert normalized [0,1] landmark to screen pixels, mirrored (video is mirrored)
  toScreen(pt, viewport) {
    const x = (1 - pt.x) * viewport.width;
    const y = pt.y * viewport.height;
    return { x, y };
  }

  reset() {
    this.smoothed = null;
    this.history = [];
  }
}
