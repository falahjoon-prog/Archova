'use client';

// The 3D canvas: draws parsed IFC elements with three.js, lets people orbit, pan and zoom, and reports which
// element a click or tap landed on. It owns no data; the screen decides what is loaded, selected and flagged.

import { useEffect, useRef } from 'react';
import {
  AmbientLight,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { IfcElement } from './ifc';

export interface ViewerModel {
  modelId: string;
  elements: IfcElement[];
}

export type Flag = 'selected' | 'clash';

export interface ElementRef {
  modelId: string;
  expressId: number;
}

export const elementKey = (r: ElementRef) => `${r.modelId}:${r.expressId}`;

interface Props {
  models: readonly ViewerModel[];
  /** Elements to colour: the picked one, or the ones in a clash. */
  flags: ReadonlyMap<string, Flag>;
  onPick: (ref: ElementRef | null) => void;
  label: string;
}

const FLAG_COLOUR: Record<Flag, number> = { selected: 0xb4542a, clash: 0xd62839 };

function meshFor(el: IfcElement): Mesh {
  let vertexCount = 0;
  let indexCount = 0;
  for (const p of el.parts) {
    vertexCount += p.positions.length / 3;
    indexCount += p.indices.length;
  }
  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  let v = 0;
  let i = 0;
  for (const p of el.parts) {
    const base = v / 3;
    positions.set(p.positions, v);
    for (let k = 0; k < p.indices.length; k++) indices[i + k] = p.indices[k]! + base;
    v += p.positions.length;
    i += p.indices.length;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const [r, g, b, a] = el.parts[0]!.color;
  const material = new MeshLambertMaterial({
    color: new Color(r, g, b),
    opacity: a,
    transparent: a < 1,
    side: DoubleSide,
  });
  return new Mesh(geometry, material);
}

export function ModelViewer({ models, flags, onPick, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const scene = useRef<{ meshes: Map<string, Mesh>; base: Map<string, Color> } | null>(null);

  // Build the scene whenever the set of loaded models changes.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';

    const three = new Scene();
    three.background = new Color(getComputedStyle(el).backgroundColor);
    three.add(new AmbientLight(0xffffff, 1.1));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(40, 80, 30);
    three.add(sun);

    const camera = new PerspectiveCamera(50, 1, 0.1, 5000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const group = new Group();
    const meshes = new Map<string, Mesh>();
    const base = new Map<string, Color>();
    const lookup = new Map<Mesh, string>();
    for (const m of models) {
      for (const e of m.elements) {
        const mesh = meshFor(e);
        const key = elementKey({ modelId: m.modelId, expressId: e.expressId });
        meshes.set(key, mesh);
        base.set(key, (mesh.material as MeshLambertMaterial).color.clone());
        lookup.set(mesh, key);
        group.add(mesh);
      }
    }
    three.add(group);
    scene.current = { meshes, base };

    const bounds = new Box3().setFromObject(group);
    if (!bounds.isEmpty()) {
      const centre = bounds.getCenter(new Vector3());
      const size = bounds.getSize(new Vector3());
      const radius = Math.max(size.x, size.y, size.z, 1);
      camera.position.set(centre.x + radius, centre.y + radius * 0.8, centre.z + radius);
      controls.target.copy(centre);
      camera.far = radius * 20;
      camera.updateProjectionMatrix();
    }

    const resize = () => {
      const w = Math.max(el.clientWidth, 1);
      const h = Math.max(el.clientHeight, 1);
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();

    // A click is a press and release that did not drag: dragging orbits, it must not pick.
    const raycaster = new Raycaster();
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const r = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(
        new Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          -((e.clientY - r.top) / r.height) * 2 + 1,
        ),
        camera,
      );
      const hit = raycaster.intersectObjects(group.children, false)[0];
      const key = hit ? lookup.get(hit.object as Mesh) : undefined;
      if (!key) return pick.current(null);
      const i = key.lastIndexOf(':');
      pick.current({ modelId: key.slice(0, i), expressId: Number(key.slice(i + 1)) });
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    let frame = 0;
    const tick = () => {
      controls.update();
      renderer.render(three, camera);
      frame = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      for (const mesh of meshes.values()) {
        mesh.geometry.dispose();
        (mesh.material as MeshLambertMaterial).dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
      scene.current = null;
    };
  }, [models]);

  // Recolour without rebuilding when the selection or the flagged clash changes.
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    for (const [key, mesh] of s.meshes) {
      const flag = flags.get(key);
      (mesh.material as MeshLambertMaterial).color.set(flag ? FLAG_COLOUR[flag] : s.base.get(key)!);
    }
  }, [flags, models]);

  return (
    <div
      ref={host}
      role="img"
      aria-label={label}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 320,
        background: 'var(--c-bg)',
        border: '1px solid var(--c-border-divider)',
        borderRadius: 'var(--radius-md, 8px)',
      }}
    />
  );
}
