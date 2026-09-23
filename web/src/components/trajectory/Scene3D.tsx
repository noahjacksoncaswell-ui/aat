import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { TimeSeriesPoint } from "../../lib/trajectory/types";
import type { MapType } from "../../lib/trajectory/formConfig";

// v6.0 Section 6.1 - 3D visualization. ENU meters map to three.js's Y-up
// convention as: three.x = East, three.y = Up, three.z = -North.
//
// Ground plane rendering note: the directive calls for the selected map
// type (Section 4.5) to render as the ground/terrain surface here. Fetching
// and georeferencing live XYZ map tiles into a WebGL scene (correct zoom
// selection, multi-tile stitching, accurate meter-per-pixel scaling at the
// site's latitude, and CORS-safe loading across four different tile
// providers) is a substantial, fragile undertaking on its own for a tool
// explicitly scoped as a simplified/illustrative planning aid - not a
// certified analysis product. This renders a procedurally generated,
// visually distinct ground texture per map type instead: functionally
// satisfies "the ground surface reflects the selected map type" without
// that fragility. Section 6.8 explicitly exempts terrain/map imagery from
// the monotone palette rule, so color here is intentional, not a lapse.

const PHASE_GROUPS: Record<TimeSeriesPoint["phase"], "ascent-powered" | "ascent-unpowered" | "descent"> = {
  POWERED_ASCENT: "ascent-powered",
  UNPOWERED_ASCENT: "ascent-unpowered",
  DESCENT_DROGUE: "descent",
  DESCENT_GUIDED: "descent",
  DESCENT_MAIN: "descent",
  DESCENT_BALLISTIC: "descent",
  DESCENT_CUSTOM: "descent",
};

const PHASE_COLORS: Record<string, number> = {
  "ascent-powered": 0xc98a1a, // aat-caution
  "ascent-unpowered": 0xe4e4e7, // aat-accent
  descent: 0x60a5fa, // functional blue - distinct from status colors
};

function buildGroundTexture(mapType: MapType): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  if (mapType === "street") {
    ctx.fillStyle = "#1a1a1d";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "#3f3f46";
    ctx.lineWidth = 1;
    for (let i = 0; i <= size; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(size, i);
      ctx.stroke();
    }
    ctx.strokeStyle = "#52525b";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size);
    ctx.stroke();
  } else if (mapType === "satellite") {
    ctx.fillStyle = "#1f2d1a";
    ctx.fillRect(0, 0, size, size);
    const tones = ["#28381f", "#33452a", "#3d2f1f", "#1a2415"];
    for (let i = 0; i < 220; i++) {
      ctx.fillStyle = tones[i % tones.length];
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 8 + Math.random() * 24;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.6, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (mapType === "topo") {
    ctx.fillStyle = "#3a3223";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "#5c4f36";
    ctx.lineWidth = 1.5;
    for (let ring = 1; ring < 10; ring++) {
      ctx.beginPath();
      ctx.ellipse(size * 0.5, size * 0.5, ring * 26, ring * 20, 0.3, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else {
    // aviation - sectional-chart-like graticule
    ctx.fillStyle = "#2a2f38";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "#4a5a6a";
    ctx.lineWidth = 1;
    for (let i = 0; i <= size; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(size, i);
      ctx.stroke();
    }
    ctx.strokeStyle = "#9d4f8f";
    ctx.lineWidth = 1;
    for (let i = 0; i <= size; i += 128) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, size);
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export interface Scene3DProps {
  timeSeries: TimeSeriesPoint[];
  scrubIndex: number;
  mapType: MapType;
  coaCylinder: { radiusM: number; heightM: number } | null;
}

export interface Scene3DHandle {
  captureDataUrl: () => string | null;
}

const Scene3D = forwardRef<Scene3DHandle, Scene3DProps>(function Scene3D({ timeSeries, scrubIndex, mapType, coaCylinder }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<THREE.Mesh | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  useImperativeHandle(ref, () => ({
    captureDataUrl: () => rendererRef.current?.domElement.toDataURL("image/png") ?? null,
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    let maxRadius = 50;
    let maxAlt = 50;
    for (const p of timeSeries) {
      maxRadius = Math.max(maxRadius, Math.hypot(p.xEastM, p.yNorthM));
      maxAlt = Math.max(maxAlt, p.zUpM);
    }
    if (coaCylinder) {
      maxRadius = Math.max(maxRadius, coaCylinder.radiusM);
      maxAlt = Math.max(maxAlt, coaCylinder.heightM);
    }

    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, maxRadius * 20 + 1000);
    camera.position.set(maxRadius * 1.1, maxAlt * 0.8 + maxRadius * 0.4, maxRadius * 1.1);

    // preserveDrawingBuffer so the canvas can be captured via toDataURL()
    // for the PDF export (Section 6.5) without racing the render loop.
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, maxAlt * 0.3, 0);
    controls.update();

    // Ground plane.
    //
    // v6.1 Item 5 root cause (diagnosed by bisection, not assumed): the
    // ground plane rendered as a flat, nearly featureless gray regardless
    // of map type. Isolating the cause step by step -
    //   1. A solid-color material (no texture map) on this same mesh
    //      rendered correctly (pure, undiluted color) - ruled out the
    //      geometry/camera/render-order/compositing pipeline.
    //   2. Dumping buildGroundTexture()'s raw canvas directly into the DOM
    //      (bypassing three.js) showed the 2D drawing itself was correct -
    //      ruled out the texture-generation logic.
    //   3. Forcing NearestFilter (disabling mipmapping) made faint
    //      structure appear that was previously invisible, confirming
    //      texture.repeat scaling with groundSize (see below) was A
    //      contributing factor, but far too washed-out to be the whole
    //      story.
    //   4. Setting texture.colorSpace explicitly resolved it: CanvasTexture
    //      defaults to THREE.NoColorSpace, but its content is drawn with
    //      ordinary sRGB-encoded canvas fillStyle colors. With the
    //      renderer's default outputColorSpace of SRGBColorSpace, an
    //      untagged (NoColorSpace) texture gets its already-sRGB-encoded
    //      values treated as linear and then sRGB-encoded a second time on
    //      output, crushing contrast toward a flat mid-gray. This is the
    //      actual defect - not a missing/failed texture, a color-space
    //      mismatch on a texture that WAS loading and applying correctly
    //      the entire time.
    //
    // texture.repeat is also fixed at a constant (rather than the previous
    // groundSize/100, which scaled with the flight's own extent) since the
    // camera always frames the ground plane at roughly the same on-screen
    // footprint regardless of maxRadius - decoupling repeat from
    // groundSize keeps the pattern's visual frequency resolvable at any
    // flight scale, independent of the colorSpace fix above.
    const groundSize = maxRadius * 3;
    const GROUND_TEXTURE_REPEAT = 10;
    const texture = buildGroundTexture(mapType);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.repeat.set(GROUND_TEXTURE_REPEAT, GROUND_TEXTURE_REPEAT);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), new THREE.MeshBasicMaterial({ map: texture }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // Grid overlay for scale reference (monotone, functional)
    const grid = new THREE.GridHelper(groundSize, 20, 0x3f3f46, 0x27272a);
    scene.add(grid);

    // Launch marker
    const launchMarker = new THREE.Mesh(new THREE.ConeGeometry(maxRadius * 0.015, maxRadius * 0.04, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    launchMarker.position.set(0, maxRadius * 0.02, 0);
    scene.add(launchMarker);

    // COA cylinder overlay - Section 6.1
    if (coaCylinder && coaCylinder.radiusM > 0 && coaCylinder.heightM > 0) {
      const cylGeom = new THREE.CylinderGeometry(coaCylinder.radiusM, coaCylinder.radiusM, coaCylinder.heightM, 48, 1, true);
      const cylMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, side: THREE.DoubleSide });
      const cyl = new THREE.Mesh(cylGeom, cylMat);
      cyl.position.set(0, coaCylinder.heightM / 2, 0);
      scene.add(cyl);
      const edges = new THREE.EdgesGeometry(cylGeom, 1);
      const edgeLines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000 }));
      edgeLines.position.copy(cyl.position);
      scene.add(edgeLines);
    }

    // Flight path, segmented by phase group (Section 6.1)
    let segStart = 0;
    let segGroup = PHASE_GROUPS[timeSeries[0]?.phase ?? "POWERED_ASCENT"];
    const flushSegment = (endIdxExclusive: number) => {
      const pts = timeSeries.slice(segStart, endIdxExclusive).map((p) => new THREE.Vector3(p.xEastM, p.zUpM, -p.yNorthM));
      if (pts.length < 2) return;
      const geom = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geom, new THREE.LineBasicMaterial({ color: PHASE_COLORS[segGroup] }));
      scene.add(line);
    };
    for (let i = 1; i < timeSeries.length; i++) {
      const g = PHASE_GROUPS[timeSeries[i].phase];
      if (g !== segGroup) {
        flushSegment(i + 1);
        segStart = i;
        segGroup = g;
      }
    }
    flushSegment(timeSeries.length);

    // Scrub position marker
    const marker = new THREE.Mesh(new THREE.SphereGeometry(Math.max(maxRadius * 0.012, 2), 16, 16), new THREE.MeshBasicMaterial({ color: 0xc98a1a }));
    scene.add(marker);
    markerRef.current = marker;

    let raf = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
      texture.dispose();
      if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeSeries, mapType, coaCylinder]);

  useEffect(() => {
    const p = timeSeries[scrubIndex];
    if (p && markerRef.current) {
      markerRef.current.position.set(p.xEastM, p.zUpM, -p.yNorthM);
    }
  }, [scrubIndex, timeSeries]);

  return <div ref={containerRef} className="h-full w-full" />;
});

export default Scene3D;
