import { useEffect, useRef } from 'react';

export function HeroBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let animId: number;
    let w = 0;
    let h = 0;

    const BRAND = { r: 99, g: 102, b: 241 };
    const ACCENT = { r: 52, g: 211, b: 153 };
    const WARN = { r: 251, g: 191, b: 36 };
    const CYAN = { r: 34, g: 211, b: 238 };
    type C = typeof BRAND;

    interface Node {
      x: number; y: number; vx: number; vy: number;
      r: number; pulse: number; ps: number; color: C;
    }
    interface Particle {
      from: number; to: number; p: number; s: number;
      color: C; size: number; trail: boolean;
    }
    interface ScanLine {
      pos: number; speed: number; opacity: number;
      dir: 'h' | 'v'; width: number;
    }
    interface Ring {
      x: number; y: number; r: number; max: number;
      opacity: number; speed: number; color: C;
    }
    interface BinaryDrop {
      x: number; y: number; speed: number;
      chars: string[]; opacity: number; len: number;
    }

    let nodes: Node[] = [];
    let particles: Particle[] = [];
    let scanLines: ScanLine[] = [];
    let rings: Ring[] = [];
    let binaryDrops: BinaryDrop[] = [];
    let frame = 0;
    let mouseX = -1000;
    let mouseY = -1000;

    function rgba(c: C, a: number): string {
      return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + Math.max(0, a).toFixed(3) + ')';
    }
    function pick(): C {
      return [BRAND, ACCENT, CYAN][Math.floor(Math.random() * 3)];
    }

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      w = canvas!.offsetWidth;
      h = canvas!.offsetHeight;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      init();
    }

    function init() {
      const count = Math.floor((w * h) / 15000);

      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        r: Math.random() * 2 + 1,
        pulse: Math.random() * Math.PI * 2,
        ps: 0.02 + Math.random() * 0.03,
        color: pick(),
      }));

      particles = [];

      scanLines = [
        { pos: 0, speed: 1.3, opacity: 0.6, dir: 'h', width: 1.5 },
        { pos: h * 0.5, speed: 0.8, opacity: 0.4, dir: 'h', width: 1 },
        { pos: 0, speed: 0.6, opacity: 0.4, dir: 'v', width: 1 },
        { pos: w * 0.5, speed: 1.0, opacity: 0.35, dir: 'v', width: 1 },
      ];

      rings = [
        { x: w * 0.5, y: h * 0.35, r: 0, max: 320, opacity: 0.45, speed: 0.9, color: BRAND },
        { x: w * 0.5, y: h * 0.35, r: 100, max: 320, opacity: 0.35, speed: 0.9, color: BRAND },
        { x: w * 0.5, y: h * 0.35, r: 200, max: 320, opacity: 0.25, speed: 0.9, color: ACCENT },
        { x: w * 0.3, y: h * 0.55, r: 0, max: 180, opacity: 0.2, speed: 0.6, color: CYAN },
      ];

      // Fewer binary drops — w/120 instead of w/80
      binaryDrops = Array.from({ length: Math.floor(w / 120) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        speed: 0.3 + Math.random() * 0.7,
        chars: Array.from({ length: 5 + Math.floor(Math.random() * 6) }, () =>
          Math.random() > 0.5 ? '1' : '0'
        ),
        opacity: 0.02 + Math.random() * 0.04,
        len: 5 + Math.floor(Math.random() * 6),
      }));
    }

    function spawnParticle() {
      if (nodes.length < 2) return;
      const from = Math.floor(Math.random() * nodes.length);
      let to = Math.floor(Math.random() * nodes.length);
      if (to === from) to = (to + 1) % nodes.length;
      const dx = nodes[to].x - nodes[from].x;
      const dy = nodes[to].y - nodes[from].y;
      if (Math.sqrt(dx * dx + dy * dy) > 180) return;
      const isAlert = Math.random() > 0.95;
      particles.push({
        from, to, p: 0,
        s: 0.006 + Math.random() * 0.01,
        color: isAlert ? WARN : pick(),
        size: isAlert ? 2 : 1 + Math.random() * 0.8,
        trail: Math.random() > 0.7,
      });
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      frame++;

      // Hex grid
      const hs = 38;
      ctx.strokeStyle = 'rgba(99,102,241,0.035)';
      ctx.lineWidth = 0.5;
      for (let row = 0; row < h / (hs * 1.5) + 1; row++) {
        for (let col = 0; col < w / (hs * Math.sqrt(3)) + 1; col++) {
          const cx = col * hs * Math.sqrt(3) + (row % 2 ? hs * Math.sqrt(3) / 2 : 0);
          const cy = row * hs * 1.5;
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (Math.PI / 3) * k - Math.PI / 6;
            const hx = cx + hs * Math.cos(a);
            const hy = cy + hs * Math.sin(a);
            if (k === 0) ctx.moveTo(hx, hy);
            else ctx.lineTo(hx, hy);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }

      // Binary rain (lighter)
      ctx.font = '10px JetBrains Mono, monospace';
      for (const d of binaryDrops) {
        d.y += d.speed;
        if (d.y > h + d.len * 14) {
          d.y = -d.len * 14;
          d.x = Math.random() * w;
        }
        for (let i = 0; i < d.chars.length; i++) {
          const cy = d.y + i * 14;
          if (cy < 0 || cy > h) continue;
          const fade = i === 0 ? d.opacity * 1.5 : d.opacity * (1 - i / d.chars.length);
          ctx.fillStyle = i === 0 ? rgba(ACCENT, fade) : rgba(BRAND, fade);
          ctx.fillText(d.chars[i], d.x, cy);
        }
        if (frame % 12 === 0 && Math.random() > 0.7) {
          d.chars[Math.floor(Math.random() * d.chars.length)] = Math.random() > 0.5 ? '1' : '0';
        }
      }

      // Move nodes
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        n.pulse += n.ps;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
        const mdx = n.x - mouseX;
        const mdy = n.y - mouseY;
        const md = Math.sqrt(mdx * mdx + mdy * mdy);
        if (md < 100 && md > 0) {
          n.x += (mdx / md) * 1.2;
          n.y += (mdy / md) * 1.2;
        }
      }

      // Connections
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 170) {
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.strokeStyle = rgba(nodes[i].color, (1 - dist / 170) * 0.18);
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      // Nodes
      for (const n of nodes) {
        const pa = 0.3 + Math.sin(n.pulse) * 0.2;
        const pr = n.r + Math.sin(n.pulse) * 0.8;
        ctx.beginPath();
        ctx.arc(n.x, n.y, pr * 4, 0, Math.PI * 2);
        ctx.fillStyle = rgba(n.color, pa * 0.12);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(n.x, n.y, pr, 0, Math.PI * 2);
        ctx.fillStyle = rgba(n.color, pa);
        ctx.fill();
      }

      // Particles — spawn 1 every 4th frame (much lighter)
      if (frame % 4 === 0) spawnParticle();
      particles = particles.filter(function(p) { return p.p <= 1; });
      for (const p of particles) {
        p.p += p.s;
        const fn = nodes[p.from];
        const tn = nodes[p.to];
        if (!fn || !tn) continue;
        const x = fn.x + (tn.x - fn.x) * p.p;
        const y = fn.y + (tn.y - fn.y) * p.p;
        const alpha = Math.sin(p.p * Math.PI) * 0.55;

        if (p.trail) {
          const tx = fn.x + (tn.x - fn.x) * Math.max(0, p.p - 0.04);
          const ty = fn.y + (tn.y - fn.y) * Math.max(0, p.p - 0.04);
          const tg = ctx.createLinearGradient(tx, ty, x, y);
          tg.addColorStop(0, rgba(p.color, 0));
          tg.addColorStop(1, rgba(p.color, alpha * 0.3));
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(x, y);
          ctx.strokeStyle = tg;
          ctx.lineWidth = p.size * 0.6;
          ctx.stroke();
        }

        // Smaller glow
        ctx.beginPath();
        ctx.arc(x, y, p.size * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = rgba(p.color, alpha * 0.1);
        ctx.fill();

        // Core
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = rgba(p.color, alpha);
        ctx.fill();
      }

      // Scan lines
      for (const s of scanLines) {
        s.pos += s.speed;
        if (s.dir === 'h') {
          if (s.pos > h + 30) s.pos = -30;
          const g = ctx.createLinearGradient(0, s.pos, w, s.pos);
          g.addColorStop(0, rgba(BRAND, 0));
          g.addColorStop(0.25, rgba(BRAND, s.opacity));
          g.addColorStop(0.5, rgba(CYAN, s.opacity * 0.7));
          g.addColorStop(0.75, rgba(ACCENT, s.opacity * 0.5));
          g.addColorStop(1, rgba(BRAND, 0));
          ctx.fillStyle = g;
          ctx.fillRect(0, s.pos - s.width / 2, w, s.width);
          const gg = ctx.createLinearGradient(0, s.pos - 35, 0, s.pos + 35);
          gg.addColorStop(0, 'rgba(99,102,241,0)');
          gg.addColorStop(0.5, rgba(BRAND, s.opacity * 0.08));
          gg.addColorStop(1, 'rgba(99,102,241,0)');
          ctx.fillStyle = gg;
          ctx.fillRect(0, s.pos - 35, w, 70);
        } else {
          if (s.pos > w + 30) s.pos = -30;
          const g = ctx.createLinearGradient(s.pos, 0, s.pos, h);
          g.addColorStop(0, rgba(ACCENT, 0));
          g.addColorStop(0.35, rgba(ACCENT, s.opacity));
          g.addColorStop(0.65, rgba(BRAND, s.opacity * 0.5));
          g.addColorStop(1, rgba(ACCENT, 0));
          ctx.fillStyle = g;
          ctx.fillRect(s.pos - s.width / 2, 0, s.width, h);
        }
      }

      // Shield rings
      for (const ring of rings) {
        ring.r += ring.speed;
        ring.opacity = Math.max(0, ring.opacity - 0.002);
        if (ring.r > ring.max) {
          ring.r = 0;
          ring.opacity = 0.45;
        }
        if (ring.opacity > 0.01) {
          ctx.beginPath();
          ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
          ctx.strokeStyle = rgba(ring.color, ring.opacity);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      animId = requestAnimationFrame(draw);
    }

    function onMouse(e: MouseEvent) {
      const r = canvas!.getBoundingClientRect();
      mouseX = e.clientX - r.left;
      mouseY = e.clientY - r.top;
    }
    function offMouse() {
      mouseX = -1000;
      mouseY = -1000;
    }

    resize();
    window.addEventListener('resize', resize);
    canvas.addEventListener('mousemove', onMouse);
    canvas.addEventListener('mouseleave', offMouse);
    animId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
      canvas!.removeEventListener('mousemove', onMouse);
      canvas!.removeEventListener('mouseleave', offMouse);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />;
}
