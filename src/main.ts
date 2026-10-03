// Wires content -> engine -> ui. For now, just a loading screen.
const canvas = document.getElementById('game');

if (canvas instanceof HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const draw = (): void => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0b0a10';
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.fillStyle = '#e8c872';
      ctx.font = '32px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('The Lantern Crown — loading', window.innerWidth / 2, window.innerHeight / 2);
    };
    draw();
    window.addEventListener('resize', draw);
  }
}

export {};
