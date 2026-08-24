/**
 * Model viewer — dev-only lookdev bench for handcrafted models.
 *
 * `npm run dev` then open /model-viewer.html.
 *
 * The point of this page is that a model which reads well in Blender's
 * viewport routinely reads badly under a 3-step toon ramp at chase-cam
 * distance. So it renders every subject twice — procedural on the left,
 * handcrafted on the right — under the game's own materials, lighting and fog,
 * at the distance the player actually sees it from.
 *
 * It is not part of the production bundle: Vite only builds index.html, so
 * this page exists on the dev server and nowhere else.
 */

import * as THREE from 'three';
import { CARS } from '../game/economy/cars';
import { CAR_BODY_TYPES, type CarBodyType, type CarStyle } from '../types';
import { buildProceduralCar, disposeCar, animateCar, type CarRig } from '../world/car';
import { toonRamp, vertexToonMat } from '../world/materials';
import { carModel, sceneryModel } from '../world/models/registry';
import { buildRigFromModel } from '../world/models/carModel';
import { buildProtoFromModel } from '../world/models/sceneryModel';
import { modelTriangles } from '../world/models/codec';
import { SCENERY_KINDS, type SceneryKind } from '../world/biomes';
import { buildProceduralProto, type Proto } from '../world/scenery';

/** Stand-in for the per-instance palette tint `chunks.ts` applies. */
const DEMO_TINT = new THREE.Color('#8fb54a');

const STAGE_X = 3.2;

interface Subject {
  id: string;
  label: string;
  kind: 'scenery' | 'car';
}

interface Stage {
  pivot: THREE.Group;
  rig: CarRig | null;
  triangles: number;
  bytes: number;
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const canvas = document.getElementById('viewer-canvas') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
// Mirrors main.ts: PCFSoftShadowMap is deprecated in three r185 and falls back
// to PCFShadowMap anyway, so this is the filter the game actually renders.
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#d2ecd2');
scene.fog = new THREE.FogExp2('#d2ecd2', 0.006);

// Matches main.ts, so a model is judged under the light it will actually meet.
const hemi = new THREE.HemisphereLight('#bfe3ff', '#7ec850', 0.75);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff2d9', 1.6);
sun.position.set(-8, 12, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshToonMaterial({ color: '#7fbf5f', gradientMap: toonRamp() }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);

const stages: Record<'procedural' | 'handcrafted', Stage> = {
  procedural: { pivot: new THREE.Group(), rig: null, triangles: 0, bytes: 0 },
  handcrafted: { pivot: new THREE.Group(), rig: null, triangles: 0, bytes: 0 },
};
stages.procedural.pivot.position.x = -STAGE_X;
stages.handcrafted.pivot.position.x = STAGE_X;
scene.add(stages.procedural.pivot, stages.handcrafted.pivot);

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

const subjects: Subject[] = [
  ...CAR_BODY_TYPES.map((t): Subject => ({ id: `car.${t}`, label: `car — ${t}`, kind: 'car' })),
  ...SCENERY_KINDS.map((k): Subject => ({
    id: `scenery.${k}`,
    label: `scenery — ${k}`,
    kind: 'scenery',
  })),
];

function styleFor(bodyType: CarBodyType): CarStyle {
  const car = CARS.find((c) => c.style.bodyType === bodyType);
  return car ? car.style : { bodyType, bodyColor: '#d98e73', accentColor: '#8a5a44', scale: 1 };
}

/** One instance of a Proto as a mesh, tinted the way a chunk would tint it. */
function protoMesh(proto: Proto): THREE.Mesh {
  const colors = new Float32Array(proto.vertexCount * 3);
  for (let v = 0; v < proto.vertexCount; v++) {
    const shade = proto.shade[v];
    if (proto.mask[v] > 0.5) {
      colors[v * 3] = DEMO_TINT.r * shade;
      colors[v * 3 + 1] = DEMO_TINT.g * shade;
      colors[v * 3 + 2] = DEMO_TINT.b * shade;
    } else {
      colors[v * 3] = proto.baked[v * 3] * shade;
      colors[v * 3 + 1] = proto.baked[v * 3 + 1] * shade;
      colors[v * 3 + 2] = proto.baked[v * 3 + 2] * shade;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(proto.pos.slice(), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(proto.norm.slice(), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, vertexToonMat());
  mesh.castShadow = true;
  return mesh;
}

function clearStage(stage: Stage): void {
  if (stage.rig) {
    disposeCar(stage.rig);
    stage.rig = null;
  }
  for (const child of [...stage.pivot.children]) {
    stage.pivot.remove(child);
    if (child instanceof THREE.Mesh) child.geometry.dispose();
  }
  stage.triangles = 0;
  stage.bytes = 0;
}

function encodedBytes(id: string): number {
  const model = id.startsWith('car.')
    ? carModel(id.slice(4) as CarBodyType)
    : sceneryModel(id.slice(8));
  if (!model) return 0;
  return model.parts.reduce(
    (sum, p) => sum + p.vertexCount * 6 + p.triCount * 6 + (p.hasShade ? p.vertexCount : 0),
    0,
  );
}

function countTriangles(root: THREE.Object3D): number {
  let tris = 0;
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const position = o.geometry.getAttribute('position');
      const index = o.geometry.getIndex();
      tris += (index ? index.count : position.count) / 3;
    }
  });
  return tris;
}

function load(subject: Subject): void {
  clearStage(stages.procedural);
  clearStage(stages.handcrafted);

  if (subject.kind === 'car') {
    const bodyType = subject.id.slice(4) as CarBodyType;
    const style = styleFor(bodyType);

    const proc = buildProceduralCar(style);
    stages.procedural.rig = proc;
    stages.procedural.pivot.add(proc.group);

    const model = carModel(bodyType);
    if (model) {
      const rig = buildRigFromModel(model, style);
      stages.handcrafted.rig = rig;
      stages.handcrafted.pivot.add(rig.group);
      stages.handcrafted.triangles = modelTriangles(model);
    }
  } else {
    const kind = subject.id.slice(8) as SceneryKind;
    stages.procedural.pivot.add(protoMesh(buildProceduralProto(kind)));
    const model = sceneryModel(kind);
    if (model) {
      stages.handcrafted.pivot.add(protoMesh(buildProtoFromModel(model)));
      stages.handcrafted.triangles = modelTriangles(model);
    }
  }

  stages.procedural.triangles = countTriangles(stages.procedural.pivot);
  stages.handcrafted.bytes = encodedBytes(subject.id);
  frameCamera();
  renderStats(subject);
}

/**
 * Frame whatever is actually on the stages, at chase-cam pitch. With no
 * handcrafted counterpart there is only one subject, and it sits centred
 * rather than off to one side.
 */
function frameCamera(): void {
  const paired = stages.handcrafted.pivot.children.length > 0;
  stages.procedural.pivot.position.x = paired ? -STAGE_X : 0;
  stages.handcrafted.pivot.position.x = STAGE_X;

  const box = new THREE.Box3();
  for (const stage of Object.values(stages)) {
    if (stage.pivot.children.length) box.union(new THREE.Box3().setFromObject(stage.pivot));
  }
  if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // Turntables sweep the footprint through every heading, so reserve the
  // diagonal rather than the current width.
  const spread = Math.hypot(size.x, size.z) + (paired ? STAGE_X : 0);
  const extent = Math.max(spread, size.y * 1.6, 2.5);
  const distance = (extent / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.35;

  camera.position.set(0, center.y + extent * 0.42, distance);
  camera.lookAt(0, center.y * 0.9, 0);
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const select = document.getElementById('subject') as HTMLSelectElement;
const statsEl = document.getElementById('stats') as HTMLElement;
const spinToggle = document.getElementById('spin') as HTMLInputElement;
const wireToggle = document.getElementById('wire') as HTMLInputElement;

for (const subject of subjects) {
  const option = document.createElement('option');
  option.value = subject.id;
  const has = subject.id.startsWith('car.')
    ? carModel(subject.id.slice(4) as CarBodyType)
    : sceneryModel(subject.id.slice(8));
  option.textContent = has ? `${subject.label}  ●` : subject.label;
  select.append(option);
}

function renderStats(subject: Subject): void {
  const p = stages.procedural;
  const h = stages.handcrafted;
  const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`;
  statsEl.innerHTML = h.triangles
    ? `<b>${subject.label}</b><br>procedural ${p.triangles} tris` +
      `<br>handcrafted ${h.triangles} tris · ${kb(h.bytes)}` +
      `<br><span class="delta">${((h.triangles / p.triangles - 1) * 100).toFixed(0)}% triangles vs procedural</span>`
    : `<b>${subject.label}</b><br>procedural ${p.triangles} tris` +
      `<br><span class="muted">no handcrafted model — this asset is procedural</span>`;
}

function setWireframe(on: boolean): void {
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh && o !== ground) {
      const material = o.material as THREE.Material & { wireframe?: boolean };
      if ('wireframe' in material) material.wireframe = on;
    }
  });
}

select.addEventListener('change', () => {
  const subject = subjects.find((s) => s.id === select.value);
  if (subject) {
    load(subject);
    setWireframe(wireToggle.checked);
  }
});
wireToggle.addEventListener('change', () => setWireframe(wireToggle.checked));

function resize(): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height || 1;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

let last = performance.now();
let elapsed = 0;
let spin = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  elapsed += dt;

  if (spinToggle.checked) spin += dt * 0.5;
  stages.procedural.pivot.rotation.y = spin;
  stages.handcrafted.pivot.rotation.y = spin;
  // Roll the wheels at a plausible cruise so the axle frame is visible.
  for (const stage of Object.values(stages)) {
    if (stage.rig) animateCar(stage.rig, 14, dt, elapsed);
  }
  renderer.render(scene, camera);
}

resize();
select.value = subjects[0].id;
load(subjects[0]);
requestAnimationFrame(frame);
