// First-person 3D renderer for the shared 2D game world. World px -> meters via U.
import * as THREE from "three";
import { BATTERIES, DOORS, DOOR_W, EXIT, KEYS, LIFTS, ROOMS, WALLS, WORLD, type MapId } from "./game";
import { audio } from "./audio";
import { CHARACTERS, isChar, type CharId } from "./art";
import { buildAvatar, nameTag, type Avatar } from "./avatar3d";

export const U = 1 / 50;
/** Weak/old Android phones: lower resolution, cheaper lights and materials, 30 fps. */
export const LOW_END = typeof navigator !== "undefined" && typeof window !== "undefined" && (
  ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4 || (navigator.hardwareConcurrency ?? 8) <= 4 ||
  (/Android/i.test(navigator.userAgent) && Math.min(screen.width, screen.height) * (window.devicePixelRatio || 1) < 1100));
const MOBILE = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
const Mat = (p: THREE.MeshStandardMaterialParameters) => (LOW_END ? new THREE.MeshLambertMaterial({ color: p.color ?? 0xffffff, map: p.map ?? null, emissive: p.emissive ?? 0, emissiveIntensity: p.emissiveIntensity ?? 1, transparent: p.transparent ?? false, opacity: p.opacity ?? 1 }) as unknown as THREE.MeshStandardMaterial : new THREE.MeshStandardMaterial(p));
export const EYE = 1.6;
const WALL_H = 3.2;

function canvasTex(draw: (g: CanvasRenderingContext2D, s: number) => void, repeat: number) {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  draw(c.getContext("2d")!, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const woodTex = (base: string) => canvasTex((g, s) => {
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = `rgba(0,0,0,${0.15 + (i % 3) * 0.08})`; g.fillRect(0, i * 32, s, 2);
    for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; g.fillRect(Math.random() * s, i * 32 + Math.random() * 30, 20 + Math.random() * 60, 1); }
  }
}, 1);
const wallTex = canvasTex((g, s) => {
  g.fillStyle = "#4a3a34"; g.fillRect(0, 0, s, s);
  for (let x = 0; x < s; x += 32) { g.fillStyle = "rgba(0,0,0,.18)"; g.fillRect(x, 0, 3, s); g.fillStyle = "rgba(120,90,70,.15)"; for (let y = 8; y < s; y += 40) g.fillRect(x + 12, y, 8, 8); }
  for (let k = 0; k < 6; k++) { const x = Math.random() * s; const gr = g.createLinearGradient(x, 0, x, s); gr.addColorStop(0, "rgba(40,10,10,.5)"); gr.addColorStop(1, "rgba(40,10,10,0)"); g.fillStyle = gr; g.fillRect(x, 0, 4 + Math.random() * 6, s * Math.random()); }
  g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(0, s - 30, s, 30);
}, 1);

const tileTex = (a: string, line: string) => canvasTex((g, s) => { g.fillStyle = a; g.fillRect(0, 0, s, s); g.fillStyle = line; for (let i = 0; i <= s; i += 64) { g.fillRect(i, 0, 3, s); g.fillRect(0, i, s, 3); } for (let k = 0; k < 8; k++) { g.fillStyle = `rgba(90,60,30,${Math.random() * 0.15})`; g.beginPath(); g.arc(Math.random() * s, Math.random() * s, 10 + Math.random() * 30, 0, 7); g.fill(); } }, 1);
const carpetTex = (base: string) => canvasTex((g, s) => { g.fillStyle = base; g.fillRect(0, 0, s, s); g.strokeStyle = "rgba(210,170,80,.35)"; g.lineWidth = 3; for (let i = 0; i < s; i += 64) for (let j = 0; j < s; j += 64) { g.beginPath(); g.moveTo(i + 32, j + 4); g.lineTo(i + 60, j + 32); g.lineTo(i + 32, j + 60); g.lineTo(i + 4, j + 32); g.closePath(); g.stroke(); } }, 1);
const wallpaperTex = canvasTex((g, s) => { g.fillStyle = "#3a2a1c"; g.fillRect(0, 0, s, s); for (let x = 0; x < s; x += 32) { g.fillStyle = "rgba(200,160,90,.18)"; g.fillRect(x, 0, 10, s); } g.fillStyle = "#24180f"; g.fillRect(0, s - 50, s, 50); g.fillStyle = "rgba(200,160,90,.5)"; g.fillRect(0, s - 52, s, 3); }, 1);
const stoneTex = canvasTex((g, s) => { g.fillStyle = "#3b3d3a"; g.fillRect(0, 0, s, s); for (let y = 0; y < s; y += 32) for (let x = (y / 32) % 2 ? 0 : 24; x < s; x += 48) { g.fillStyle = `rgba(${70 + Math.random() * 30},${72 + Math.random() * 30},${68 + Math.random() * 20},1)`; g.fillRect(x + 2, y + 2, 44, 28); } g.fillStyle = "rgba(40,70,30,.35)"; for (let k = 0; k < 200; k++) g.fillRect(Math.random() * s, Math.random() * s, 3, 3); }, 1);

/** Per-map atmosphere: flickering hospital neon, cemetery moon + drifting smoke, hotel lifts. */
function buildTheme(scene: THREE.Scene, map: MapId) {
  const ups: ((t: number, dt: number, cam: { x: number; y: number }) => void)[] = [];
  if (map === "rumahsakit") {
    const tubes: { mat: THREE.MeshBasicMaterial; light: THREE.PointLight; next: number; on: boolean; seed: number }[] = [];
    for (const r of ROOMS) for (const [fx, fy] of [[0.3, 0.35], [0.7, 0.65]] as const) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xe8fff4 });
      const tube = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.18), mat);
      const x = (r.x + r.w * fx) * U, z = (r.y + r.h * fy) * U;
      tube.position.set(x, WALL_H - 0.05, z); scene.add(tube);
      const light = new THREE.PointLight(0xd8ffef, LOW_END ? 6 : 9, 9, 1.6); light.position.set(x, WALL_H - 0.3, z); scene.add(light);
      tubes.push({ mat, light, next: 0, on: true, seed: Math.random() });
    }
    // hospital beds (decor)
    const bedMat = Mat({ color: 0xd9dde0, roughness: 0.6 }), sheet = Mat({ color: 0x8fb5a5, roughness: 0.9 });
    for (const [bx, by] of [[150, 420], [300, 80], [880, 420], [1300, 470], [380, 900], [620, 560]] as const) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 2.0), bedMat); b.position.set(bx * U, 0.25, by * U);
      const sh = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.08, 1.4), sheet); sh.position.set(bx * U, 0.54, by * U + 0.2); scene.add(b, sh);
    }
    let buzzT = 0;
    ups.push((t) => {
      for (const tb of tubes) {
        if (t > tb.next) { tb.on = !tb.on || Math.random() < 0.3; tb.next = t + (tb.on ? 0.6 + Math.random() * 3 * (1 - tb.seed * 0.7) : 0.04 + Math.random() * 0.25); }
        const v = tb.on ? 1 : 0.05;
        tb.light.intensity = (LOW_END ? 6 : 9) * v; tb.mat.color.setScalar(0.15 + 0.85 * v);
      }
      if (t > buzzT) { buzzT = t + 6 + Math.random() * 6; audio.creak(); }
    });
  }
  if (map === "kuburan") {
    const moon = new THREE.DirectionalLight(0x8aa0d8, LOW_END ? 0.5 : 0.35); moon.position.set(-10, 20, -6); scene.add(moon);
    const disc = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), new THREE.MeshBasicMaterial({ color: 0xdfe6ff, fog: false })); disc.position.set(-20, 26, -18); scene.add(disc);
    const smokeTex = canvasTex((g, s) => { const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); gr.addColorStop(0, "rgba(200,210,230,.55)"); gr.addColorStop(1, "rgba(200,210,230,0)"); g.fillStyle = gr; g.fillRect(0, 0, s, s); }, 1);
    smokeTex.repeat.set(1, 1);
    const puffs: { s: THREE.Sprite; vx: number; vz: number; ph: number }[] = [];
    for (let i = 0; i < (LOW_END ? 30 : 70); i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0.35 }));
      const sz = 2 + Math.random() * 3; sp.scale.set(sz, sz * 0.6, 1);
      sp.position.set(Math.random() * WORLD.w * U, 0.3 + Math.random() * 1.2, Math.random() * WORLD.h * U); scene.add(sp);
      puffs.push({ s: sp, vx: 0.15 + Math.random() * 0.25, vz: (Math.random() - 0.5) * 0.15, ph: Math.random() * 6 });
    }
    // dead trees
    const bark = Mat({ color: 0x2a1f18, roughness: 1 });
    for (const [tx, ty] of [[60, 60], [460, 460], [560, 60], [960, 470], [60, 960], [1440, 520], [700, 940]] as const) {
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.25, 4, 6), bark); tr.position.set(tx * U, 2, ty * U); scene.add(tr);
      for (let k = 0; k < 3; k++) { const br = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.08, 1.6, 5), bark); br.position.set(tx * U, 2.8 + k * 0.4, ty * U); br.rotation.set(0.9, k * 2.1, 0.5); scene.add(br); }
    }
    ups.push((t, dt) => {
      for (const p of puffs) {
        p.s.position.x += p.vx * dt; p.s.position.z += p.vz * dt; p.s.position.y += Math.sin(t + p.ph) * 0.002;
        if (p.s.position.x > WORLD.w * U) p.s.position.x = 0;
        (p.s.material as THREE.SpriteMaterial).opacity = 0.25 + Math.sin(t * 0.5 + p.ph) * 0.12;
      }
    });
  }
  if (map === "hotel") {
    const metal = Mat({ color: 0x9a9aa2, metalness: 0.8, roughness: 0.3 });
    const gold = Mat({ color: 0xc9a040, emissive: 0x3a2a00, metalness: 0.7, roughness: 0.3 });
    const labels: THREE.Mesh[] = [];
    for (const l of LIFTS) {
      const g = new THREE.Group(); g.position.set(l.x * U, 0, l.y * U); scene.add(g);
      const zs = l.floor === 1 ? 1 : -1; // back wall sits against the solid floor divider
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, WALL_H, 0.1), metal); back.position.set(0, WALL_H / 2, zs * 0.85); g.add(back);
      for (const sx of [-1, 1]) { const side = new THREE.Mesh(new THREE.BoxGeometry(0.1, WALL_H, 1.7), metal); side.position.set(sx * 0.9, WALL_H / 2, 0); g.add(side); }
      const floor = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.04, 1.7), gold); floor.position.y = 0.02; g.add(floor);
      const c = document.createElement("canvas"); c.width = 256; c.height = 96; const x = c.getContext("2d")!;
      x.fillStyle = "#120a04"; x.fillRect(0, 0, 256, 96); x.fillStyle = "#ffb030"; x.font = "bold 44px monospace"; x.textAlign = "center"; x.fillText(`LIFT ${l.floor === 1 ? "▲" : "▼"} ${l.floor}`, 128, 62);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const lab = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.45), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })); lab.position.set(0, WALL_H - 0.4, zs * 0.79); g.add(lab); labels.push(lab);
      const lt = new THREE.PointLight(0xffc870, 5, 5); lt.position.set(0, WALL_H - 0.5, 0); g.add(lt);
    }
    // chandeliers
    for (const r of ROOMS) { const lt = new THREE.PointLight(0xffb060, LOW_END ? 3 : 4, 7, 1.8); lt.position.set((r.x + r.w / 2) * U, WALL_H - 0.4, (r.y + r.h / 2) * U); scene.add(lt); const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd090 })); bulb.position.copy(lt.position); scene.add(bulb); }
  }
  return { update: (t: number, dt: number, cam: { x: number; y: number }) => ups.forEach((u) => u(t, dt, cam)) };
}

type Ent = { sprite: THREE.Sprite; light?: THREE.PointLight };

export function createScene(canvas: HTMLCanvasElement, opts: { me: CharId | "ghost"; amGhost: boolean; imgs: Record<string, string>; drone?: boolean; map?: MapId }) {
  const MAP = opts.map ?? "rumah";
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !MOBILE && !LOW_END, powerPreference: LOW_END ? "low-power" : "high-performance" });
  renderer.setPixelRatio(LOW_END ? 0.75 : MOBILE ? Math.min(1.25, window.devicePixelRatio || 1) : Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = LOW_END ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  // ghost sees in the dark: bright violet "night vision", thin fog
  const fogCol = opts.amGhost ? 0x1c0a2a : MAP === "kuburan" ? 0x070a14 : 0x000000;
  scene.background = new THREE.Color(fogCol);
  scene.fog = new THREE.FogExp2(fogCol, opts.drone ? 0.035 : opts.amGhost ? 0.035 : 0.11);
  if (opts.drone) scene.add(new THREE.HemisphereLight(0x8899cc, 0x221111, 1.4));
  const camera = new THREE.PerspectiveCamera(72, 1, 0.05, opts.drone ? 260 : 60);
  camera.rotation.order = "YXZ";
  scene.add(camera);
  scene.add(new THREE.HemisphereLight(opts.amGhost ? 0xc9a0ff : 0x2a2440, opts.amGhost ? 0x402050 : 0x080404, opts.amGhost ? 2.6 : LOW_END ? 0.32 : 0.22));
  if (opts.amGhost) scene.add(new THREE.AmbientLight(0x9070c0, 0.8));
  // drone night vision (toggled from the drone HUD)
  const nv = new THREE.AmbientLight(0x80ff9a, 0); scene.add(nv);

  // floors and ceilings per room
  const ceilings: THREE.Mesh[] = [];
  let nvOn = false;
  for (const r of ROOMS) {
    const outdoor = MAP === "kuburan" || (MAP === "rumah" && r.name.startsWith("Kuburan"));
    const tex = MAP === "rumahsakit" ? tileTex("#c9d6cf", "#9fb0a8") : MAP === "hotel" ? carpetTex(r.y < 500 ? "#5a1018" : "#18304a") : outdoor ? canvasTex((g, s) => { g.fillStyle = "#1a2414"; g.fillRect(0, 0, s, s); for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${40 + Math.random() * 40},${60 + Math.random() * 50},30,.6)`; g.fillRect(Math.random() * s, Math.random() * s, 2, 5); } }, 1) : woodTex(r.floor === "#18222a" ? "#2b3a40" : "#4a2e1e");
    tex.repeat.set(r.w * U / 3, r.h * U / 3);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(r.w * U, r.h * U), Mat({ map: tex, roughness: 0.9 }));
    f.rotation.x = -Math.PI / 2; f.position.set((r.x + r.w / 2) * U, 0, (r.y + r.h / 2) * U); scene.add(f);
    if (!outdoor) {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(r.w * U, r.h * U), Mat({ color: 0x1a1414, roughness: 1 }));
      c.rotation.x = Math.PI / 2; c.position.set((r.x + r.w / 2) * U, WALL_H, (r.y + r.h / 2) * U); scene.add(c); ceilings.push(c);
    }
  }
  // walls & furniture (first boxes are structural walls; thin ones => walls)
  const wallMat = MAP === "rumahsakit" ? Mat({ map: tileTex("#dfe8e2", "#b8c6bf"), roughness: 0.6 }) : MAP === "hotel" ? Mat({ map: wallpaperTex, roughness: 0.9 }) : MAP === "kuburan" ? Mat({ map: stoneTex, roughness: 1 }) : Mat({ map: wallTex, roughness: 0.95 });
  const WALL_HM = MAP === "kuburan" ? 1.5 : WALL_H;
  const furnMat = Mat({ map: woodTex("#3a2214"), roughness: 0.8 });
  for (const w of WALLS) {
    const isWall = Math.min(w.w, w.h) <= 20;
    const h = isWall ? WALL_HM : 0.9;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w.w * U, h, w.h * U), isWall ? wallMat : furnMat);
    m.position.set((w.x + w.w / 2) * U, h / 2, (w.y + w.h / 2) * U); scene.add(m);
  }
  // doors (auto-swing open when anyone is near)
  const doorMat = Mat({ map: woodTex("#4a2c18"), roughness: 0.9 });
  const doors = DOORS.map((d) => {
    const pivot = new THREE.Group();
    const w = DOOR_W * U * 0.96, h = WALL_H * 0.85;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), doorMat);
    panel.position.set(w / 2, h / 2, 0);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), Mat({ color: 0xc9a040 }));
    knob.position.set(w - 0.15, h * 0.5, 0.07); pivot.add(panel, knob);
    if (d.v) { pivot.position.set(d.x * U, 0, (d.y - DOOR_W / 2) * U); pivot.rotation.y = -Math.PI / 2; }
    else pivot.position.set((d.x - DOOR_W / 2) * U, 0, d.y * U);
    scene.add(pivot);
    return { d, pivot, base: pivot.rotation.y, open: 0, was: false };
  });
  const theme = buildTheme(scene, MAP);
  // graves
  const graveMat = Mat({ color: 0x5a5d58, roughness: 1 });
  for (const [gx, gy] of (MAP === "kuburan" ? [[1060, 600], [1260, 640], [1380, 880], [1080, 900], [120, 300], [380, 120], [640, 330], [880, 160], [1320, 420], [220, 820], [600, 860], [900, 640]] : MAP === "rumah" ? [[1060, 600], [1260, 640], [1380, 880], [1080, 900]] : []) as [number, number][]) {
    const g = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.2), graveMat); g.position.set((gx + 17) * U, 0.55, (gy + 22) * U); g.rotation.z = 0.08; scene.add(g);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.2, 16, 1, false, 0, Math.PI), graveMat); top.rotation.set(Math.PI / 2, 0, Math.PI / 2); top.position.set((gx + 17) * U, 1.1, (gy + 22) * U); scene.add(top);
  }
  // exit gate
  const gateMat = Mat({ color: 0x8b0d17, emissive: 0x8b0d17, emissiveIntensity: 0.6 });
  const gate = new THREE.Mesh(new THREE.TorusGeometry(EXIT.r * U, 0.08, 8, 32), gateMat);
  gate.position.set(EXIT.x * U, EXIT.r * U + 0.1, EXIT.y * U); gate.rotation.y = Math.PI / 2; scene.add(gate);
  const gateLight = new THREE.PointLight(0x8b0d17, 2, 5); gateLight.position.copy(gate.position); scene.add(gateLight);

  const tl = new THREE.TextureLoader();
  const texCache: Record<string, THREE.Texture> = {};
  const tex = (k: string) => (texCache[k] ??= (() => { const t = tl.load(opts.imgs[k]!); t.colorSpace = THREE.SRGBColorSpace; return t; })());
  const sprite = (k: string, w: number, h: number) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(k), transparent: true, alphaTest: 0.1 }));
    s.scale.set(w, h, 1); scene.add(s); return s;
  };
  const keys = KEYS.map((k) => { const s = sprite("key", 0.6, 0.3); s.position.set(k.x * U, 0.6, k.y * U); const l = new THREE.PointLight(0xffc840, 0.8, 2.5); l.position.copy(s.position); if (!LOW_END) scene.add(l); return { sprite: s, light: l } as Ent; });
  const bats = BATTERIES.map((b) => { const s = sprite("bat", 0.25, 0.4); s.position.set(b.x * U, 0.3, b.y * U); const l = new THREE.PointLight(0x60ff80, 0.5, 1.8); l.position.copy(s.position); if (!LOW_END) scene.add(l); return { sprite: s, light: l } as Ent; });
  const npcSprites: Record<string, THREE.Sprite> = {};
  const players: Record<string, { sprite: THREE.Sprite | null; av: Avatar | null; tag: THREE.Sprite | null; light: THREE.SpotLight; target: THREE.Object3D; shout: THREE.Sprite }> = {};

  // flashlight (attached to camera)
  const flash = new THREE.SpotLight(0xfff1d0, 30, 22, 0.42, 0.45, 1.6);
  flash.position.set(0.25, -0.25, 0); camera.add(flash);
  const ft = new THREE.Object3D(); ft.position.set(0, -0.1, -5); camera.add(ft); flash.target = ft;
  // viewmodel hand holding torch
  const vm = new THREE.Group(); camera.add(vm);
  const look = opts.me === "ghost" ? null : CHARACTERS[opts.me];
  if (look) {
    const sleeve = Mat({ color: look.top, roughness: 0.9 });
    const skin = Mat({ color: 0xd9a77e, roughness: 0.7 });
    const metal = Mat({ color: look.torch, metalness: 0.7, roughness: 0.35 });
    // forearm (rounded sleeve) + cuff + palm + 4 curled fingers + thumb wrapped round the torch
    const cap = (r: number, l: number, m: THREE.Material) => new THREE.Mesh(new THREE.CapsuleGeometry(r, l, LOW_END ? 3 : 6, LOW_END ? 6 : 12), m);
    const buildHand = (side: 1 | -1, holding: boolean) => {
      const g = new THREE.Group();
      const fore = cap(0.055, 0.36, sleeve); fore.rotation.x = Math.PI / 2; fore.position.set(0, 0, 0.12);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.04, 14), skin); cuff.rotation.x = Math.PI / 2; cuff.position.set(0, 0, -0.08);
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.045, 0.09), skin); palm.position.set(0, 0, -0.14);
      g.add(fore, cuff, palm);
      for (let i = 0; i < 4; i++) {
        const f = cap(0.012, holding ? 0.03 : 0.05, skin);
        f.position.set(-0.03 + i * 0.02, holding ? 0.025 : -0.005, holding ? -0.19 : -0.205);
        f.rotation.x = holding ? -0.2 : Math.PI / 2 + 0.25; g.add(f);
      }
      const th = cap(0.013, 0.035, skin); th.position.set(side * -0.05, 0.02, -0.15); th.rotation.set(0.6, 0, side * 0.9); g.add(th);
      return g;
    };
    const rightH = buildHand(1, true); rightH.position.set(0.28, -0.3, -0.42); rightH.rotation.x = 0.12;
    const leftH = buildHand(-1, false); leftH.position.set(-0.33, -0.38, -0.38); leftH.rotation.set(0.25, 0.15, 0.1);
    const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.26, 14), metal); torch.rotation.x = Math.PI / 2; torch.position.set(0.28, -0.27, -0.66);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.035, 0.08, 14), metal); head.rotation.x = Math.PI / 2; head.position.set(0.28, -0.27, -0.82);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.042, 16), new THREE.MeshBasicMaterial({ color: 0xfff6d8 })); lens.position.set(0.28, -0.27, -0.861);
    vm.add(rightH, leftH, torch, head, lens);
    vm.userData["lens"] = lens;
  } else {
    // ghost: smoky dark claws
    const smoke = Mat({ color: 0x1a0a22, emissive: 0x400010, transparent: true, opacity: 0.85 });
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.3, 6), smoke); c.rotation.x = -Math.PI / 2 - 0.3; c.position.set(sx * 0.32 + (i - 1) * 0.05, -0.35, -0.55); vm.add(c); }
    flash.color.set(0x9a2040); flash.intensity = 6;
  }
  vm.traverse((o) => { o.renderOrder = 10; const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) { m.depthTest = false; (m as THREE.MeshStandardMaterial).fog = false; } });

  // admin cinematic drone: quadcopter with spinning rotors and blinking LEDs, visible to players
  const drone = new THREE.Group(); drone.visible = false; scene.add(drone);
  const dBody = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.34), Mat({ color: 0x1a1a1f, metalness: 0.6, roughness: 0.4 })); drone.add(dBody);
  const rotors: THREE.Mesh[] = [];
  for (const [ax, az] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.03, 0.04), Mat({ color: 0x2a2a30 })); arm.position.set(ax * 0.16, 0, az * 0.16); arm.rotation.y = ax * az > 0 ? -Math.PI / 4 : Math.PI / 4; drone.add(arm);
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.01, 0.04), Mat({ color: 0xbbbbbb, transparent: true, opacity: 0.7 })); r.position.set(ax * 0.27, 0.06, az * 0.27); drone.add(r); rotors.push(r);
  }
  const ledR = new THREE.Mesh(new THREE.SphereGeometry(0.03), new THREE.MeshBasicMaterial({ color: 0xff2030 })); ledR.position.set(-0.12, -0.06, 0.17);
  const ledG = new THREE.Mesh(new THREE.SphereGeometry(0.03), new THREE.MeshBasicMaterial({ color: 0x30ff60 })); ledG.position.set(0.12, -0.06, 0.17);
  const dLight = new THREE.PointLight(0xff3040, 1.2, 3); dLight.position.y = -0.15; drone.add(ledR, ledG, dLight);
  let bobT = 0, vmX = 0;
  return {
    resize() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); vmX = w < h ? -0.13 : 0; vm.scale.setScalar(w < h ? 0.8 : 1);
    },
    ensurePlayer(id: string, k: string, isHunter: boolean, name = "") {
      if (players[id]) return;
      const av = isHunter && isChar(k) ? buildAvatar(k, Mat as unknown as (p: THREE.MeshStandardMaterialParameters) => THREE.Material, LOW_END) : null;
      if (av) scene.add(av.root);
      const s = av ? null : sprite(k, isHunter ? 1.15 : 1.9, isHunter ? 1.6 : 2.4);
      const tag = isHunter && name ? nameTag(name) : null; if (tag) scene.add(tag);
      const light = new THREE.SpotLight(0xfff1d0, isHunter ? 12 : 0, 14, 0.4, 0.5, 1.6);
      const target = new THREE.Object3D(); scene.add(light, target); light.target = target;
      const shout = sprite("ex", 0.35, 0.5); shout.visible = false;
      players[id] = { sprite: s, av, tag, light, target, shout };
    },
    frame(st: {
      dt: number; t: number; cam: { x: number; y: number }; yaw: number; pitch: number; moving: boolean; battery: number; near: number;
      keyMask: number; batMask: number; npcs: { kind: string; x: number; y: number }[];
      others: { id: string; x: number; y: number; yaw: number; visible: boolean; shouting: boolean; ghost: boolean; moving: boolean; pitch: number; emote: string | null }[];
      firstPerson: boolean; camH?: number; drone?: { x: number; y: number; h: number; yaw: number } | null;
    }) {
      for (const dr of doors) {
        const near = [st.cam, ...st.others.filter((o) => o.visible || o.ghost)].some((p) => Math.hypot(p.x - dr.d.x, p.y - dr.d.y) < 120);
        if (near && !dr.was && Math.hypot(st.cam.x - dr.d.x, st.cam.y - dr.d.y) < 160) audio.creak();
        dr.was = near;
        dr.open += ((near ? 1 : 0) - dr.open) * Math.min(1, st.dt * 4);
        dr.pivot.rotation.y = dr.base + dr.open * 1.6;
      }
      if (st.moving) bobT += st.dt * 9;
      const bob = st.firstPerson ? Math.sin(bobT) * 0.04 : 0;
      const shake = st.near > 0.55 ? (Math.random() - 0.5) * st.near * 0.03 : 0;
      camera.position.set(st.cam.x * U, st.camH ?? EYE + Math.abs(bob), st.cam.y * U);
      if (opts.drone) {
        // aerial: roofs vanish above the walls and fog thins with altitude so the arena stays readable
        const h = st.camH ?? EYE; const above = h > WALL_H - 0.2;
        for (const c of ceilings) c.visible = !above;
        (scene.fog as THREE.FogExp2).density = (nvOn ? 0.012 : 0.035) / (1 + Math.max(0, h - 4) * 0.35);
      }
      drone.visible = !!st.drone;
      if (st.drone) { drone.position.set(st.drone.x * U, st.drone.h + Math.sin(st.t * 2) * 0.03, st.drone.y * U); drone.rotation.y = st.drone.yaw; rotors.forEach((r, i) => { r.rotation.y = st.t * 40 + i; }); const on = Math.sin(st.t * 6) > 0; ledR.visible = on; ledG.visible = !on; }
      camera.rotation.set(st.pitch + shake, st.yaw, 0);
      vm.visible = st.firstPerson;
      vm.position.set(vmX + Math.cos(bobT * 0.5) * 0.02, bob * 0.6, 0);
      // flashlight power
      if (opts.drone) flash.intensity = 0;
      else if (!opts.amGhost) {
        const flick = st.battery < 20 ? (Math.random() < 0.15 ? 0.2 : 1) : Math.random() < 0.008 ? 0.5 : 1;
        const p = st.battery <= 0 ? 0.04 : (0.25 + st.battery / 100 * 0.75) * flick;
        flash.intensity = 45 * p; flash.distance = 8 + 16 * p;
        const lens = vm.userData["lens"] as THREE.Mesh | undefined;
        if (lens) (lens.material as THREE.MeshBasicMaterial).color.setScalar(0.3 + p * 0.7);
      }
      const open = st.keyMask === 31;
      gateMat.color.set(open ? 0x59e36b : 0x8b0d17); gateMat.emissive.set(open ? 0x59e36b : 0x8b0d17); gateLight.color.set(open ? 0x59e36b : 0x8b0d17);
      keys.forEach((k, i) => { const on = !(st.keyMask & (1 << i)); k.sprite.visible = on; k.light!.visible = on; k.sprite.position.y = 0.6 + Math.sin(st.t * 3 + i) * 0.08; });
      bats.forEach((b, i) => { const on = !(st.batMask & (1 << i)); b.sprite.visible = on; b.light!.visible = on; });
      st.npcs.forEach((n, i) => {
        const key = `npc${i}`;
        const s = (npcSprites[key] ??= sprite(n.kind === "pocong" ? "pocong" : n.kind === "hoodie" ? "hoodie" : "kunti", 1.1, 1.9));
        s.position.set(n.x * U, 0.95 + (n.kind === "pocong" ? Math.abs(Math.sin(st.t * 4)) * 0.25 : Math.sin(st.t * 2) * 0.1 + 0.2), n.y * U);
      });
      for (const o of st.others) {
        const p = players[o.id]; if (!p) continue;
        p.light.visible = o.visible && !o.ghost;
        if (p.av) {
          p.av.root.visible = o.visible; p.av.root.position.set(o.x * U, 0, o.y * U); p.av.root.rotation.y = o.yaw;
          if (o.visible) p.av.update({ dt: st.dt, t: st.t, moving: o.moving, pitch: o.pitch, emote: o.emote });
        }
        if (p.sprite) {
          p.sprite.visible = o.visible;
          const h = o.ghost ? 1.3 + Math.sin(st.t * 2.5) * 0.1 : 0.8;
          p.sprite.position.set(o.x * U, h, o.y * U);
          if (o.ghost) (p.sprite.material as THREE.SpriteMaterial).opacity = 0.75 + Math.sin(st.t * 4) * 0.15;
        }
        if (p.tag) { p.tag.visible = o.visible; p.tag.position.set(o.x * U, 1.78, o.y * U); }
        p.light.position.set(o.x * U, 1.2, o.y * U);
        p.target.position.set(o.x * U - Math.sin(o.yaw) * 5, 0.6, o.y * U - Math.cos(o.yaw) * 5);
        p.shout.visible = o.visible && o.shouting; p.shout.position.set(o.x * U, 2.1 + Math.sin(st.t * 12) * 0.05, o.y * U);
      }
      theme.update(st.t, st.dt, st.cam);
      renderer.render(scene, camera);
    },
    setNightVision(on: boolean) {
      nvOn = on; nv.intensity = on ? 3.2 : 0;
      (scene.fog as THREE.FogExp2).density = on ? 0.012 : 0.035;
      scene.background = new THREE.Color(on ? 0x0a2010 : fogCol);
      renderer.toneMappingExposure = on ? 1.6 : 1;
    },
    dispose() { renderer.dispose(); },
  };
}
export { WORLD };
