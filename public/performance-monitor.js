// performance-monitor.js
// Logs rendering FPS to the console every 2 seconds.
// Attach to any rAF loop using PerfMonitor.start() / stop().
// Usage: include after the main rAF loop is running.

const PerfMonitor = (function () {
  let running = false;
  let rafId = null;
  let frames = 0;
  let lastTime = 0;
  let logInterval = null;

  function tick(timestamp) {
    if (!running) return;
    frames++;
    if (!lastTime) lastTime = timestamp;
    rafId = requestAnimationFrame(tick);
  }

  function logFps() {
    const elapsed = performance.now() - lastTime;
    if (elapsed > 0) {
      const fps = (frames / elapsed) * 1000;
      console.log(
        `%c[PerfMonitor] FPS: ${fps.toFixed(0)} | Frames: ${frames} | Elapsed: ${elapsed.toFixed(0)}ms`,
        fps < 30 ? 'color: #ff5722; font-weight: bold;' : 'color: #4caf50;'
      );
    }
    frames = 0;
    lastTime = performance.now();
  }

  return {
    start: function () {
      if (running) return;
      running = true;
      frames = 0;
      lastTime = performance.now();
      rafId = requestAnimationFrame(tick);
      logInterval = setInterval(logFps, 2000);
    },
    stop: function () {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      if (logInterval) clearInterval(logInterval);
      frames = 0;
      lastTime = 0;
    },
    isRunning: function () {
      return running;
    }
  };
})();
