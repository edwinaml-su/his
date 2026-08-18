// AxisMed by Avante — loading video scenes (uses animations-v2.jsx globals)
// Splash behavior: always play from the start on a fresh page load.
try { localStorage.setItem('animstage:t', '0'); } catch (e) {}
window.__axEndFired = false;
const { SceneStage, useScene, Easing, animate } = window;
const c01 = (v) => Math.max(0, Math.min(1, v));
const A = animate;

const COL = { navy: '#232349', med: '#1D4F9C', bright: '#0C74C2', red: '#D31E26' };
const CX = 640, CY = 360;

// Background is tweakable: gradient tones derive from the chosen base color
function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function mix(a, b, t) {
  const A = hex2rgb(a), B = hex2rgb(b);
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
}

// Theme derives every scene color from the tweakable background
function TH() {
  const base = window.__AX_BG || '#030510';
  const [r, g, b] = hex2rgb(base);
  const light = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55;
  if (light) return {
    light,
    grad: `radial-gradient(1100px 700px at 50% 42%, ${mix(base, '#FFFFFF', 0.55)} 0%, ${base} 60%, ${mix(base, '#000000', 0.13)} 100%)`,
    grid: 'rgba(30,45,90,0.09)', vignette: 'inset 0 0 220px rgba(25,35,70,0.2)',
    trace: mix(base, '#16204A', 0.5), pad: mix(base, '#16204A', 0.62),
    pulseGlow: '#1D4F9C', pulseCore: '#1D4F9C',
    label: '#44506F', pct: '#16204A', track: 'rgba(22,32,74,0.18)',
    title: '#16204A', med: '#0C74C2', sub: '#44506F',
    halo: 'radial-gradient(circle, rgba(29,79,156,0.14) 0%, rgba(29,79,156,0.05) 45%, transparent 68%)',
    nodeShadow: (glow) => `0 0 0 1px rgba(22,32,74,0.08), 0 6px ${22 * glow}px rgba(22,32,74,0.28)`,
    burst: 'rgba(29,79,156,0.6)',
  };
  return {
    light,
    grad: `radial-gradient(1100px 700px at 50% 42%, ${mix(base, '#5A74B8', 0.16)} 0%, ${base} 55%, ${mix(base, '#000000', 0.55)} 100%)`,
    grid: 'rgba(80,110,180,0.06)', vignette: 'inset 0 0 220px rgba(1,3,10,0.9)',
    trace: '#2E4278', pad: '#3D5CA6',
    pulseGlow: '#0C74C2', pulseCore: '#7CC4F4',
    label: '#7E90C4', pct: '#B9C8EE', track: 'rgba(126,144,196,0.22)',
    title: '#FFFFFF', med: '#2E9BE6', sub: '#93A7DA',
    halo: 'radial-gradient(circle, rgba(115,155,220,0.20) 0%, rgba(90,125,190,0.08) 45%, transparent 68%)',
    nodeShadow: (glow) => `0 0 ${34 * glow}px rgba(120,180,255,0.35), 0 0 ${70 * glow}px rgba(211,30,38,${0.45 * glow})`,
    burst: 'rgba(90,160,235,0.8)',
  };
}

// ── Cross geometry (from Isotipo Cruz AVANTE) ────────────────────────────────
const BLOCKS = [
  { c: 1, r: 0, k: 'bright' }, { c: 2, r: 0, k: 'navy' },
  { c: 0, r: 1, k: 'navy' }, { c: 1, r: 1, k: 'med' }, { c: 2, r: 1, k: 'med' }, { c: 3, r: 1, k: 'bright' },
  { c: 0, r: 2, k: 'bright' }, { c: 1, r: 2, k: 'med' }, { c: 2, r: 2, k: 'med' }, { c: 3, r: 2, k: 'navy' },
  { c: 1, r: 3, k: 'navy' }, { c: 2, r: 3, k: 'bright' },
];

// ── Circuit traces (orthogonal PCB paths converging on center) ──────────────
const RAW_PATHS = [
  [[-30, 150], [290, 150], [290, 330], [560, 330]],
  [[-30, 560], [230, 560], [230, 395], [560, 395]],
  [[1310, 170], [1010, 170], [1010, 325], [720, 325]],
  [[1310, 545], [1055, 545], [1055, 392], [720, 392]],
  [[210, -30], [210, 235], [612, 235], [612, 285]],
  [[1075, 750], [1075, 480], [668, 480], [668, 435]],
  [[455, 750], [455, 595], [598, 595], [598, 435]],
  [[875, -30], [875, 145], [682, 145], [682, 285]],
];
const PATHS = RAW_PATHS.map((pts) => {
  let L = 0; const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    segs.push({ a: pts[i - 1], b: pts[i], d }); L += d;
  }
  return { pts, segs, L };
});
function pAt(path, f) {
  let target = f * path.L;
  for (const s of path.segs) {
    if (target <= s.d) { const t = s.d === 0 ? 0 : target / s.d; return [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t]; }
    target -= s.d;
  }
  const last = path.pts[path.pts.length - 1]; return [last[0], last[1]];
}

function Circuit({ draw, pulse, dim }) {
  const th = TH();
  return (
    <svg width="1280" height="720" style={{ position: 'absolute', inset: 0, opacity: dim }}>
      {PATHS.map((p, i) => {
        const dT = Easing.easeInOutCubic(c01((draw - i * 0.045) / 0.7));
        const st = i * 0.06;
        const f = c01((pulse - st) / (1 - st));
        const pt = pAt(p, f);
        const pop = pulse <= 0 || f <= 0.001 || f >= 0.999 ? 0 : Math.min(1, f * 10, (1 - f) * 6 + 0.1);
        return (
          <g key={i}>
            <polyline points={p.pts.map((q) => q.join(',')).join(' ')} fill="none" stroke={th.trace} strokeWidth="2.5" strokeDasharray={p.L} strokeDashoffset={p.L * (1 - dT)} />
            {p.pts.slice(1, -1).map((q, j) => <circle key={j} cx={q[0]} cy={q[1]} r="3.5" fill={th.pad} opacity={dT} />)}
            <circle cx={p.pts[0][0]} cy={p.pts[0][1]} r="5" fill="none" stroke={th.pad} strokeWidth="2" opacity={dT} />
            <g opacity={pop}>
              <circle cx={pt[0]} cy={pt[1]} r="9" fill={th.pulseGlow} opacity="0.3" />
              <circle cx={pt[0]} cy={pt[1]} r="4" fill={th.pulseCore} />
            </g>
          </g>
        );
      })}
    </svg>
  );
}

function Bg({ cam = 1, children, hud }) {
  const th = TH();
  return (
    <div style={{ position: 'absolute', inset: 0, background: th.grad, overflow: 'hidden', fontFamily: "'Sora',sans-serif" }}>
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${cam})`, transformOrigin: '640px 360px' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: `linear-gradient(${th.grid} 1px, transparent 1px),linear-gradient(90deg, ${th.grid} 1px, transparent 1px)`, backgroundSize: '80px 80px' }} />
        {children}
      </div>
      <div style={{ position: 'absolute', inset: 0, boxShadow: th.vignette, pointerEvents: 'none' }} />
      {hud}
    </div>
  );
}

// Soft light halo that lifts the cross off the dark board
function Halo({ op = 1, size = 760 }) {
  return <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: size, height: size, borderRadius: '50%', background: TH().halo, opacity: op, pointerEvents: 'none' }} />;
}

// Center node: white circle + red core (the logo's heart)
function Node({ w, glow = 1, op = 1 }) {
  return (
    <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: w, height: w, borderRadius: '50%', background: '#fff', opacity: op, boxShadow: TH().nodeShadow(glow), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '62.5%', height: '62.5%', borderRadius: '50%', background: COL.red }} />
    </div>
  );
}

// The cross, assembled from blocks; white lines grow separately. No center dot
// (Node renders it so scenes 1→3 share one continuous element).
function Cross({ size, asm = 1, lines = 1 }) {
  const cell = size / 4;
  const lw = size * 0.045;
  const le = Easing.easeInOutCubic(c01(lines));
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      {BLOCKS.map((b, i) => {
        const d = Math.abs(b.c + 0.5 - 2) + Math.abs(b.r + 0.5 - 2);
        const delay = (d - 1) * 0.3 + (i % 4) * 0.05;
        const e = c01((asm - delay) / 0.45);
        const ee = Easing.easeOutCubic(e);
        const off = (1 - ee) * 120;
        return (
          <div key={i} style={{
            position: 'absolute', left: b.c * cell, top: b.r * cell, width: cell + 0.6, height: cell + 0.6,
            background: COL[b.k], opacity: Math.min(1, e * 1.7),
            transform: `translate(${((b.c + 0.5 - 2) / 2) * off}px, ${((b.r + 0.5 - 2) / 2) * off}px) scale(${0.55 + 0.45 * ee})`,
            boxShadow: ee < 1 ? `0 0 ${26 * (1 - ee)}px rgba(12,116,194,0.7)` : '0 10px 30px rgba(0,0,0,0.5)',
          }} />
        );
      })}
      <div style={{ position: 'absolute', left: size / 2 - lw / 2, top: 0, width: lw, height: size, background: '#fff', transform: `scaleY(${le})` }} />
      <div style={{ position: 'absolute', top: size / 2 - lw / 2, left: 0, height: lw, width: size, background: '#fff', transform: `scaleX(${le})` }} />
    </div>
  );
}

function Loading({ pct, es, en, op = 1 }) {
  const th = TH();
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 44, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, opacity: op, fontFamily: "'Sora',sans-serif" }}>
      <div style={{ width: 400, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 11, letterSpacing: '0.18em', color: th.label, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{es} · {en}</span>
        <span style={{ fontSize: 12, color: th.pct, fontVariantNumeric: 'tabular-nums' }}>{Math.round(pct)}%</span>
      </div>
      <div style={{ width: 400, height: 3, borderRadius: 2, background: th.track }}>
        <div style={{ width: `${pct}%`, height: 3, borderRadius: 2, background: 'linear-gradient(90deg,#1D4F9C,#0C74C2)' }} />
      </div>
    </div>
  );
}

// ── Scene 1: the circuit board wakes up, energy converges on the core ───────
function Circuito({ localTime }) {
  const { progress: p } = useScene();
  const cam = A({ from: 1.12, to: 1, start: 0, end: 0.9, ease: Easing.easeInOutQuad })(p);
  const draw = A({ from: 0, to: 1, start: 0.03, end: 0.66, ease: Easing.linear })(p);
  const pulse = A({ from: 0, to: 1, start: 0.42, end: 0.97, ease: Easing.easeInQuad })(p);
  const nodeOp = A({ from: 0, to: 1, start: 0.3, end: 0.5, ease: Easing.easeOutQuad })(p);
  const glow = A({ from: 0.2, to: 1, start: 0.6, end: 0.96, ease: Easing.easeOutQuad })(p);
  const pct = 38 * A({ from: 0, to: 1, start: 0.04, end: 1, ease: Easing.easeOutQuad })(p);
  if (window.__axEndFired) { window.__axEndFired = false; setTimeout(() => window.dispatchEvent(new Event('axismed-video-rewind')), 0); }
  return (
    <div data-screen-label={`Circuito ${localTime.toFixed(1)}s`} style={{ position: 'absolute', inset: 0 }}>
      <Bg cam={cam} hud={<Loading pct={pct} es="Iniciando sistema" en="System loading" />}>
        <Circuit draw={draw} pulse={pulse} dim={1} />
        <div style={{ position: 'absolute', left: CX - 40, top: CY - 40, width: 80, height: 80 }}>
          <Node w={26} glow={glow} op={nodeOp} />
        </div>
      </Bg>
    </div>
  );
}

// ── Scene 2: the cross assembles out of the board ────────────────────────────
function Cruz({ localTime }) {
  const { progress: p } = useScene();
  const cam = 1 + 0.035 * Math.sin(Math.PI * c01((p - 0.05) / 0.9));
  const dim = A({ from: 1, to: 0.18, start: 0.08, end: 0.52, ease: Easing.easeInOutQuad })(p);
  const asm = A({ from: 0, to: 1, start: 0.06, end: 0.72, ease: Easing.linear })(p);
  const lines = A({ from: 0, to: 1, start: 0.6, end: 0.84, ease: Easing.linear })(p);
  const nodeW = A({ from: 26, to: 48, start: 0.58, end: 0.86, ease: Easing.easeOutBack })(p);
  const glow = A({ from: 1, to: 0.7, start: 0.3, end: 0.9, ease: Easing.easeInOutQuad })(p);
  const burstR = A({ from: 0, to: 560, start: 0.04, end: 0.45, ease: Easing.easeOutCubic })(p);
  const burstO = A({ from: 0.45, to: 0, start: 0.04, end: 0.48, ease: Easing.easeOutQuad })(p);
  const pct = 38 + 38 * A({ from: 0, to: 1, start: 0, end: 1, ease: Easing.easeInOutQuad })(p);
  if (window.__axEndFired) { window.__axEndFired = false; setTimeout(() => window.dispatchEvent(new Event('axismed-video-rewind')), 0); }
  return (
    <div data-screen-label={`Cruz ${(2.4 + localTime).toFixed(1)}s`} style={{ position: 'absolute', inset: 0 }}>
      <Bg cam={cam} hud={<Loading pct={pct} es="Cargando módulos" en="Loading modules" />}>
        <Circuit draw={1} pulse={0} dim={dim} />
        <div style={{ position: 'absolute', left: CX, top: CY, width: 0, height: 0 }}>
          <Halo op={A({ from: 0, to: 1, start: 0.15, end: 0.7, ease: Easing.easeOutQuad })(p)} />
        </div>
        <div style={{ position: 'absolute', left: CX - burstR, top: CY - burstR, width: burstR * 2, height: burstR * 2, borderRadius: '50%', border: `2px solid ${TH().burst}`, opacity: burstO }} />
        <div style={{ position: 'absolute', left: CX - 150, top: CY - 150 }}>
          <Cross size={300} asm={asm} lines={lines} />
        </div>
        <div style={{ position: 'absolute', left: CX - 40, top: CY - 40, width: 80, height: 80 }}>
          <Node w={nodeW} glow={glow} />
        </div>
      </Bg>
    </div>
  );
}

// ── Scene 3: the cross slides left; AxisMed by Avante takes the stage ───────
function Marca({ localTime }) {
  const { progress: p } = useScene();
  const th = TH();
  const cam = A({ from: 1, to: 1.018, start: 0.1, end: 0.9, ease: Easing.easeInOutQuad })(p);
  const shift = A({ from: 0, to: -230, start: 0.06, end: 0.32, ease: Easing.easeInOutCubic })(p);
  const ty = A({ from: 0, to: -118, start: 0.06, end: 0.32, ease: Easing.easeInOutCubic })(p);
  const scl = A({ from: 1, to: 0.8, start: 0.06, end: 0.32, ease: Easing.easeInOutCubic })(p);
  const rev = A({ from: 0, to: 1, start: 0.18, end: 0.4, ease: Easing.easeInOutCubic })(p);
  const subE = A({ from: 0, to: 1, start: 0.3, end: 0.44, ease: Easing.easeOutCubic })(p);
  const barW = A({ from: 0, to: 46, start: 0.34, end: 0.46, ease: Easing.easeOutCubic })(p);
  const pct = 76 + 24 * A({ from: 0, to: 1, start: 0.05, end: 0.3, ease: Easing.easeOutQuad })(p);
  const loadOp = A({ from: 1, to: 0, start: 0.45, end: 0.55, ease: Easing.easeInOutQuad })(p);
  // Hold the settled lockup ~2s (p 0.46–0.82 at dur 5.5), then dock top-center above the login
  const gs = A({ from: 1, to: 0.35, start: 0.82, end: 0.97, ease: Easing.easeInOutCubic })(p);
  const gx = A({ from: 0, to: 405, start: 0.82, end: 0.97, ease: Easing.easeInOutCubic })(p);
  const gy = A({ from: 0, to: -25, start: 0.82, end: 0.97, ease: Easing.easeInOutCubic })(p);
  if (p >= 0.985 && !window.__axEndFired) { window.__axEndFired = true; setTimeout(() => window.dispatchEvent(new Event('axismed-video-end')), 0); }
  if (p < 0.9 && window.__axEndFired) { window.__axEndFired = false; setTimeout(() => window.dispatchEvent(new Event('axismed-video-rewind')), 0); }
  return (
    <div data-screen-label={`Marca ${(6.4 + localTime).toFixed(1)}s`} style={{ position: 'absolute', inset: 0 }}>
      <Bg cam={cam} hud={<Loading pct={pct} es={pct >= 100 ? 'Listo' : 'Finalizando'} en={pct >= 100 ? 'Ready' : 'Finishing'} op={loadOp} />}>
        <Circuit draw={1} pulse={0} dim={0.18} />
        <div style={{ position: 'absolute', inset: 0, transform: `translate(${gx}px, ${gy}px) scale(${gs})`, transformOrigin: '0 0' }}>
        <div style={{ position: 'absolute', left: CX - 150, top: CY - 150, width: 300, height: 300, transform: `translate(${shift}px, ${ty}px) scale(${scl})` }}>
          <Halo />
          <Cross size={300} />
          <Node w={48} glow={0.7} />
        </div>
        <div style={{ position: 'absolute', left: 585, top: CY - 86 + ty }}>
          <div style={{ clipPath: `inset(-40px ${(1 - rev) * 100}% -40px 0)`, transform: `translateX(${(1 - rev) * 36}px)` }}>
            <div style={{ fontSize: 100, fontWeight: 700, color: th.title, letterSpacing: '-0.015em', lineHeight: 1, whiteSpace: 'nowrap' }}>
              Axis<span style={{ color: th.med }}>Med</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 20, opacity: subE, transform: `translateY(${(1 - subE) * 14}px)` }}>
            <div style={{ width: barW, height: 3, background: COL.red }} />
            <div style={{ fontSize: 21, letterSpacing: '0.42em', color: th.sub, fontWeight: 300, whiteSpace: 'nowrap' }}>BY AVANTE</div>
          </div>
        </div>
        </div>
      </Bg>
    </div>
  );
}

function AxisMedVideo() {
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
  // Splash autoplay: if the host transport parked the engine on load,
  // rewind and press play once (~0.7s after mount). Only touches a
  // paused-at-load state; never interferes with user scrubbing later.
  React.useEffect(() => {
    const id = setTimeout(() => {
      const play = document.querySelector('button[title="Play/pause (space)"]');
      const rew = document.querySelector('button[title="Return to start (0)"]');
      if (!play) return;
      const paused = play.innerHTML.indexOf('rect') === -1;
      if (paused) {
        const tt = parseFloat(localStorage.getItem('animstage:t') || '0');
        if (tt > 0.2 && rew) rew.click();
        window.__axEndFired = false;
        play.click();
      }
    }, 700);
    return () => clearTimeout(id);
  }, []);
  window.__AX_BG = t.videoBg || '#030510';
  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '1280 / 764', lineHeight: 1.4 }}>
      <SceneStage width={1280} height={720} scenes={window.OM_SCENES} playback={window.OM_PLAYBACK} bg={t.videoBg || '#030510'}>
        {{ Circuito: Circuito, Cruz: Cruz, Marca: Marca }}
      </SceneStage>
      <TweaksPanel>
        <TweakSection label="Video" />
        <TweakColor label="Fondo del video" value={t.videoBg} options={['#030510', '#081A38', '#0E2B23', '#1A1026', '#FFC93C', '#FFEFAE', '#FDF6EC', '#F4F7FB', '#DCE8F5', '#D9E9DC', '#EFDFF2', '#FFDAC4']} onChange={(v) => setTweak('videoBg', v)} />
        <TweakSection label="Editor" />
        <TweakToggle label="Motion editor" value={t.motionEditor} onChange={(v) => setTweak('motionEditor', v)} />
      </TweaksPanel>
    </div>
  );
}
window.AxisMedVideo = AxisMedVideo;
