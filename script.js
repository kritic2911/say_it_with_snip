pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const $ = id => document.getElementById(id);
    let pdfDoc = null, totalPages = 0, currentPage = 0, animRunning = false;
    const rendered = {};
    let stageW = 400, stageH = 520;
    let pageSequence = [];

    /* ── FILE HANDLING ── */
    $('file-input').addEventListener('change', e => { const f = e.target.files[0]; if (f) handleFile(f); });
    const dz = $('drop-zone');
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) handleFile(f); });

    async function handleFile(file) {
      const ab = await file.arrayBuffer();
      pdfDoc = await pdfjsLib.getDocument({ data: ab }).promise;
      totalPages = pdfDoc.numPages;
      startDestruction();
    }

    function show(id) {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      $(id).classList.add('active');
    }

    /* ── SEQUENCE GENERATION ── */
    // Modes: 'burn','tear','basket','breakout'
    function genSequence(n) {
      const modes = ['burn', 'tear', 'basket', 'breakout'];
      // shuffle-assign so each mode appears roughly evenly, truly random order
      const seq = [];
      for (let i = 0; i < n; i++) seq.push(modes[i % modes.length]);
      // Fisher-Yates
      for (let i = seq.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [seq[i], seq[j]] = [seq[j], seq[i]];
      }
      return seq;
    }

    /* ── START ── */
    async function startDestruction() {
      currentPage = 0; animRunning = true;
      pageSequence = genSequence(totalPages);
      show('anim-screen');
      $('restart-btn').style.display = 'none';
      const st = $('stage'); stageW = st.offsetWidth || 400; stageH = st.offsetHeight || 520;
      setStatus('rendering pages...');
      await prerenderAll();
      nextPage();
    }

    async function prerenderAll() {
      const maxW = stageW - 28, maxH = stageH - 28;
      for (let i = 1; i <= totalPages; i++) {
        const pg = await pdfDoc.getPage(i);
        const vp0 = pg.getViewport({ scale: 1 });
        const scale = Math.min(maxW / vp0.width, maxH / vp0.height, 2);
        const vp = pg.getViewport({ scale });
        const oc = document.createElement('canvas');
        oc.width = Math.floor(vp.width); oc.height = Math.floor(vp.height);
        const ctx = oc.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, oc.width, oc.height);
        await pg.render({ canvasContext: ctx, viewport: vp }).promise;
        rendered[i] = oc;
      }
    }

    function setStatus(t) { $('status-text').textContent = t; }
    function setLabel(mode) {
      const labels = { burn: 'BURNING', tear: 'TEARING', basket: 'BASKETBALL', breakout: 'BREAKOUT' };
      const el = $('anim-label');
      el.textContent = labels[mode] || mode.toUpperCase();
      el.className = 'anim-label ' + mode;
      const pf = $('prog-fill');
      pf.className = 'prog-fill ' + mode;
    }

    function nextPage() {
      if (!animRunning) return;
      currentPage++;
      if (currentPage > totalPages) { finish(); return; }

      $('page-ctr').textContent = `PAGE ${currentPage} / ${totalPages}`;
      $('prog-fill').style.width = ((currentPage - 1) / totalPages * 100) + '%';
      $('debris').innerHTML = '';
      hideAllOverlays();

      const src = rendered[currentPage];
      if (!src) { nextPage(); return; }

      // draw page
      const pc = $('page-canvas');
      pc.width = src.width; pc.height = src.height;
      pc.style.cssText = `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:block;width:${src.width}px;height:${src.height}px;box-shadow:3px 5px 18px rgba(0,0,0,.7);`;
      pc.getContext('2d').drawImage(src, 0, 0);

      const mode = pageSequence[currentPage - 1];
      setLabel(mode);

      if (mode === 'burn') runBurn(src);
      else if (mode === 'tear') runTear(src);
      else if (mode === 'basket') runBasket(src);
      else if (mode === 'breakout') runBreakout(src);
    }

    function hideAllOverlays() {
      $('basket-ui').style.display = 'none';
      $('breakout-ui').style.display = 'none';
      document.body.classList.remove('on-fire');
    }

    function finish() {
      animRunning = false;
      $('prog-fill').style.width = '100%';
      $('page-ctr').textContent = `ALL ${totalPages} PAGES DESTROYED`;
      $('page-canvas').style.display = 'none';
      hideAllOverlays();
      $('debris').innerHTML = '';
      const msgs = ['obliterated.', 'nothing remains.', 'completely destroyed.', 'gone forever.', 'dust and memories.'];
      setStatus(msgs[Math.floor(Math.random() * msgs.length)]);
      setTimeout(() => { $('restart-btn').style.display = 'block'; }, 600);
    }

    /* ════════════════════════════════════
       BURN
    ════════════════════════════════════ */
    function runBurn(src) {
      document.body.classList.add('on-fire');
      const msgs = ['igniting...', 'flames spreading...', 'consumed by fire...', 'reducing to ash...'];
      setStatus(msgs[currentPage % msgs.length]);
      const stage = $('stage'), debris = $('debris');
      const pc = $('page-canvas');
      const pw = src.width, ph = src.height;

      const bc = document.createElement('canvas');
      bc.width = pw; bc.height = ph;
      bc.style.cssText = `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:${pw}px;height:${ph}px;z-index:10;box-shadow:3px 5px 18px rgba(0,0,0,.7);`;
      stage.appendChild(bc);
      const bctx = bc.getContext('2d', { willReadFrequently: true });

      const off = document.createElement('canvas');
      off.width = pw; off.height = ph;
      const octx = off.getContext('2d');
      octx.fillStyle = '#fff'; octx.fillRect(0, 0, pw, ph);
      octx.drawImage(src, 0, 0);
      const srcPx = octx.getImageData(0, 0, pw, ph).data;

      pc.style.display = 'none';

      const ox = pw * (0.3 + Math.random() * 0.4), oy = ph + 10;
      const maxD = Math.sqrt(Math.max(ox, pw - ox) ** 2 + (ph + 10) ** 2) + 40;
      let t0 = null; const DUR = 1500;

      function frame(ts) {
        if (!t0) t0 = ts;
        const el = ts - t0, prog = Math.min(1, el / DUR);
        const front = prog * (maxD + 50);
        const id = bctx.createImageData(pw, ph); const dst = id.data;
        for (let y = 0; y < ph; y++)for (let x = 0; x < pw; x++) {
          const i = (y * pw + x) * 4;
          const d = front - Math.sqrt((x - ox) ** 2 + (y - oy) ** 2);
          if (d > 28) { const n = Math.random() * 12; dst[i] = 8 + n; dst[i + 1] = 5 + n * .4; dst[i + 2] = 3; dst[i + 3] = Math.max(0, 255 - (d - 28) * 4); }
          else if (d > 0) { const h = d / 28; dst[i] = Math.min(255, srcPx[i] * h + 255 * (1 - h)); dst[i + 1] = Math.min(255, srcPx[i + 1] * h + (h > .5 ? 200 * (h - .5) * 2 : 0) * (1 - h)); dst[i + 2] = Math.min(255, srcPx[i + 2] * h * .15); dst[i + 3] = 255; }
          else { dst[i] = srcPx[i]; dst[i + 1] = srcPx[i + 1]; dst[i + 2] = srcPx[i + 2]; dst[i + 3] = srcPx[i + 3]; }
        }
        bctx.putImageData(id, 0, 0);
        if (prog < .97) {
          for (let fx = 0; fx < pw; fx += 2) {
            const dx2 = fx - ox, us = front * front - dx2 * dx2;
            if (us < 0) continue;
            const fy = oy - Math.sqrt(us); if (fy < 0 || fy > ph) continue;
            bctx.fillStyle = `rgba(255,${Math.floor(60 + Math.random() * 140)},0,${.5 + Math.random() * .4})`;
            bctx.fillRect(fx, fy + (Math.random() * 10 - 3) - 4, 2, 8 + Math.random() * 10);
          }
        }
        const pl = stageW / 2 - pw / 2, pt = stageH / 2 - ph / 2;
        if (Math.random() < .75) spawnEmber(debris, pl, pt, pw, ph, prog);
        if (Math.random() < .4) spawnSmoke(debris, pl, pt, pw, ph);
        if (prog > .35 && Math.random() < .35) spawnAsh(debris, pl, pt, pw, ph);
        if (el < DUR + 200) requestAnimationFrame(frame);
        else { bc.remove(); pc.style.display = 'block'; setTimeout(nextPage, 350 + Math.random() * 200); }
      }
      requestAnimationFrame(frame);
    }

    /* ════════════════════════════════════
       TEAR
    ════════════════════════════════════ */
    function runTear(src) {
      const msgs = ['grip tight...', 'pulling apart...', 'ripping!', 'shredding...'];
      setStatus(msgs[Math.floor(Math.random() * msgs.length)]);
      const isH = Math.random() < .5;
      const pc = $('page-canvas');
      let shakes = 0;
      const iv = setInterval(() => {
        const dx = (Math.random() - .5) * 10, dy = (Math.random() - .5) * 4;
        pc.style.transform = `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px))`;
        if (++shakes >= 8) { clearInterval(iv); pc.style.transform = 'translate(-50%,-50%)'; doTear(pc, src, isH); }
      }, 40);
    }

    function jagPts(len, segs = 28, amp = 18) {
      const pts = [];
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const j = (Math.random() - .5) * amp + (Math.random() - .5) * amp * .5 + (Math.random() - .5) * amp * .25;
        pts.push({ t, j });
      }
      return pts;
    }

    function doTear(pc, src, isH) {
      pc.style.display = 'none';
      const stage = $('stage'), debris = $('debris');
      const pw = src.width, ph = src.height;
      const cx = stageW / 2, cy = stageH / 2;
      const pts = jagPts(isH ? pw : ph);

      const makeHalf = (isTop, isLeft) => {
        const c = document.createElement('canvas');
        c.width = pw; c.height = ph;
        const ctx = c.getContext('2d');
        ctx.drawImage(src, 0, 0);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.beginPath();
        if (isH) {
          // horizontal tear
          if (isTop) {
            ctx.moveTo(0, 0); ctx.lineTo(pw, 0); ctx.lineTo(pw, ph / 2);
            for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i].t * pw, ph / 2 + pts[i].j);
            ctx.lineTo(0, ph / 2);
          } else {
            ctx.moveTo(0, ph); ctx.lineTo(pw, ph); ctx.lineTo(pw, ph / 2);
            for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i].t * pw, ph / 2 + pts[i].j);
            ctx.lineTo(0, ph / 2);
          }
        } else {
          // vertical tear
          if (isLeft) {
            ctx.moveTo(0, 0); ctx.lineTo(0, ph);
            for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pw / 2 + pts[i].j, pts[i].t * ph);
            ctx.lineTo(pw / 2, 0);
          } else {
            ctx.moveTo(pw, 0); ctx.lineTo(pw, ph);
            for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pw / 2 + pts[i].j, pts[i].t * ph);
            ctx.lineTo(pw / 2, 0);
          }
        }
        ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(30,18,8,.5)'; ctx.lineWidth = 1.8; ctx.beginPath();
        pts.forEach((p, i) => {
          const x = isH ? p.t * pw : pw / 2 + p.j;
          const y = isH ? ph / 2 + p.j : p.t * ph;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
        return c;
      };

      const a = makeHalf(true, true);
      const b = makeHalf(false, false);
      const pl = cx - pw / 2, pt2 = cy - ph / 2;
      a.style.cssText = `position:absolute;left:${pl}px;top:${pt2}px;transition:transform .75s cubic-bezier(.4,0,1,1),opacity .75s;`;
      b.style.cssText = `position:absolute;left:${pl}px;top:${pt2}px;transition:transform .75s cubic-bezier(.4,0,1,1),opacity .75s;`;
      stage.appendChild(a); stage.appendChild(b);
      for (let i = 0; i < 18; i++)spawnPaperBit(debris, cx, cy, pw, ph);

      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (isH) {
          a.style.transform = `translateY(-${ph * .75}px) rotate(${(Math.random() - .5) * 18}deg)`;
          b.style.transform = `translateY(${ph * .75}px) rotate(${(Math.random() - .5) * 18}deg)`;
        } else {
          a.style.transform = `translateX(-${pw * .75}px) rotate(-20deg)`;
          b.style.transform = `translateX(${pw * .75}px) rotate(20deg)`;
        }
        a.style.opacity = '0'; b.style.opacity = '0';
      }));
      setTimeout(() => { a.remove(); b.remove(); pc.style.display = 'block'; setTimeout(nextPage, 300 + Math.random() * 200); }, 920);
    }

    /* ════════════════════════════════════
       BASKETBALL MINIGAME
    ════════════════════════════════════ */
    function runBasket(src) {
      setStatus('toss it in the bin!');
      const pc = $('page-canvas');
      pc.style.display = 'none';

      // crumple animation then show game
      crumplePage(src, () => startBasketGame(src));
    }

    function crumplePage(src, cb) {
      const stage = $('stage');
      // Draw page into a canvas that shrinks/warps into a ball
      const cc = document.createElement('canvas');
      cc.width = src.width; cc.height = src.height;
      cc.style.cssText = `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:${src.width}px;height:${src.height}px;z-index:15;transition:none;`;
      cc.getContext('2d').drawImage(src, 0, 0);
      stage.appendChild(cc);

      let t0 = null; const DUR = 700;
      function frame(ts) {
        if (!t0) t0 = ts;
        const p = Math.min(1, (ts - t0) / DUR);
        const ease = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        // scale down + rotate + wrinkle
        const scale = 1 - ease * .62;
        const rot = (ease * 40) - 20 * Math.sin(ease * Math.PI * 3);
        const skewX = Math.sin(ease * Math.PI * 4) * 8 * ease;
        cc.style.transform = `translate(-50%,-50%) scale(${scale}) rotate(${rot}deg) skewX(${skewX}deg)`;
        cc.style.borderRadius = `${ease * 50}%`;
        if (p < 1) requestAnimationFrame(frame);
        else { cc.remove(); cb(); }
      }
      requestAnimationFrame(frame);
    }

    function makeCrumpledBall(src) {
      const c = document.createElement('canvas');
      const s = 44; c.width = s; c.height = s;
      const ctx = c.getContext('2d');
      // clip to circle
      ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
      // draw page scaled down + crumple effect (diagonal lines)
      ctx.drawImage(src, 0, 0, s, s);
      ctx.globalAlpha = .45;
      for (let i = 0; i < 8; i++) {
        ctx.strokeStyle = `rgba(80,60,40,${.15 + Math.random() * .3})`;
        ctx.lineWidth = .8 + Math.random();
        ctx.beginPath();
        ctx.moveTo(Math.random() * s, Math.random() * s);
        ctx.lineTo(Math.random() * s, Math.random() * s);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return c.toDataURL();
    }

    let basketTriesLeft = 3, binX = 0, binVX = 0;
    let basketRAF = null, basketActive = false;
    // drag state
    let dragStartX = 0, dragStartY = 0, ballRestX = 0, ballRestY = 0;
    let isDragging = false, thrown = false;
    let ballX = 0, ballY = 0, ballVX = 0, ballVY = 0;

    function startBasketGame(src) {
      const ui = $('basket-ui');
      ui.style.display = 'block';

      basketTriesLeft = 3; thrown = false; isDragging = false;
      updateTryDots();

      // make ball image
      const ballEl = $('basket-ball');
      ballEl.style.backgroundImage = `url(${makeCrumpledBall(src)})`;
      ballEl.style.backgroundSize = 'cover';
      ballEl.style.animation = '';
      ballEl.style.filter = '';

      // bin starts at random x
      const binW = 50;
      binX = Math.random() * (stageW - binW);
      binVX = (1.5 + Math.random() * 1.5) * (Math.random() < .5 ? 1 : -1);
      $('basket-bin').style.left = binX + 'px';

      // place ball centre-bottom area
      ballRestX = stageW / 2 - 22;
      ballRestY = stageH - 160;
      placeBall(ballRestX, ballRestY);

      // hint canvas
      const hint = $('throw-hint');
      hint.width = stageW; hint.height = stageH;

      setupBallDrag(src);
      basketRAF = requestAnimationFrame(basketBinLoop);
    }

    function placeBall(x, y) {
      const b = $('basket-ball');
      b.style.left = x + 'px';
      b.style.top = y + 'px';
    }

    function updateTryDots() {
      for (let i = 0; i < 3; i++) {
        $('dot' + i).className = 'try-dot' + (i >= basketTriesLeft ? ' used' : '');
      }
    }

    function setupBallDrag(src) {
      const ball = $('basket-ball');
      ball.style.cursor = 'grab';

      const getPos = (e) => {
        const r = e.touches ? e.touches[0] : e;
        const sr = $('stage').getBoundingClientRect();
        return { x: r.clientX - sr.left, y: r.clientY - sr.top };
      };

      let lastPos = { x: 0, y: 0 }, prevPos = { x: 0, y: 0 };

      function onDown(e) {
        if (thrown || !basketActive && basketTriesLeft > 0) { }
        if (thrown) return;
        e.preventDefault();
        isDragging = true;
        const pos = getPos(e);
        dragStartX = pos.x - ballRestX;
        dragStartY = pos.y - ballRestY;
        ball.style.cursor = 'grabbing';
        ball.style.transition = 'none';
        lastPos = pos; prevPos = pos;
      }
      function onMove(e) {
        if (!isDragging) return;
        e.preventDefault();
        const pos = getPos(e);
        prevPos = { ...lastPos }; lastPos = pos;
        const nx = pos.x - dragStartX, ny = pos.y - dragStartY;
        placeBall(nx, ny);
        // draw trajectory hint
        drawHint(nx + 22, ny + 22);
      }
      function onUp(e) {
        if (!isDragging) return;
        isDragging = false;
        ball.style.cursor = 'grab';
        clearHint();
        const pos = getPos(e.changedTouches ? e : { changedTouches: [e] });
        const curX = parseFloat(ball.style.left) + 22;
        const curY = parseFloat(ball.style.top) + 22;
        // velocity from drag delta
        const vx = (lastPos.x - prevPos.x) * 2.5;
        const vy = (lastPos.y - prevPos.y) * 2.5;
        throwBall(curX, curY, vx, vy, src);
      }

      ball.addEventListener('mousedown', onDown);
      ball.addEventListener('touchstart', onDown, { passive: false });
      document.addEventListener('mousemove', onMove);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchend', onUp);
      basketActive = true;
    }

    function drawHint(bx, by) {
      const hint = $('throw-hint');
      const ctx = hint.getContext('2d');
      ctx.clearRect(0, 0, stageW, stageH);
      // arc up towards bin
      const binCx = binX + 25;
      ctx.setLineDash([5, 7]);
      ctx.strokeStyle = 'rgba(200,160,48,.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(bx, by);
      const mx = (bx + binCx) / 2, my = Math.min(by, stageH - 28) - 80;
      ctx.quadraticCurveTo(mx, my, binCx, stageH - 28);
      ctx.stroke(); ctx.setLineDash([]);
    }
    function clearHint() {
      const h = $('throw-hint');
      h.getContext('2d').clearRect(0, 0, stageW, stageH);
    }

    function throwBall(sx, sy, vx, vy, src) {
      thrown = true;
      basketTriesLeft--;
      updateTryDots();
      cancelAnimationFrame(basketRAF);

      ballX = sx; ballY = sy; ballVX = vx; ballVY = vy;
      const gravity = 0.45;
      const ballEl = $('basket-ball');

      function flyFrame() {
        ballVY += gravity;
        ballX += ballVX; ballY += ballVY;

        // bounce off walls
        if (ballX - 22 < 0) { ballX = 22; ballVX = Math.abs(ballVX) * 0.7; }
        if (ballX + 22 > stageW) { ballX = stageW - 22; ballVX = -Math.abs(ballVX) * 0.7; }
        if (ballY - 22 < 0) { ballY = 22; ballVY = Math.abs(ballVY) * 0.7; }

        placeBall(ballX - 22, ballY - 22);

        // check bin hit
        const binCx = binX + 25, binCy = stageH - 28;
        const dist = Math.sqrt((ballX - binCx) ** 2 + (ballY - binCy) ** 2);

        if (ballY > stageH - 10) {
          // missed — past bottom
          if (basketTriesLeft <= 0) {
            // fire the ball then next
            placeBall(stageW / 2 - 22, stageH / 2 - 22);
            ballEl.style.animation = 'fireBall .5s ease infinite';
            ballEl.style.filter = 'hue-rotate(-20deg) brightness(1.4)';
            setStatus('missed! catching fire...');
            setTimeout(() => burnBallAndNext(src), 900);
          } else {
            // reset for next try
            thrown = false;
            setStatus(`missed! ${basketTriesLeft} ${basketTriesLeft === 1 ? 'try' : 'tries'} left`);
            placeBall(ballRestX, ballRestY);
            ballEl.style.animation = '';
            basketRAF = requestAnimationFrame(basketBinLoop);
          }
          return;
        }

        if (dist < 35) {
          // scored!
          ballEl.style.transition = 'all .4s ease-in';
          ballEl.style.transform = 'scale(0.7)';
          ballEl.style.opacity = '0';
          setStatus('SCORE! 🎉');
          cancelAnimationFrame(basketRAF);
          setTimeout(() => {
            ballEl.style.transform = ''; ballEl.style.opacity = '1'; ballEl.style.transition = '';
            endBasketGame();
          }, 600);
          return;
        }

        basketRAF = requestAnimationFrame(flyFrame);
      }
      basketRAF = requestAnimationFrame(flyFrame);
      basketRAF = requestAnimationFrame(basketBinLoop);
      // run both loops concurrently via merged frame
      cancelAnimationFrame(basketRAF);
      function merged() {
        ballVY += gravity; ballX += ballVX; ballY += ballVY;
        if (ballX - 22 < 0) { ballX = 22; ballVX = Math.abs(ballVX) * .7; }
        if (ballX + 22 > stageW) { ballX = stageW - 22; ballVX = -Math.abs(ballVX) * .7; }
        if (ballY - 22 < 0) { ballY = 22; ballVY = Math.abs(ballVY) * .7; }
        placeBall(ballX - 22, ballY - 22);
        // move bin
        binX += binVX;
        if (binX < 0) { binX = 0; binVX = Math.abs(binVX); }
        if (binX > stageW - 50) { binX = stageW - 50; binVX = -Math.abs(binVX); }
        $('basket-bin').style.left = binX + 'px';

        const binCx = binX + 25, binCy = stageH - 40;
        const dist = Math.sqrt((ballX - binCx) ** 2 + (ballY - binCy) ** 2);
        if (dist < 38) {
          ballEl.style.transition = 'all .4s ease-in';
          ballEl.style.transform = 'scale(0.5)'; ballEl.style.opacity = '0';
          setStatus('IN! 🎉');
          setTimeout(() => { ballEl.style.transform = ''; ballEl.style.opacity = '1'; ballEl.style.transition = ''; endBasketGame(); }, 550);
          return;
        }
        if (ballY > stageH + 10) {
          if (basketTriesLeft <= 0) {
            placeBall(stageW / 2 - 22, stageH / 2 - 22);
            ballEl.style.animation = 'fireBall .5s ease infinite';
            ballEl.style.filter = 'hue-rotate(-20deg) brightness(1.6)';
            setStatus('missed! ball is on fire...');
            setTimeout(() => burnBallAndNext(src), 1000);
          } else {
            thrown = false;
            setStatus(`missed! ${basketTriesLeft} ${basketTriesLeft === 1 ? 'try' : 'tries'} left`);
            placeBall(ballRestX, ballRestY);
            ballEl.style.animation = ''; ballEl.style.filter = '';
            basketRAF = requestAnimationFrame(basketBinLoop);
          }
          return;
        }
        basketRAF = requestAnimationFrame(merged);
      }
      basketRAF = requestAnimationFrame(merged);
    }

    function basketBinLoop() {
      binX += binVX;
      if (binX < 0) { binX = 0; binVX = Math.abs(binVX); }
      if (binX > stageW - 50) { binX = stageW - 50; binVX = -Math.abs(binVX); }
      $('basket-bin').style.left = binX + 'px';
      if (!thrown) basketRAF = requestAnimationFrame(basketBinLoop);
    }

    function burnBallAndNext(src) {
      const ballEl = $('basket-ball');
      ballEl.style.transition = 'all .6s ease-in';
      ballEl.style.transform = 'scale(0)';
      ballEl.style.opacity = '0';
      setTimeout(() => {
        ballEl.style.transform = ''; ballEl.style.opacity = '1'; ballEl.style.transition = '';
        ballEl.style.animation = ''; ballEl.style.filter = '';
        endBasketGame();
      }, 650);
    }

    function endBasketGame() {
      cancelAnimationFrame(basketRAF);
      basketActive = false; thrown = false;
      $('basket-ui').style.display = 'none';
      $('page-canvas').style.display = 'none';
      removeBasketListeners();
      setTimeout(nextPage, 200);
    }

    // store refs to remove
    let _bmm = null, _btm = null, _bmu = null, _btu = null;
    function removeBasketListeners() {
      if (_bmm) document.removeEventListener('mousemove', _bmm);
      if (_btm) document.removeEventListener('touchmove', _btm);
      if (_bmu) document.removeEventListener('mouseup', _bmu);
      if (_btu) document.removeEventListener('touchend', _btu);
    }

    /* ════════════════════════════════════
       BREAKOUT MINIGAME
    ════════════════════════════════════ */
    let bkRAF = null;

    function runBreakout(src) {
      setStatus('keep the ball alive!');
      const pc = $('page-canvas');
      pc.style.display = 'none';
      crumplePage(src, () => startBreakout(src));
    }

    function startBreakout(src) {
      const ui = $('breakout-ui');
      ui.style.display = 'block';
      $('bk-msg').style.display = 'none';

      const canvas = $('bk-canvas');
      const W = stageW, H = stageH;
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');

      // ── game state
      const BALL_R = 18;
      const PAD_W = 90, PAD_H = 10, PAD_Y = H - 30;
      let padX = W / 2 - PAD_W / 2;
      let padTarget = padX;

      // ball with crumpled page
      const ballImg = new Image();
      ballImg.src = makeCrumpledBall(src);

      let bx = W / 2, by = H / 2 - 60;
      let vx = (Math.random() < .5 ? 1 : -1) * (2.5 + Math.random()), vy = 3 + Math.random();
      let alive = true;

      // mouse / touch control
      const stageEl = $('stage');
      function onMove2(e) {
        const r = e.touches ? e.touches[0] : e;
        const sr = stageEl.getBoundingClientRect();
        padTarget = Math.max(0, Math.min(W - PAD_W, (r.clientX - sr.left) - PAD_W / 2));
      }
      stageEl.addEventListener('mousemove', onMove2);
      stageEl.addEventListener('touchmove', onMove2, { passive: true });

      // background — dark stage
      function drawBg() {
        ctx.fillStyle = '#0a0908';
        ctx.fillRect(0, 0, W, H);
        // subtle grid
        ctx.strokeStyle = 'rgba(255,255,255,.03)';
        ctx.lineWidth = 1;
        for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
        for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      }

      function drawPad() {
        const grad = ctx.createLinearGradient(padX, PAD_Y, padX + PAD_W, PAD_Y + PAD_H);
        grad.addColorStop(0, '#40b060'); grad.addColorStop(1, '#207838');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(padX, PAD_Y, PAD_W, PAD_H, 5);
        ctx.fill();
        // glow
        ctx.shadowColor = 'rgba(64,176,96,.6)'; ctx.shadowBlur = 12;
        ctx.fill(); ctx.shadowBlur = 0;
      }

      function drawBall() {
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, BALL_R, 0, Math.PI * 2);
        ctx.clip();
        if (ballImg.complete && ballImg.naturalWidth > 0) {
          ctx.drawImage(ballImg, bx - BALL_R, by - BALL_R, BALL_R * 2, BALL_R * 2);
        } else {
          ctx.fillStyle = '#e8e0d0'; ctx.fill();
        }
        ctx.restore();
        // crumple shadow ring
        ctx.strokeStyle = 'rgba(40,28,18,.6)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(bx, by, BALL_R, 0, Math.PI * 2); ctx.stroke();
      }

      function drawWalls() {
        ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.lineWidth = 1.5;
        ctx.strokeRect(.75, .75, W - 1.5, H - 1.5);
      }

      function step() {
        if (!alive) { return; }
        // smooth pad
        padX += (padTarget - padX) * .22;

        // move ball
        bx += vx; by += vy;

        // wall collisions
        if (bx - BALL_R <= 0) { bx = BALL_R; vx = Math.abs(vx); }
        if (bx + BALL_R >= W) { bx = W - BALL_R; vx = -Math.abs(vx); }
        if (by - BALL_R <= 0) { by = BALL_R; vy = Math.abs(vy); }

        // paddle collision
        if (vy > 0 && by + BALL_R >= PAD_Y && by - BALL_R <= PAD_Y + PAD_H && bx >= padX - 2 && bx <= padX + PAD_W + 2) {
          by = PAD_Y - BALL_R;
          // angle based on where it hits pad
          const rel = (bx - (padX + PAD_W / 2)) / (PAD_W / 2);
          vx = rel * 5 + (Math.random() - .5) * .5;
          vy = -Math.abs(vy) * (1 + Math.random() * .08);
          // cap speed
          const spd = Math.sqrt(vx * vx + vy * vy);
          if (spd > 7) { vx = vx / spd * 7; vy = vy / spd * 7; }
        }

        // fell past paddle
        if (by - BALL_R > H) {
          alive = false;
          stageEl.removeEventListener('mousemove', onMove2);
          stageEl.removeEventListener('touchmove', onMove2);
          drawBg(); drawWalls(); drawPad(); drawBall();
          // flash red then lose
          ctx.fillStyle = 'rgba(200,40,20,.35)'; ctx.fillRect(0, 0, W, H);
          setStatus('ball fell! moving on...');
          const msg = $('bk-msg');
          msg.textContent = 'LOST'; msg.style.color = '#e05030';
          msg.style.textShadow = '0 0 20px rgba(220,60,20,.8)';
          msg.style.display = 'block';
          setTimeout(() => {
            cancelAnimationFrame(bkRAF);
            $('breakout-ui').style.display = 'none';
            setTimeout(nextPage, 200);
          }, 1200);
          return;
        }

        // draw
        drawBg(); drawWalls(); drawPad(); drawBall();
        bkRAF = requestAnimationFrame(step);
      }

      bkRAF = requestAnimationFrame(step);
    }

    /* ════════════════════════════════════
       PARTICLES (shared)
    ════════════════════════════════════ */
    function spawnPaperBit(layer, cx, cy, pw, ph) {
      const el = document.createElement('canvas');
      const sz = Math.random() * 22 + 8;
      el.width = Math.ceil(sz); el.height = Math.ceil(sz * .65);
      const ctx = el.getContext('2d');
      const n = 6 + Math.floor(Math.random() * 4);
      const pts = [];
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, r = (.35 + Math.random() * .65) * sz * .5; pts.push([sz / 2 + Math.cos(a) * r, el.height / 2 + Math.sin(a) * r * .7]); }
      ctx.fillStyle = `hsl(38,${18 + Math.random() * 22}%,${87 + Math.random() * 10}%)`;
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(p => ctx.lineTo(p[0], p[1])); ctx.closePath(); ctx.fill();
      const sx = cx + (Math.random() - .5) * pw * .5, sy = cy + (Math.random() - .5) * ph * .4;
      const tx = (Math.random() - .5) * 320, ty = Math.random() * 200 + 40, rot = (Math.random() - .5) * 720;
      const dur = (Math.random() * .5 + .45).toFixed(2), delay = (Math.random() * .15).toFixed(2);
      el.style.cssText = `position:absolute;left:${sx}px;top:${sy}px;--tx:${tx}px;--ty:${ty}px;--rot:${rot}deg;animation:bitFly ${dur}s ease-out ${delay}s forwards;`;
      layer.appendChild(el);
      setTimeout(() => el.remove(), (parseFloat(dur) + parseFloat(delay) + .2) * 1000);
    }

    function spawnEmber(layer, pl, pt, pw, ph, prog) {
      const el = document.createElement('div'); el.className = 'ember';
      const sx = pl + pw * .1 + Math.random() * pw * .8, sy = pt + ph * (.5 + (1 - prog) * .4);
      const ex = (Math.random() - .5) * 150, ey = -(Math.random() * 110 + 40);
      const dur = (Math.random() * .5 + .35).toFixed(2), sz = Math.random() * 4 + 2, h = 10 + Math.random() * 35;
      el.style.cssText = `left:${sx}px;top:${sy}px;width:${sz}px;height:${sz}px;background:hsl(${h},100%,62%);box-shadow:0 0 4px hsl(${h},100%,50%);--ex:${ex}px;--ey:${ey}px;animation:emberUp ${dur}s ease-out forwards;`;
      layer.appendChild(el); setTimeout(() => el.remove(), parseFloat(dur) * 1000 + 120);
    }
    function spawnSmoke(layer, pl, pt, pw, ph) {
      const el = document.createElement('div'); el.className = 'smoke-p';
      const sx = pl + pw * .2 + Math.random() * pw * .6, sy = pt + ph * .35 + Math.random() * ph * .4;
      const sz = Math.random() * 32 + 14, dur = (Math.random() * .9 + .6).toFixed(2);
      el.style.cssText = `left:${sx}px;top:${sy}px;width:${sz}px;height:${sz}px;--sx:${(Math.random() - .5) * 24}px;animation:smokeUp ${dur}s ease-out forwards;`;
      layer.appendChild(el); setTimeout(() => el.remove(), parseFloat(dur) * 1000 + 120);
    }
    function spawnAsh(layer, pl, pt, pw, ph) {
      const el = document.createElement('div'); el.className = 'ash-p';
      const sx = pl + pw * .1 + Math.random() * pw * .8, sy = pt + ph * .25 + Math.random() * ph * .35;
      const w = Math.random() * 10 + 3, h = Math.random() * 4 + 2, ay = Math.random() * 190 + 80, ax = (Math.random() - .5) * 60, rot = (Math.random() - .5) * 200, dur = (Math.random() * .9 + .7).toFixed(2);
      el.style.cssText = `left:${sx}px;top:${sy}px;width:${w}px;height:${h}px;--ax:${ax}px;--ay:${ay}px;--rot:${rot}deg;animation:ashFall ${dur}s ease-in ${(Math.random() * .3).toFixed(2)}s forwards;`;
      layer.appendChild(el); setTimeout(() => el.remove(), parseFloat(dur) * 1000 + 600);
    }

    /* restart */
    $('restart-btn').addEventListener('click', () => {
      cancelAnimationFrame(basketRAF);
      cancelAnimationFrame(bkRAF);
      animRunning = false;
      document.body.classList.remove('on-fire');
      Object.keys(rendered).forEach(k => delete rendered[k]);
      pdfDoc = null;
      $('file-input').value = '';
      $('restart-btn').style.display = 'none';
      $('prog-fill').style.width = '0%';
      $('page-canvas').style.display = 'block';
      hideAllOverlays();
      $('debris').innerHTML = '';
      show('upload-screen');
    });