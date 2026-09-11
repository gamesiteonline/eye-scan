/**
 * hud.js – all visual elements, animations, particles
 * Canvas + DOM hybrid for maximum polish
 */

export class HUDRenderer {
  constructor({ bgCanvas, hudCanvas, particleCanvas, video, ui }) {
    this.bgCanvas = bgCanvas;
    this.hudCanvas = hudCanvas;
    this.pCanvas = particleCanvas;
    this.video = video;
    this.ui = ui;

    this.bgCtx = bgCanvas.getContext('2d', { alpha: true });
    this.hudCtx = hudCanvas.getContext('2d', { alpha: true });
    this.pCtx = particleCanvas.getContext('2d', { alpha: true });

    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.isMobile = /Mobi|Android|iPhone/i.test(navigator.userAgent) || window.innerWidth < 768;
    this.particleCount = this.isMobile ? 48 : 110;

    this.particles = [];
    this.scanParticles = [];
    this.explosionParticles = [];
    this.eyeData = null;
    this.viewport = { width: window.innerWidth, height: window.innerHeight };

    this.progress = 0;
    this.targetProgress = 0;
    this.scanLineY = 0;
    this.time = 0;
    this.glitchTimer = 0;
    this.wavePhase = 0;

    this.hexLines = this._genHexLines(18);
    this.leftWaveCanvas = ui.leftWave;
    this.rightWaveCanvas = ui.rightWave;
    this.leftWaveCtx = this.leftWaveCanvas.getContext('2d');
    this.rightWaveCtx = this.rightWaveCanvas.getContext('2d');

    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._initParticles();
  }

  _resize() {
    this.viewport = { width: window.innerWidth, height: window.innerHeight };
    const canvases = [this.bgCanvas, this.hudCanvas, this.pCanvas];
    for (const c of canvases) {
      c.width = this.viewport.width * this.dpr;
      c.height = this.viewport.height * this.dpr;
      c.style.width = this.viewport.width + 'px';
      c.style.height = this.viewport.height + 'px';
      const ctx = c.getContext('2d');
      ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
    }
    // wave canvases
    for (const wc of [this.leftWaveCanvas, this.rightWaveCanvas]) {
      const r = wc.getBoundingClientRect();
      wc.width = r.width * this.dpr;
      wc.height = r.height * this.dpr;
      const ctx = wc.getContext('2d');
      ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
    }
  }

  _genHexLines(n) {
    const lines = [];
    const chars = '0123456789ABCDEF';
    for (let i=0;i<n;i++) {
      let s='';
      for (let j=0;j<24;j++) s+= chars[Math.floor(Math.random()*16)] + (j%4===3?' ':'' );
      lines.push(s);
    }
    return lines;
  }

  _initParticles() {
    this.particles = [];
    for (let i=0;i<this.particleCount;i++) {
      this.particles.push({
        angle: Math.random()*Math.PI*2,
        radius: 60 + Math.random()*160,
        speed: 0.002 + Math.random()*0.008,
        size: 1 + Math.random()*2.2,
        alpha: 0.3 + Math.random()*0.7,
        eye: Math.random()>0.5 ? 'left' : 'right',
        offset: Math.random()*Math.PI*2,
        color: Math.random()>0.6 ? '#00F0FF' : Math.random()>0.5 ? '#FF0055' : '#FFFFFF'
      });
    }
  }

  setEyeData(trackerData, toScreenFn) {
    if (!trackerData || !trackerData.eyes) {
      this.eyeData = null;
      return;
    }
    const e = trackerData.eyes;
    const leftScreen = toScreenFn(e.left.iris, this.viewport);
    const rightScreen = toScreenFn(e.right.iris, this.viewport);
    const leftCenter = toScreenFn(e.left.center, this.viewport);
    const rightCenter = toScreenFn(e.right.center, this.viewport);
    const faceCenter = toScreenFn(e.face.eyeMid, this.viewport);
    // scale eye box size based on face width
    const baseW = e.face.width * this.viewport.width * 2.2;
    this.eyeData = {
      left: { ...e.left, screen: leftScreen, centerScreen: leftCenter, boxW: baseW, boxH: baseW*0.66 },
      right: { ...e.right, screen: rightScreen, centerScreen: rightCenter, boxW: baseW, boxH: baseW*0.66 },
      faceCenter,
      confidence: trackerData.confidence,
      looking: trackerData.lookingAtCamera
    };
  }

  update(dt, state) {
    this.time += dt;
    this.wavePhase += dt*0.004;
    this.scanLineY = (this.scanLineY + dt*0.18) % this.viewport.height;
    // progress smoothing
    this.progress += (this.targetProgress - this.progress) * 0.12;
    if (Math.abs(this.targetProgress - this.progress) < 0.1) this.progress = this.targetProgress;

    // hex scroll
    if (Math.random() < 0.12) {
      this.hexLines.shift();
      let s=''; const chars='0123456789ABCDEF';
      for (let j=0;j<24;j++) s+= chars[Math.floor(Math.random()*16)] + (j%4===3?' ':'');
      this.hexLines.push(s);
    }

    // particles orbit
    for (const p of this.particles) {
      p.angle += p.speed * dt * 0.06;
      // if scanning, tighten radius
      if (state === 'SCANNING') {
        p.radius += ( (80+Math.sin(this.time*0.001+p.offset)*20) - p.radius) * 0.02;
      }
    }

    // explosion particles
    for (let i=this.explosionParticles.length-1;i>=0;i--) {
      const ep = this.explosionParticles[i];
      ep.x += ep.vx * dt*0.06;
      ep.y += ep.vy * dt*0.06;
      ep.vx *= 0.998;
      ep.vy *= 0.998;
      ep.life -= dt*0.001;
      if (ep.life <= 0) this.explosionParticles.splice(i,1);
    }
  }

  setProgress(p) { this.targetProgress = Math.max(0, Math.min(100, p)); }

  triggerExplosion(center) {
    const count = this.isMobile ? 36 : 90;
    for (let i=0;i<count;i++) {
      const ang = Math.random()*Math.PI*2;
      const sp = 2 + Math.random()*12;
      this.explosionParticles.push({
        x: center.x, y: center.y,
        vx: Math.cos(ang)*sp, vy: Math.sin(ang)*sp,
        size: 1.5 + Math.random()*3.5,
        life: 0.6 + Math.random()*0.9,
        maxLife: 1.5,
        color: Math.random()>0.5 ? '#00F0FF' : '#FF0055'
      });
    }
  }

  render(state) {
    this._drawBackground(state);
    this._drawHud(state);
    this._drawParticles(state);
    this._drawDataPanels(state);
  }

  _drawBackground(state) {
    const ctx = this.bgCtx;
    const w = this.viewport.width, h = this.viewport.height;
    ctx.clearRect(0,0,w,h);

    // atmospheric gradients
    const g1 = ctx.createRadialGradient(w*0.25, h*0.25, 0, w*0.25, h*0.25, w*0.9);
    g1.addColorStop(0, 'rgba(26,0,51,0.55)');
    g1.addColorStop(0.4, 'rgba(26,0,51,0.15)');
    g1.addColorStop(1, 'transparent');
    ctx.fillStyle = g1;
    ctx.fillRect(0,0,w,h);

    const g2 = ctx.createRadialGradient(w*0.85, h*0.85, 0, w*0.85, h*0.85, w*0.8);
    g2.addColorStop(0, 'rgba(51,0,17,0.55)');
    g2.addColorStop(0.45, 'rgba(51,0,17,0.12)');
    g2.addColorStop(1, 'transparent');
    ctx.fillStyle = g2;
    ctx.fillRect(0,0,w,h);

    // subtle center glow when scanning
    if (state === 'SCANNING' || state === 'LOCKING') {
      const intensity = state === 'LOCKING' ? 0.35 : 0.12 + Math.sin(this.time*0.003)*0.04;
      const cg = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, w*0.6);
      cg.addColorStop(0, `rgba(0,240,255,${intensity})`);
      cg.addColorStop(1, 'transparent');
      ctx.fillStyle = cg;
      ctx.fillRect(0,0,w,h);
    }

    // depth-of-field darkening outside eye region
    if (this.eyeData && (state === 'SCANNING' || state === 'ACQUIRING')) {
      ctx.save();
      ctx.fillStyle = 'rgba(5,5,16,0.72)';
      ctx.fillRect(0,0,w,h);
      // cut out eye areas
      ctx.globalCompositeOperation = 'destination-out';
      for (const side of ['left','right']) {
        const ed = this.eyeData[side];
        const grd = ctx.createRadialGradient(ed.centerScreen.x, ed.centerScreen.y, 0, ed.centerScreen.x, ed.centerScreen.y, ed.boxW*1.8);
        grd.addColorStop(0, 'rgba(0,0,0,1)');
        grd.addColorStop(0.6, 'rgba(0,0,0,0.6)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(ed.centerScreen.x, ed.centerScreen.y, ed.boxW*1.8, 0, Math.PI*2);
        ctx.fill();
      }
      // face center
      const fc = this.eyeData.faceCenter;
      const fg = ctx.createRadialGradient(fc.x, fc.y, 0, fc.x, fc.y, 260);
      fg.addColorStop(0, 'rgba(0,0,0,0.9)');
      fg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(fc.x, fc.y, 260, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }
  }

  _drawHud(state) {
    const ctx = this.hudCtx;
    const w = this.viewport.width, h = this.viewport.height;
    ctx.clearRect(0,0,w,h);

    if (!this.eyeData) {
      // idle targeting
      if (state === 'MONITORING') {
        ctx.strokeStyle = 'rgba(0,240,255,0.18)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6,10]);
        ctx.strokeRect(w*0.5-120, h*0.5-90, 240, 180);
        ctx.setLineDash([]);
      }
      return;
    }

    const left = this.eyeData.left;
    const right = this.eyeData.right;

    // draw eye glows
    for (const eye of [left, right]) {
      // outer cyan glow
      const outer = ctx.createRadialGradient(eye.screen.x, eye.screen.y, 0, eye.screen.x, eye.screen.y, eye.boxW*0.9);
      outer.addColorStop(0, 'rgba(0,240,255,0.45)');
      outer.addColorStop(0.25, 'rgba(0,240,255,0.18)');
      outer.addColorStop(1, 'transparent');
      ctx.fillStyle = outer;
      ctx.beginPath(); ctx.arc(eye.screen.x, eye.screen.y, eye.boxW*0.9, 0, Math.PI*2); ctx.fill();

      // iris ring glow
      ctx.save();
      ctx.shadowColor = '#00F0FF';
      ctx.shadowBlur = 18;
      ctx.strokeStyle = 'rgba(0,240,255,0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const irisR = eye.boxW*0.18;
      ctx.arc(eye.screen.x, eye.screen.y, irisR, 0, Math.PI*2);
      ctx.stroke();
      // inner
      ctx.shadowBlur = 12;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(eye.screen.x, eye.screen.y, irisR*0.55, 0, Math.PI*2); ctx.stroke();
      ctx.restore();

      // specular highlight
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.shadowColor = '#FFFFFF';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(eye.screen.x + irisR*0.28, eye.screen.y - irisR*0.22, 2.8, 0, Math.PI*2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // rotating ticks
      ctx.save();
      ctx.translate(eye.screen.x, eye.screen.y);
      ctx.rotate(this.time*0.0015);
      ctx.strokeStyle = 'rgba(0,240,255,0.6)';
      ctx.lineWidth = 1;
      for (let i=0;i<8;i++) {
        ctx.rotate(Math.PI*2/8);
        ctx.beginPath(); ctx.moveTo(irisR+8,0); ctx.lineTo(irisR+14,0); ctx.stroke();
      }
      ctx.restore();

      // eye frame brackets (drawn on canvas for crisp glow)
      const bw = eye.boxW, bh = eye.boxH;
      const x = eye.centerScreen.x - bw/2, y = eye.centerScreen.y - bh/2;
      ctx.save();
      ctx.strokeStyle = '#00F0FF';
      ctx.shadowColor = '#00F0FF'; ctx.shadowBlur = 10;
      ctx.lineWidth = 1.5;
      const cornerLen = 18;
      // TL
      ctx.beginPath(); ctx.moveTo(x, y+cornerLen); ctx.lineTo(x, y); ctx.lineTo(x+cornerLen, y); ctx.stroke();
      // TR
      ctx.beginPath(); ctx.moveTo(x+bw-cornerLen, y); ctx.lineTo(x+bw, y); ctx.lineTo(x+bw, y+cornerLen); ctx.stroke();
      // BL
      ctx.beginPath(); ctx.moveTo(x, y+bh-cornerLen); ctx.lineTo(x, y+bh); ctx.lineTo(x+cornerLen, y+bh); ctx.stroke();
      // BR
      ctx.beginPath(); ctx.moveTo(x+bw-cornerLen, y+bh); ctx.lineTo(x+bw, y+bh); ctx.lineTo(x+bw, y+bh-cornerLen); ctx.stroke();
      // dashed inner rect
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(0,240,255,0.22)';
      ctx.lineWidth = 0.8;
      ctx.setLineDash([4,6]);
      ctx.strokeRect(x+6, y+6, bw-12, bh-12);
      ctx.setLineDash([]);
      ctx.restore();
    }

    // connection line between eyes with traveling dot
    const mx = (left.screen.x + right.screen.x)/2;
    const my = (left.screen.y + right.screen.y)/2 - 10;
    ctx.save();
    ctx.strokeStyle = 'rgba(0,240,255,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([8,8]);
    ctx.lineDashOffset = -this.time*0.08;
    ctx.beginPath();
    ctx.moveTo(left.screen.x, left.screen.y);
    ctx.quadraticCurveTo(mx, my, right.screen.x, right.screen.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // traveling energy dot
    const t = (Math.sin(this.time*0.002)+1)/2;
    const qx = (1-t)*(1-t)*left.screen.x + 2*(1-t)*t*mx + t*t*right.screen.x;
    const qy = (1-t)*(1-t)*left.screen.y + 2*(1-t)*t*my + t*t*right.screen.y;
    ctx.fillStyle = '#00F0FF';
    ctx.shadowColor = '#00F0FF'; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(qx, qy, 3, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();

    // per-eye scan lines moving vertically inside eye box
    for (const eye of [left, right]) {
      const bw = eye.boxW, bh = eye.boxH;
      const x = eye.centerScreen.x - bw/2, y = eye.centerScreen.y - bh/2;
      const scanY = y + ( (this.time*0.12) % bh );
      ctx.save();
      ctx.strokeStyle = 'rgba(0,240,255,0.9)';
      ctx.shadowColor = '#00F0FF'; ctx.shadowBlur = 12;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x, scanY); ctx.lineTo(x+bw, scanY); ctx.stroke();
      // fade edges
      const grad = ctx.createLinearGradient(x, scanY, x+bw, scanY);
      grad.addColorStop(0, 'transparent'); grad.addColorStop(0.2, 'rgba(0,240,255,0.5)'); grad.addColorStop(0.8, 'rgba(0,240,255,0.5)'); grad.addColorStop(1, 'transparent');
      ctx.strokeStyle = grad; ctx.lineWidth = 8; ctx.globalAlpha = 0.18;
      ctx.beginPath(); ctx.moveTo(x, scanY); ctx.lineTo(x+bw, scanY); ctx.stroke();
      ctx.restore();
    }

    // center vertical scan line
    if (state === 'SCANNING') {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,0,85,0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2,12]);
      ctx.beginPath();
      const fc = this.eyeData.faceCenter;
      ctx.moveTo(fc.x, 0); ctx.lineTo(fc.x, h);
      ctx.stroke();
      ctx.restore();
    }

    // crosshair at face center when acquiring
    if (state === 'ACQUIRING' && this.eyeData) {
      const fc = this.eyeData.faceCenter;
      ctx.save();
      ctx.strokeStyle = 'rgba(0,240,255,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(fc.x-18, fc.y); ctx.lineTo(fc.x+18, fc.y);
      ctx.moveTo(fc.x, fc.y-18); ctx.lineTo(fc.x, fc.y+18);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(fc.x, fc.y, 26, 0, Math.PI*2); ctx.stroke();
      ctx.restore();
    }
  }

  _drawParticles(state) {
    const ctx = this.pCtx;
    const w = this.viewport.width, h = this.viewport.height;
    ctx.clearRect(0,0,w,h);
    if (!this.eyeData) return;

    // orbiting particles
    for (const p of this.particles) {
      const eye = p.eye === 'left' ? this.eyeData.left : this.eyeData.right;
      const x = eye.centerScreen.x + Math.cos(p.angle)*p.radius;
      const y = eye.centerScreen.y + Math.sin(p.angle)*p.radius*0.66;
      const alpha = p.alpha * (state === 'SCANNING' ? 1.2 : 0.7);
      ctx.save();
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(x, y, p.size, 0, Math.PI*2); ctx.fill();
      // trail line to center
      if (state === 'SCANNING') {
        ctx.strokeStyle = p.color; ctx.globalAlpha = 0.12; ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(eye.centerScreen.x, eye.centerScreen.y); ctx.stroke();
      }
      ctx.restore();
    }

    // explosion
    for (const ep of this.explosionParticles) {
      ctx.save();
      ctx.globalAlpha = ep.life;
      ctx.fillStyle = ep.color;
      ctx.shadowColor = ep.color; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(ep.x, ep.y, ep.size, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }

    // data bits flying between eyes
    if (state === 'SCANNING') {
      ctx.save();
      ctx.font = '9px Share Tech Mono';
      ctx.fillStyle = 'rgba(0,240,255,0.85)';
      for (let i=0;i<6;i++) {
        const t = (this.time*0.0006 + i*0.17) % 1;
        const lx = this.eyeData.left.centerScreen.x, ly = this.eyeData.left.centerScreen.y;
        const rx = this.eyeData.right.centerScreen.x, ry = this.eyeData.right.centerScreen.y;
        const x = lx + (rx-lx)*t + Math.sin(this.time*0.003+i)*6;
        const y = ly + (ry-ly)*t;
        ctx.fillText(Math.random()>0.5?'1':'0', x, y);
      }
      ctx.restore();
    }
  }

  _drawDataPanels(state) {
    // waveforms
    this._drawWave(this.leftWaveCtx, this.leftWaveCanvas, '#00F0FF', 0);
    this._drawWave(this.rightWaveCtx, this.rightWaveCanvas, '#FF0055', 1.7);
  }

  _drawWave(ctx, canvas, color, offset) {
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    ctx.clearRect(0,0,w,h);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.shadowColor = color; ctx.shadowBlur = 8;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let x=0;x<w;x++) {
      const t = x/w*6 + this.wavePhase + offset;
      const y = h/2 + Math.sin(t)*h*0.22 + Math.sin(t*2.3)*h*0.12 + Math.sin(t*0.7+this.time*0.001)*h*0.08;
      if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();
    // fill under
    ctx.globalAlpha = 0.12;
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  updateDOM(ui, state, trackerData) {
    // panels visibility
    const showPanels = state === 'SCANNING' || state === 'ACQUIRING' || state === 'LOCKING';
    ui.panelLeft.classList.toggle('visible', showPanels);
    ui.panelRight.classList.toggle('visible', showPanels);

    if (this.eyeData && trackerData) {
      // position DOM eye frames near eyes (we already draw canvas frames, but also need DOM for extra labels)
      const leftEl = ui.eyeLeft, rightEl = ui.eyeRight;
      leftEl.style.left = this.eyeData.left.centerScreen.x + 'px';
      leftEl.style.top = this.eyeData.left.centerScreen.y + 'px';
      rightEl.style.left = this.eyeData.right.centerScreen.x + 'px';
      rightEl.style.top = this.eyeData.right.centerScreen.y + 'px';
      leftEl.style.display = 'block'; rightEl.style.display = 'block';
      if (showPanels) {
        leftEl.querySelector('.eye-frame').classList.add('active');
        rightEl.querySelector('.eye-frame').classList.add('active');
      } else {
        leftEl.querySelector('.eye-frame').classList.remove('active');
        rightEl.querySelector('.eye-frame').classList.remove('active');
      }
    } else {
      ui.eyeLeft.style.display = 'none';
      ui.eyeRight.style.display = 'none';
    }

    // hex data
    ui.hexLeft.textContent = this.hexLines.slice(0,8).join('\n');
    ui.hexRight.textContent = this.hexLines.slice().reverse().slice(0,8).join('\n');

    // meta
    if (trackerData && trackerData.eyes) {
      const l = trackerData.eyes.left, r = trackerData.eyes.right;
      ui.metaLeft.textContent = `CONF ${(trackerData.confidence*100|0)}% • GAZE ${(l.irisRatio.x*100|0)}:${(r.irisRatio.x*100|0)}`;
      ui.metaRight.textContent = `OPEN ${(l.openness*100|0)}% • DIST ${(trackerData.eyes.face.width*100|0)}`;
    }

    // progress
    const pInt = Math.round(this.progress);
    ui.progressNum.textContent = pInt + '%';
    ui.progressNum.setAttribute('data-text', pInt + '%');
    ui.progressFill.style.width = this.progress + '%';
    ui.progressLabel.textContent = state === 'SCANNING' ? `SCANNING • ${pInt}% • ${trackerData?.lookingAtCamera?'LOCKED':''}` : state === 'LOCKING' ? 'FINALIZING...' : state === 'ACQUIRING' ? 'ACQUIRING TARGET...' : 'AWAITING SUBJECT';

    // center reticle
    ui.centerReticle.classList.toggle('visible', state === 'MONITORING' || state === 'ACQUIRING');

    // top status
    if (state === 'MONITORING') ui.topStatus.textContent = '● STANDBY • AWAITING FACE';
    else if (state === 'ACQUIRING') ui.topStatus.textContent = '◐ ACQUIRING • CENTER FACE';
    else if (state === 'SCANNING') ui.topStatus.textContent = '◑ SCANNING • DO NOT MOVE';
    else if (state === 'LOCKING') ui.topStatus.textContent = '◒ LOCKING • VERIFYING';
    else ui.topStatus.textContent = '● IDLE';
  }
}
