'use strict';
    /* ─────────────────────────────────────────────────────────────────────────────
       GLOBALS
    ───────────────────────────────────────────────────────────────────────────── */
    const $ = id => document.getElementById(id);
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    let pdfDoc = null;
    let totalPages = 0;
    let currentPage = 0;
    let animRunning = false;
    let pageSeq = [];
    let rendered = {};     // page index -> offscreen canvas
    let stageW = 400;
    let stageH = 520;

    // Each mode uses its OWN RAF id so they never clobber each other
    let burnRAF = 0;
    let bkRAF = 0;  // basket
    let brkRAF = 0;  // breakout

    const setStat = t => { $('status').textContent = t; };
    const setLabel = m => {
      const map = { burn: 'BURNING', tear: 'TEARING', basket: 'BASKETBALL', breakout: 'BREAKOUT' };
      $('anim-label').textContent = map[m] || m.toUpperCase();
      $('anim-label').className = 'anim-label ' + m;
      $('prog-fill').className = 'prog-fill ' + m;
    };

    /* ─────────────────────────────────────────────────────────────────────────────
       FILE LOADING
    ───────────────────────────────────────────────────────────────────────────── */
    $('file-input').addEventListener('change', e => { if (e.target.files[0]) loadPDF(e.target.files[0]); });
    const dz = $('drop-zone');
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('over');
      if (e.dataTransfer.files[0]) loadPDF(e.dataTransfer.files[0]);
    });

    async function loadPDF(file) {
      setStat('loading…');
      try {
        // Always destroy old doc first to free the worker
        if (pdfDoc) { try { await pdfDoc.destroy(); } catch (_) { } pdfDoc = null; }
        rendered = {};

        const ab = await file.arrayBuffer();
        // Pass a copy via Uint8Array — Chrome sometimes fails with raw ArrayBuffer on reload
        const data = new Uint8Array(ab);
        pdfDoc = await pdfjsLib.getDocument({ data }).promise;
        totalPages = pdfDoc.numPages;
        await startDestruction();
      } catch (err) {
        console.error(err);
        setStat('could not load pdf — try again');
      }
    }

    /* ─────────────────────────────────────────────────────────────────────────────
       SCREENS + SEQUENCE
    ───────────────────────────────────────────────────────────────────────────── */
    function showScreen(id) {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      $(id).classList.add('active');
    }

    function genSeq(n) {
      const seq = new Array(n).fill(null);

      if (n >= 10) {
        if (n < 20) {
          // for 10..19, exactly one special at 10th page, random basket/breakout
          seq[9] = Math.random() < 0.5 ? 'basket' : 'breakout';
        } else {
          // every 10th page gets one special, alternating basket/breakout
          let special = 'basket';
          for (let p = 10; p <= n; p += 10) {
            seq[p - 1] = special;
            special = special === 'basket' ? 'breakout' : 'basket';
          }
        }
      } else if (n > 3) {
        // 4..9: single special at mid
        const mid = Math.floor((n + 1) / 2) - 1;
        seq[mid] = Math.random() < 0.5 ? 'basket' : 'breakout';
      }

      // fill remaining with burn/tear alternate
      let next = 'burn';
      for (let i = 0; i < n; i++) {
        if (seq[i] === null) {
          seq[i] = next;
          next = next === 'burn' ? 'tear' : 'burn';
        }
      }

      return seq;
    }

    /* ─────────────────────────────────────────────────────────────────────────────
       START / PRERENDER
    ───────────────────────────────────────────────────────────────────────────── */
    async function startDestruction() {
      stopAll();
      hideOverlays();
      currentPage = 0;
      animRunning = true;
      pageSeq = genSeq(totalPages);

      $('restart-btn').style.display = 'none';
      $('prog-fill').style.width = '0%';
      $('debris').innerHTML = '';
      $('page-canvas').style.display = 'block';
      document.body.classList.remove('on-fire');

      showScreen('anim-screen');

      // Wait two frames so layout paints — then read real px dimensions
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      stageW = $('stage').clientWidth || 400;
      stageH = $('stage').clientHeight || 520;

      setStat('rendering pages…');
      await prerenderAll();
      setStat('here we go…');
      setTimeout(nextPage, 300);
    }

    async function prerenderAll() {
      const maxW = stageW - 32, maxH = stageH - 32;
      for (let i = 1; i <= totalPages; i++) {
        try {
          const pg = await pdfDoc.getPage(i);
          const vp0 = pg.getViewport({ scale: 1 });
          const scale = Math.min(maxW / vp0.width, maxH / vp0.height, 2.5);
          const vp = pg.getViewport({ scale });

          // CHROME FIX: create canvas, set dimensions as attributes FIRST, then get context
          const oc = document.createElement('canvas');
          const W = Math.max(1, Math.floor(vp.width));
          const H = Math.max(1, Math.floor(vp.height));
          oc.setAttribute('width', W);
          oc.setAttribute('height', H);
          // DO NOT set style width/height here — style overrides can confuse Chrome's rasteriser

          const ctx = oc.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, W, H);

          await pg.render({ canvasContext: ctx, viewport: vp }).promise;
          pg.cleanup();   // release internal resources

          rendered[i] = oc;
        } catch (err) {
          console.warn('Failed to render page', i, err);
        }
      }
    }

    /* ─────────────────────────────────────────────────────────────────────────────
       PAGE DISPATCH
    ───────────────────────────────────────────────────────────────────────────── */
    function hideOverlays() {
      $('basket-ui').style.display = 'none';
      $('brk-ui').style.display = 'none';
    }

    function stopAll() {
      cancelAnimationFrame(burnRAF); burnRAF = 0;
      cancelAnimationFrame(bkRAF); bkRAF = 0;
      cancelAnimationFrame(brkRAF); brkRAF = 0;
      cleanupBasket();
      cleanupBreakout();
    }

    function nextPage() {
      if (!animRunning) return;
      currentPage++;
      if (currentPage > totalPages) { finish(); return; }

      stopAll();
      hideOverlays();
      $('debris').innerHTML = '';
      $('page-ctr').textContent = `PAGE ${currentPage} / ${totalPages}`;
      $('prog-fill').style.width = ((currentPage - 1) / totalPages * 100) + '%';

      const src = rendered[currentPage];
      if (!src || !src.width || !src.height) {
        console.warn('No render for page', currentPage);
        setTimeout(nextPage, 100);
        return;
      }

      // CHROME FIX: set attribute dimensions first, then style, then draw
      const pc = $('page-canvas');
      pc.setAttribute('width', src.width);
      pc.setAttribute('height', src.height);
      pc.style.width = src.width + 'px';
      pc.style.height = src.height + 'px';
      pc.style.display = 'block';
      pc.style.transform = 'translate(-50%,-50%)';
      pc.style.left = '50%';
      pc.style.top = '50%';
      const ctx = pc.getContext('2d');
      ctx.clearRect(0, 0, src.width, src.height);
      ctx.drawImage(src, 0, 0);

      const mode = pageSeq[currentPage - 1];
      setLabel(mode);
      document.body.classList.toggle('on-fire', mode === 'burn');

      if (mode === 'burn') runBurn(src);
      else if (mode === 'tear') runTear(src);
      else if (mode === 'basket') runBasket(src);
      else runBreakout(src);
    }

    function finish() {
      animRunning = false;
      $('prog-fill').style.width = '100%';
      $('page-ctr').textContent = `ALL ${totalPages} PAGES DESTROYED`;
      $('page-canvas').style.display = 'none';
      $('debris').innerHTML = '';
      hideOverlays();
      document.body.classList.remove('on-fire');
      const msgs = ['obliterated.', 'nothing remains.', 'gone forever.', 'dust and memories.', 'completely destroyed.'];
      setStat(msgs[0 | Math.random() * msgs.length]);
      setTimeout(() => { $('restart-btn').style.display = 'block'; }, 600);
    }

    /* ─────────────────────────────────────────────────────────────────────────────
       BURN
    ───────────────────────────────────────────────────────────────────────────── */
    function runBurn(src) {
      setStat('igniting…');
      const pc = $('page-canvas');
      const pw = src.width, ph = src.height;

      // Overlay canvas — exact same size + position as page-canvas
      const bc = document.createElement('canvas');
      bc.setAttribute('width', pw);
      bc.setAttribute('height', ph);
      bc.style.cssText =
        `position:absolute;left:50%;top:50%;` +
        `transform:translate(-50%,-50%);` +
        `width:${pw}px;height:${ph}px;` +
        `z-index:10;box-shadow:3px 5px 18px rgba(0,0,0,.7);`;
      $('stage').appendChild(bc);

      // CHROME FIX: read pixels from a fresh offscreen copy, not from the visible canvas
      const tmp = document.createElement('canvas');
      tmp.setAttribute('width', pw);
      tmp.setAttribute('height', ph);
      const tc = tmp.getContext('2d');
      tc.drawImage(src, 0, 0);
      const srcPx = tc.getImageData(0, 0, pw, ph).data;

      // Now hide the original page canvas
      pc.style.display = 'none';

      const bctx = bc.getContext('2d');    // no willReadFrequently needed — we only write
      const debris = $('debris');
      const pl = stageW / 2 - pw / 2, pt = stageH / 2 - ph / 2;
      const ox = pw * (0.3 + Math.random() * 0.4), oy = ph + 10;
      const maxD = Math.sqrt(Math.max(ox, pw - ox) ** 2 + (ph + 10) ** 2) + 50;
      const DUR = 1600;
      let t0 = null;

      function frame(ts) {
        if (!t0) t0 = ts;
        const elapsed = ts - t0;
        const prog = Math.min(1, elapsed / DUR);
        const front = prog * (maxD + 60);

        // Recompute all pixels from source every frame — no read-back, pure write
        const id = bctx.createImageData(pw, ph);
        const dst = id.data;

        for (let y = 0; y < ph; y++) {
          for (let x = 0; x < pw; x++) {
            const i = (y * pw + x) * 4;
            const dist = Math.sqrt((x - ox) ** 2 + (y - oy) ** 2);
            const d = front - dist;
            if (d > 28) {
              const n = Math.random() * 10;
              dst[i] = 8 + n;
              dst[i + 1] = 5 + n * .35;
              dst[i + 2] = 3;
              dst[i + 3] = Math.max(0, 255 - (d - 28) * 4);
            } else if (d > 0) {
              const h = d / 28;
              dst[i] = Math.min(255, srcPx[i] * h + 255 * (1 - h));
              dst[i + 1] = Math.min(255, srcPx[i + 1] * h + (h > .5 ? 180 * (h - .5) * 2 : 0));
              dst[i + 2] = Math.min(255, srcPx[i + 2] * h * .1);
              dst[i + 3] = 255;
            } else {
              dst[i] = srcPx[i];
              dst[i + 1] = srcPx[i + 1];
              dst[i + 2] = srcPx[i + 2];
              dst[i + 3] = srcPx[i + 3];
            }
          }
        }
        bctx.putImageData(id, 0, 0);

        // Fire edge flickers drawn on top
        if (prog < .97) {
          for (let fx = 0; fx < pw; fx += 2) {
            const dx2 = fx - ox, us = front * front - dx2 * dx2;
            if (us < 0) continue;
            const fy = oy - Math.sqrt(us);
            if (fy < 0 || fy > ph) continue;
            bctx.fillStyle =
              `rgba(255,${50 + (Math.random() * 150) | 0},0,${.4 + Math.random() * .45})`;
            bctx.fillRect(fx, fy + (Math.random() * 10 - 5) - 3, 2, 7 + Math.random() * 10);
          }
        }

        if (Math.random() < .75) spawnEmber(debris, pl, pt, pw, ph, prog);
        if (Math.random() < .38) spawnSmoke(debris, pl, pt, pw, ph);
        if (prog > .35 && Math.random() < .3) spawnAsh(debris, pl, pt, pw, ph);

        if (elapsed < DUR + 200) {
          burnRAF = requestAnimationFrame(frame);
        } else {
          bc.remove();
          pc.style.display = 'block';
          setTimeout(nextPage, 350);
        }
      }
      burnRAF = requestAnimationFrame(frame);
    }

    /* ─────────────────────────────────────────────────────────────────────────────
       TEAR
    ───────────────────────────────────────────────────────────────────────────── */
    function runTear(src) {
      const msgs = ['grip tight…', 'pulling apart…', 'RIPPING!', 'shredding…', 'tearing!'];
      setStat(msgs[0 | Math.random() * msgs.length]);
      const isH = Math.random() < .5;
      const pc = $('page-canvas');
      let shakes = 0;
      const iv = setInterval(() => {
        const dx = (Math.random() - .5) * 10, dy = (Math.random() - .5) * 4;
        pc.style.transform = `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px))`;
        if (++shakes >= 8) {
          clearInterval(iv);
          pc.style.transform = 'translate(-50%,-50%)';
          doTear(pc, src, isH);
        }
      }, 40);
    }

    function jagPts(segs, amp) {
      const pts = [];
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const j = (Math.random() - .5) * amp
          + (Math.random() - .5) * amp * .45
          + (Math.random() - .5) * amp * .25;
        pts.push({ t, j });
      }
      return pts;
    }

    function doTear(pc, src, isH) {
      pc.style.display = 'none';
      const stage = $('stage');
      const debris = $('debris');
      const pw = src.width, ph = src.height;
      const pts = jagPts(28, 18);
      const cx = stageW / 2, cy = stageH / 2;

      // Build one half by clipping the source with a jagged polygon
      function makeHalf(isFirstHalf) {
        const c = document.createElement('canvas');
        c.setAttribute('width', pw);
        c.setAttribute('height', ph);
        const ctx = c.getContext('2d');
        ctx.drawImage(src, 0, 0);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.beginPath();
        if (isH) {
          // horizontal cut — firstHalf = top
          if (isFirstHalf) {
            ctx.moveTo(0, 0); ctx.lineTo(pw, 0); ctx.lineTo(pw, ph / 2);
            for (let i = pts.length - 1; i >= 0; i--)
              ctx.lineTo(pts[i].t * pw, ph / 2 + pts[i].j);
            ctx.lineTo(0, ph / 2);
          } else {
            ctx.moveTo(0, ph); ctx.lineTo(pw, ph); ctx.lineTo(pw, ph / 2);
            for (let i = pts.length - 1; i >= 0; i--)
              ctx.lineTo(pts[i].t * pw, ph / 2 + pts[i].j);
            ctx.lineTo(0, ph / 2);
          }
        } else {
          // vertical cut — firstHalf = left
          if (isFirstHalf) {
            ctx.moveTo(0, 0); ctx.lineTo(0, ph);
            for (let i = pts.length - 1; i >= 0; i--)
              ctx.lineTo(pw / 2 + pts[i].j, pts[i].t * ph);
            ctx.lineTo(pw / 2, 0);
          } else {
            ctx.moveTo(pw, 0); ctx.lineTo(pw, ph);
            for (let i = pts.length - 1; i >= 0; i--)
              ctx.lineTo(pw / 2 + pts[i].j, pts[i].t * ph);
            ctx.lineTo(pw / 2, 0);
          }
        }
        ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';

        // Shadow along tear edge
        ctx.strokeStyle = 'rgba(25,12,4,.55)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        pts.forEach((p, i) => {
          const x = isH ? p.t * pw : pw / 2 + p.j;
          const y = isH ? ph / 2 + p.j : p.t * ph;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
        return c;
      }

      const a = makeHalf(true), b = makeHalf(false);
      const pl = cx - pw / 2, ptop = cy - ph / 2;
      a.style.cssText = `position:absolute;left:${pl}px;top:${ptop}px;transition:transform .75s cubic-bezier(.4,0,1,1),opacity .75s;`;
      b.style.cssText = `position:absolute;left:${pl}px;top:${ptop}px;transition:transform .75s cubic-bezier(.4,0,1,1),opacity .75s;`;
      stage.appendChild(a); stage.appendChild(b);

      for (let i = 0; i < 18; i++) spawnPaperBit(debris, cx, cy, pw, ph);

      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (isH) {
          a.style.transform = `translateY(-${ph * .78}px) rotate(${(Math.random() - .5) * 20}deg)`;
          b.style.transform = `translateY(${ph * .78}px) rotate(${(Math.random() - .5) * 20}deg)`;
        } else {
          a.style.transform = `translateX(-${pw * .78}px) rotate(-${18 + Math.random() * 8}deg)`;
          b.style.transform = `translateX(${pw * .78}px) rotate(${18 + Math.random() * 8}deg)`;
        }
        a.style.opacity = '0'; b.style.opacity = '0';
      }));

      setTimeout(() => {
        a.remove(); b.remove();
        pc.style.display = 'block';
        setTimeout(nextPage, 300 + Math.random() * 200);
      }, 930);
    }

    /* ─────────────────────────────────────────────────────────────────────────────
       CRUMPLE (shared by basket + breakout)
    ───────────────────────────────────────────────────────────────────────────── */
    function crumplePage(src, cb) {
      const stage = $('stage');
      const pc = $('page-canvas');
      pc.style.display = 'none';

      const cc = document.createElement('canvas');
      cc.setAttribute('width', src.width);
      cc.setAttribute('height', src.height);
      cc.style.cssText =
        `position:absolute;left:50%;top:50%;` +
        `transform:translate(-50%,-50%);` +
        `width:${src.width}px;height:${src.height}px;z-index:15;`;
      cc.getContext('2d').drawImage(src, 0, 0);
      stage.appendChild(cc);

      let t0 = null;
      const DUR = 650;
      function frame(ts) {
        if (!t0) t0 = ts;
        const p = Math.min(1, (ts - t0) / DUR);
        const ease = p < .5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
        const scale = 1 - ease * .64;
        const rot = ease * 38 - 16 * Math.sin(ease * Math.PI * 3);
        const skX = Math.sin(ease * Math.PI * 4) * 7 * ease;
        cc.style.transform = `translate(-50%,-50%) scale(${scale}) rotate(${rot}deg) skewX(${skX}deg)`;
        cc.style.borderRadius = (ease * 50) + '%';
        if (p < 1) requestAnimationFrame(frame);
        else { cc.remove(); cb(); }
      }
      requestAnimationFrame(frame);
    }

    function makeBallURL(src) {
      const S = 46;
      const c = document.createElement('canvas');
      c.setAttribute('width', S);
      c.setAttribute('height', S);
      const ctx = c.getContext('2d');
      ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(src, 0, 0, S, S);
      ctx.globalAlpha = .55;
      for (let i = 0; i < 10; i++) {
        ctx.strokeStyle = `rgba(50,32,14,${.1 + Math.random() * .28})`;
        ctx.lineWidth = .6 + Math.random() * .9;
        ctx.beginPath();
        ctx.moveTo(Math.random() * S, Math.random() * S);
        ctx.lineTo(Math.random() * S, Math.random() * S);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const g = ctx.createRadialGradient(S / 2, S / 2, S * .25, S / 2, S / 2, S / 2);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,.38)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
      return c.toDataURL();
    }

    /* ─────────────────────────────────────────────────────────────────────────────
       BASKETBALL MINIGAME
    ───────────────────────────────────────────────────────────────────────────── */
    const BALL_R = 23, BIN_W = 52;

    let bkTries = 3, bkThrown = false, bkDragging = false;
    let bkBallX = 0, bkBallY = 0, bkVX = 0, bkVY = 0;
    let bkRestX = 0, bkRestY = 0;
    let bkBinX = 0, bkBinVX = 0;
    let bkDragOX = 0, bkDragOY = 0;
    let bkPrevX = 0, bkPrevY = 0, bkCurX = 0, bkCurY = 0;

    // Defined at module level so we can add/remove them cleanly
    function _bkDown(e) {
      if (bkThrown) return;
      e.preventDefault();
      const p = stageXY(e);
      bkDragOX = p.x - parseFloat($('bball').style.left || 0);
      bkDragOY = p.y - parseFloat($('bball').style.top || 0);
      bkPrevX = bkCurX = p.x; bkPrevY = bkCurY = p.y;
      bkDragging = true;
      $('bball').style.cursor = 'grabbing';
    }
    function _bkTD(e) {
      if (bkThrown) return;
      e.preventDefault();
      const p = stageXY(e.touches[0]);
      bkDragOX = p.x - parseFloat($('bball').style.left || 0);
      bkDragOY = p.y - parseFloat($('bball').style.top || 0);
      bkPrevX = bkCurX = p.x; bkPrevY = bkCurY = p.y;
      bkDragging = true;
    }
    function _bkMM(e) {
      if (!bkDragging) return;
      const p = stageXY(e);
      bkPrevX = bkCurX; bkPrevY = bkCurY;
      bkCurX = p.x; bkCurY = p.y;
      const nx = p.x - bkDragOX, ny = p.y - bkDragOY;
      $('bball').style.left = nx + 'px'; $('bball').style.top = ny + 'px';
      bkBallX = nx + BALL_R; bkBallY = ny + BALL_R;
      drawHint(bkBallX, bkBallY);
    }
    function _bkTM(e) {
      if (!bkDragging) return;
      e.preventDefault();
      const p = stageXY(e.touches[0]);
      bkPrevX = bkCurX; bkPrevY = bkCurY;
      bkCurX = p.x; bkCurY = p.y;
      const nx = p.x - bkDragOX, ny = p.y - bkDragOY;
      $('bball').style.left = nx + 'px'; $('bball').style.top = ny + 'px';
      bkBallX = nx + BALL_R; bkBallY = ny + BALL_R;
      drawHint(bkBallX, bkBallY);
    }
    function _bkMU(e) {
      if (!bkDragging) return;
      bkDragging = false;
      $('bball').style.cursor = 'grab';
      clearHint();
      bkVX = (bkCurX - bkPrevX) * 2.8;
      bkVY = (bkCurY - bkPrevY) * 2.8;
      bkThrowBall();
    }
    function _bkTU(e) {
      if (!bkDragging) return;
      bkDragging = false;
      clearHint();
      bkVX = (bkCurX - bkPrevX) * 2.8;
      bkVY = (bkCurY - bkPrevY) * 2.8;
      bkThrowBall();
    }

    function stageXY(ev) {
      const r = $('stage').getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }

    function cleanupBasket() {
      cancelAnimationFrame(bkRAF); bkRAF = 0;
      const ball = $('bball');
      ball.removeEventListener('mousedown', _bkDown);
      ball.removeEventListener('touchstart', _bkTD);
      document.removeEventListener('mousemove', _bkMM);
      document.removeEventListener('touchmove', _bkTM);
      document.removeEventListener('mouseup', _bkMU);
      document.removeEventListener('touchend', _bkTU);
      bkDragging = false; bkThrown = false;
    }

    function runBasket(src) {
      setStat('toss it in the bin!');
      crumplePage(src, () => initBasket(src));
    }

    function initBasket(src) {
      $('basket-ui').style.display = 'block';
      bkTries = 3; bkThrown = false; bkDragging = false;
      updateDots();

      const ball = $('bball');
      ball.style.backgroundImage = `url(${makeBallURL(src)})`;
      ball.classList.remove('on-fire');
      ball.style.cssText +=
        ';transform:none;opacity:1;transition:none;cursor:grab;';

      bkRestX = stageW / 2 - BALL_R;
      bkRestY = stageH - 190;
      bkBallX = bkRestX + BALL_R;
      bkBallY = bkRestY + BALL_R;
      ball.style.left = bkRestX + 'px';
      ball.style.top = bkRestY + 'px';

      bkBinX = Math.random() * (stageW - BIN_W * 2) + BIN_W;
      bkBinVX = (1.8 + Math.random() * 1.5) * (Math.random() < .5 ? 1 : -1);
      $('bbin').style.left = bkBinX + 'px';

      const hc = $('hint-canvas');
      hc.setAttribute('width', stageW);
      hc.setAttribute('height', stageH);

      ball.addEventListener('mousedown', _bkDown);
      ball.addEventListener('touchstart', _bkTD, { passive: false });
      document.addEventListener('mousemove', _bkMM);
      document.addEventListener('touchmove', _bkTM, { passive: false });
      document.addEventListener('mouseup', _bkMU);
      document.addEventListener('touchend', _bkTU);

      bkRAF = requestAnimationFrame(bkBinTick);
    }

    function updateDots() {
      for (let i = 0; i < 3; i++)
        $('dot' + i).className = 'try-dot' + (i >= bkTries ? ' used' : '');
    }

    function bkBinTick() {
      bkBinX += bkBinVX;
      if (bkBinX < 4) { bkBinX = 4; bkBinVX = Math.abs(bkBinVX); }
      if (bkBinX > stageW - BIN_W - 4) { bkBinX = stageW - BIN_W - 4; bkBinVX = -Math.abs(bkBinVX); }
      $('bbin').style.left = bkBinX + 'px';
      if (!bkThrown) bkRAF = requestAnimationFrame(bkBinTick);
    }

    function drawHint(bx, by) {
      const hc = $('hint-canvas');
      const ctx = hc.getContext('2d');
      ctx.clearRect(0, 0, stageW, stageH);
      const binCx = bkBinX + BIN_W / 2;
      ctx.setLineDash([5, 8]);
      ctx.strokeStyle = 'rgba(200,160,48,.28)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo((bx + binCx) / 2, Math.min(by, stageH - 30) - 70, binCx, stageH - 34);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    function clearHint() {
      const hc = $('hint-canvas');
      hc.getContext('2d').clearRect(0, 0, stageW, stageH);
    }

    function bkThrowBall() {
      if (bkThrown) return;
      bkThrown = true;
      bkTries--;
      updateDots();
      cancelAnimationFrame(bkRAF);
      const ball = $('bball');
      const GRAV = 0.42;

      function fly() {
        bkVY += GRAV;
        bkBallX += bkVX; bkBallY += bkVY;

        if (bkBallX - BALL_R < 0) { bkBallX = BALL_R; bkVX = Math.abs(bkVX) * .65; }
        if (bkBallX + BALL_R > stageW) { bkBallX = stageW - BALL_R; bkVX = -Math.abs(bkVX) * .65; }
        if (bkBallY - BALL_R < 0) { bkBallY = BALL_R; bkVY = Math.abs(bkVY) * .65; }

        ball.style.left = (bkBallX - BALL_R) + 'px';
        ball.style.top = (bkBallY - BALL_R) + 'px';

        // Also move bin while ball is flying
        bkBinX += bkBinVX;
        if (bkBinX < 4) { bkBinX = 4; bkBinVX = Math.abs(bkBinVX); }
        if (bkBinX > stageW - BIN_W - 4) { bkBinX = stageW - BIN_W - 4; bkBinVX = -Math.abs(bkBinVX); }
        $('bbin').style.left = bkBinX + 'px';

        const dist = Math.hypot(bkBallX - (bkBinX + BIN_W / 2), bkBallY - (stageH - 36));
        if (dist < 34) {
          // SCORED
          ball.style.transition = 'transform .4s ease-in,opacity .4s';
          ball.style.transform = 'scale(.35)';
          ball.style.opacity = '0';
          setStat('IN! 🎉');
          setTimeout(() => {
            ball.style.transform = ''; ball.style.opacity = '1'; ball.style.transition = '';
            bkEnd();
          }, 520);
          return;
        }

        if (bkBallY - BALL_R > stageH + 10) {
          if (bkTries <= 0) {
            // Out of tries — fire the ball
            bkBallX = stageW / 2; bkBallY = stageH / 2;
            ball.style.left = (bkBallX - BALL_R) + 'px';
            ball.style.top = (bkBallY - BALL_R) + 'px';
            ball.classList.add('on-fire');
            setStat('missed! ball is on fire…');
            setTimeout(() => { ball.classList.remove('on-fire'); bkEnd(); }, 1100);
          } else {
            // Reset for next try
            bkThrown = false;
            bkBallX = bkRestX + BALL_R; bkBallY = bkRestY + BALL_R;
            ball.style.left = bkRestX + 'px'; ball.style.top = bkRestY + 'px';
            setStat(`missed! ${bkTries} ${bkTries === 1 ? 'try' : 'tries'} left`);
            bkRAF = requestAnimationFrame(bkBinTick);
          }
          return;
        }
        bkRAF = requestAnimationFrame(fly);
      }
      bkRAF = requestAnimationFrame(fly);
    }

    function bkEnd() {
      cleanupBasket();
      $('basket-ui').style.display = 'none';
      $('page-canvas').style.display = 'none';
      setTimeout(nextPage, 200);
    }

    /* ─────────────────────────────────────────────────────────────────────────────
       BREAKOUT MINIGAME
    ───────────────────────────────────────────────────────────────────────────── */
    let brkAlive = false;
    let brkMoveRef = null;

    function cleanupBreakout() {
      cancelAnimationFrame(brkRAF); brkRAF = 0;
      brkAlive = false;
      const st = $('stage');
      if (brkMoveRef) {
        st.removeEventListener('mousemove', brkMoveRef);
        st.removeEventListener('touchmove', brkMoveRef);
        brkMoveRef = null;
      }
    }

    function runBreakout(src) {
      setStat('keep the ball alive!');
      crumplePage(src, () => initBreakout(src));
    }

    function initBreakout(src) {
      $('brk-ui').style.display = 'block';
      $('brk-msg').style.display = 'none';

      const canvas = $('brk-canvas');
      const W = stageW, H = stageH;
      canvas.setAttribute('width', W);
      canvas.setAttribute('height', H);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      const ctx = canvas.getContext('2d');

      const BR = 17;
      const PAD_W = 88, PAD_H = 11, PAD_Y = H - 32;
      let padX = W / 2 - PAD_W / 2, padTarget = padX;

      // Ball image
      const ballImg = new Image();
      ballImg.src = makeBallURL(src);

      let bx = W / 2, by = H / 2 - 40;
      let vx = (Math.random() < .5 ? 1 : -1) * (2.8 + Math.random() * .8);
      let vy = 3.2 + Math.random() * .8;
      brkAlive = true;

      const stageEl = $('stage');
      brkMoveRef = function (e) {
        const ev = e.touches ? e.touches[0] : e;
        const r = stageEl.getBoundingClientRect();
        padTarget = Math.max(0, Math.min(W - PAD_W, ev.clientX - r.left - PAD_W / 2));
      };
      stageEl.addEventListener('mousemove', brkMoveRef);
      stageEl.addEventListener('touchmove', brkMoveRef, { passive: true });

      // Chrome-safe rounded rect (no ctx.roundRect)
      function rrect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
      }

      function drawBg() {
        ctx.fillStyle = '#090807';
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(255,255,255,.02)';
        ctx.lineWidth = 1;
        for (let x = 0; x < W; x += 44) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
        for (let y = 0; y < H; y += 44) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      }
      function drawPad() {
        rrect(padX, PAD_Y, PAD_W, PAD_H, 5);
        ctx.fillStyle = '#38a858'; ctx.fill();
        ctx.strokeStyle = 'rgba(60,192,90,.5)'; ctx.lineWidth = 1.5; ctx.stroke();
      }
      function drawBall() {
        ctx.save();
        ctx.beginPath(); ctx.arc(bx, by, BR, 0, Math.PI * 2); ctx.clip();
        if (ballImg.complete && ballImg.naturalWidth > 0) {
          ctx.drawImage(ballImg, bx - BR, by - BR, BR * 2, BR * 2);
        } else {
          ctx.fillStyle = '#d8d0c0'; ctx.fill();
        }
        ctx.restore();
        ctx.strokeStyle = 'rgba(25,15,8,.55)'; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.arc(bx, by, BR, 0, Math.PI * 2); ctx.stroke();
      }
      function drawWalls() {
        ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, W - 2, H - 2);
      }

      function step() {
        if (!brkAlive) return;
        padX += (padTarget - padX) * .2;
        bx += vx; by += vy;

        if (bx - BR <= 0) { bx = BR; vx = Math.abs(vx); }
        if (bx + BR >= W) { bx = W - BR; vx = -Math.abs(vx); }
        if (by - BR <= 0) { by = BR; vy = Math.abs(vy); }

        // Paddle collision
        if (vy > 0 && by + BR >= PAD_Y && by + BR <= PAD_Y + PAD_H + 8
          && bx >= padX - 2 && bx <= padX + PAD_W + 2) {
          by = PAD_Y - BR;
          const rel = (bx - (padX + PAD_W / 2)) / (PAD_W / 2);
          vx = rel * 5.5 + (Math.random() - .5) * .4;
          vy = -Math.abs(vy);
          const spd = Math.hypot(vx, vy);
          if (spd > 7.5) { vx = vx / spd * 7.5; vy = vy / spd * 7.5; }
          if (Math.abs(vy) < 2.5) vy = -2.5;
        }

        if (by - BR > H) {
          // Lost
          brkAlive = false;
          drawBg(); drawWalls(); drawPad(); drawBall();
          ctx.fillStyle = 'rgba(190,32,12,.3)'; ctx.fillRect(0, 0, W, H);
          const msg = $('brk-msg');
          msg.textContent = 'LOST';
          msg.style.color = '#e04828';
          msg.style.textShadow = '0 0 22px rgba(220,55,18,.9)';
          msg.style.display = 'block';
          setStat('ball fell — moving on…');
          cleanupBreakout();
          setTimeout(() => { $('brk-ui').style.display = 'none'; setTimeout(nextPage, 200); }, 1200);
          return;
        }

        drawBg(); drawWalls(); drawPad(); drawBall();
        brkRAF = requestAnimationFrame(step);
      }
      brkRAF = requestAnimationFrame(step);
    }

    /* ─────────────────────────────────────────────────────────────────────────────
       PARTICLES
    ───────────────────────────────────────────────────────────────────────────── */
    function spawnPaperBit(layer, cx, cy, pw, ph) {
      const c = document.createElement('canvas');
      const sz = Math.random() * 22 + 8;
      c.setAttribute('width', Math.ceil(sz));
      c.setAttribute('height', Math.ceil(sz * .65));
      const ctx = c.getContext('2d');
      const n = 6 + (Math.random() * 4 | 0), pts = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, r = (.35 + Math.random() * .65) * sz * .5;
        pts.push([sz / 2 + Math.cos(a) * r, c.height / 2 + Math.sin(a) * r * .7]);
      }
      ctx.fillStyle = `hsl(38,${18 + Math.random() * 22}%,${87 + Math.random() * 10}%)`;
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      pts.slice(1).forEach(p => ctx.lineTo(p[0], p[1]));
      ctx.closePath(); ctx.fill();
      const sx = cx + (Math.random() - .5) * pw * .5;
      const sy = cy + (Math.random() - .5) * ph * .4;
      const tx = (Math.random() - .5) * 320, ty = Math.random() * 200 + 40, rot = (Math.random() - .5) * 720;
      const dur = (Math.random() * .5 + .45).toFixed(2), dl = (Math.random() * .15).toFixed(2);
      c.className = 'paper-bit';
      c.style.cssText = `left:${sx}px;top:${sy}px;--tx:${tx}px;--ty:${ty}px;--rot:${rot}deg;animation:bitFly ${dur}s ease-out ${dl}s forwards;`;
      layer.appendChild(c);
      setTimeout(() => c.remove(), (parseFloat(dur) + parseFloat(dl) + .2) * 1000);
    }

    function spawnEmber(layer, pl, pt, pw, ph, prog) {
      const el = document.createElement('div'); el.className = 'ember';
      const sx = pl + pw * .1 + Math.random() * pw * .8, sy = pt + ph * (.5 + (1 - prog) * .4);
      const ex = (Math.random() - .5) * 150, ey = -(Math.random() * 110 + 40);
      const dur = (Math.random() * .5 + .35).toFixed(2), sz = Math.random() * 4 + 2;
      const hue = 10 + Math.random() * 35;
      el.style.cssText = `left:${sx}px;top:${sy}px;width:${sz}px;height:${sz}px;background:hsl(${hue},100%,62%);--ex:${ex}px;--ey:${ey}px;animation:emberUp ${dur}s ease-out forwards;`;
      layer.appendChild(el); setTimeout(() => el.remove(), parseFloat(dur) * 1000 + 120);
    }
    function spawnSmoke(layer, pl, pt, pw, ph) {
      const el = document.createElement('div'); el.className = 'smoke-p';
      const sx = pl + pw * .2 + Math.random() * pw * .6, sy = pt + ph * .35 + Math.random() * ph * .4;
      const sz = Math.random() * 32 + 14, dur = (Math.random() * .9 + .6).toFixed(2);
      el.style.cssText = `left:${sx}px;top:${sy}px;width:${sz}px;height:${sz}px;background:radial-gradient(circle,rgba(75,60,48,.48) 0%,transparent 70%);--sx:${(Math.random() - .5) * 22}px;animation:smokeUp ${dur}s ease-out forwards;`;
      layer.appendChild(el); setTimeout(() => el.remove(), parseFloat(dur) * 1000 + 120);
    }
    function spawnAsh(layer, pl, pt, pw, ph) {
      const el = document.createElement('div'); el.className = 'ash-p';
      const sx = pl + pw * .1 + Math.random() * pw * .8, sy = pt + ph * .25 + Math.random() * ph * .35;
      const w = Math.random() * 10 + 3, h = Math.random() * 4 + 2;
      const ay = Math.random() * 190 + 80, ax = (Math.random() - .5) * 60, rot = (Math.random() - .5) * 200;
      const dur = (Math.random() * .9 + .7).toFixed(2);
      el.style.cssText = `left:${sx}px;top:${sy}px;width:${w}px;height:${h}px;--ax:${ax}px;--ay:${ay}px;--rot:${rot}deg;animation:ashFall ${dur}s ease-in ${(Math.random() * .3).toFixed(2)}s forwards;`;
      layer.appendChild(el); setTimeout(() => el.remove(), parseFloat(dur) * 1000 + 600);
    }

    /* ─────────────────────────────────────────────────────────────────────────────
       RESTART
    ───────────────────────────────────────────────────────────────────────────── */
    $('restart-btn').addEventListener('click', async () => {
      stopAll();
      animRunning = false;
      rendered = {};
      document.body.classList.remove('on-fire');
      if (pdfDoc) { try { await pdfDoc.destroy(); } catch (_) { } pdfDoc = null; }
      $('file-input').value = '';
      $('restart-btn').style.display = 'none';
      $('prog-fill').style.width = '0%';
      $('prog-fill').className = 'prog-fill';
      $('debris').innerHTML = '';
      hideOverlays();
      setStat('');
      // Reset page canvas cleanly
      const pc = $('page-canvas');
      pc.style.display = 'block';
      const tpc = pc.getContext('2d');
      if (pc.width > 0) tpc.clearRect(0, 0, pc.width, pc.height);
      showScreen('upload-screen');
    });