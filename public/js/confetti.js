/**
 * Confetti Module
 * Lightweight canvas confetti for celebrating first order of the day.
 * No external dependencies.
 */
(function () {
  'use strict';

  var canvas = null;
  var ctx = null;
  var particles = [];
  var animationId = null;
  var isRunning = false;

  var COLORS = ['#10b981', '#6366f1', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316'];
  var PARTICLE_COUNT = 80;
  var GRAVITY = 0.003;
  var DRAG = 0.98;

  function createCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'confettiCanvas';
    canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function randomRange(min, max) {
    return Math.random() * (max - min) + min;
  }

  function createParticle() {
    return {
      x: canvas.width / 2 + randomRange(-100, 100),
      y: canvas.height / 2,
      vx: randomRange(-0.015, 0.015) * canvas.width,
      vy: randomRange(-0.02, -0.005) * canvas.height,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      size: randomRange(5, 10),
      rotation: randomRange(0, Math.PI * 2),
      rotationSpeed: randomRange(-0.1, 0.1),
      opacity: 1,
      shape: Math.random() > 0.5 ? 'rect' : 'circle'
    };
  }

  function update() {
    if (!isRunning) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var alive = false;

    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      p.vy += GRAVITY * canvas.height;
      p.vx *= DRAG;
      p.vy *= DRAG;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.rotationSpeed;
      p.opacity -= 0.008;

      if (p.opacity <= 0 || p.y > canvas.height + 50) continue;

      alive = true;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.opacity);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;

      if (p.shape === 'rect') {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (alive) {
      animationId = requestAnimationFrame(update);
    } else {
      stop();
    }
  }

  function stop() {
    isRunning = false;
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    particles = [];
  }

  /**
   * Fire confetti from the center of the screen.
   */
  function fire() {
    createCanvas();
    stop();

    particles = [];
    for (var i = 0; i < PARTICLE_COUNT; i++) {
      particles.push(createParticle());
    }

    isRunning = true;
    update();
  }

  /**
   * Check if this is the first order of the day and fire confetti.
   * @param {number} orderCount - Current number of orders today
   */
  function celebrateFirstOrder(orderCount) {
    if (orderCount !== 1) return;

    var today = new Date().toDateString();
    var key = 'tv_confetti_' + today;

    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
    } catch (e) { /* ignore */ }

    // Slight delay for dramatic effect
    setTimeout(fire, 300);
  }

  // Expose
  window.Confetti = {
    fire: fire,
    celebrateFirstOrder: celebrateFirstOrder
  };
})();
