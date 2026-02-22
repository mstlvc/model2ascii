import { useRef, useEffect, useCallback, useMemo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";

const HEX_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CELL_SIZE = 10;
const BASE_CHANGE_RATE = 0.008;
const MAX_CHANGE_RATE = 0.15;
const NUM_BUCKETS = 12;
const MIN_ALPHA = 0.0;

// Pre-compute alpha bucket fill styles
const BUCKET_STYLES: string[] = [];
for (let i = 0; i < NUM_BUCKETS; i++) {
  const t = i / (NUM_BUCKETS - 1);
  const alpha = MIN_ALPHA + t * (1.0 - MIN_ALPHA);
  BUCKET_STYLES.push(`rgba(255,255,255,${Math.round(alpha * 100) / 100})`);
}

// Scale factor for massive screens
function getScaleFactor(): number {
  return window.innerWidth > 2000 ? 0.75 : 1;
}

function getGridDims() {
  const scale = getScaleFactor();
  const cols = Math.floor((window.innerWidth * scale) / CELL_SIZE);
  const rows = Math.floor((window.innerHeight * scale) / CELL_SIZE);
  return { cols, rows, scale };
}

// Pre-generate a static character grid
let staticGrid: string[][] | null = null;
function getStaticGrid(cols: number, rows: number): string[][] {
  if (staticGrid && staticGrid.length === rows && staticGrid[0]?.length === cols) {
    return staticGrid;
  }
  staticGrid = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(HEX_CHARS[Math.floor(Math.random() * HEX_CHARS.length)]);
    }
    staticGrid.push(row);
  }
  return staticGrid;
}

function scrambleGrid(grid: string[][], rate: number) {
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (Math.random() < rate) {
        grid[r][c] = HEX_CHARS[Math.floor(Math.random() * HEX_CHARS.length)];
      }
    }
  }
}

/* ─── Warp background shader ─── */
const warpVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const warpFragmentShader = `
  uniform float uTime;
  varying vec2 vUv;

  // Simplex-style hash
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
      value += amplitude * snoise(p);
      p *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    float t = uTime * 0.12;
    // Drift toward top-right by subtracting time from both axes
    vec2 uv = vUv * 3.0 - vec2(t * 0.8, t * 0.5);

    // Domain warping
    float warp1 = fbm(uv + vec2(t * 0.3, t * 0.2));
    float warp2 = fbm(uv + vec2(warp1 * 0.8, warp1 * 0.4));
    float n = fbm(uv + vec2(warp2 * 0.6, warp2 * 0.3));

    // Normalize noise to 0-1, then crunch contrast for deep voids
    float rawNoise = n * 0.5 + 0.5;
    float contrastedNoise = smoothstep(0.25, 0.75, rawNoise);
    contrastedNoise = pow(contrastedNoise, 2.5);
    float finalBrightness = contrastedNoise * 0.7;
    gl_FragColor = vec4(vec3(finalBrightness), 1.0);
  }
`;

/* ─── Scene internals: head + background + ASCII readback ─── */

function SceneInternals({ asciiCanvasRef }: { asciiCanvasRef: React.RefObject<HTMLCanvasElement | null> }) {
  const { gl } = useThree();

  // Off-screen scene objects
  const sceneRef = useRef(new THREE.Scene());
  const cameraRef = useRef(new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100));
  const modelRef = useRef<THREE.Group>(new THREE.Group());
  const frameCount = useRef(0);
  const pixelBuffer = useRef<Uint8Array | null>(null);

  // Mouse tracking refs
  const targetMouse = useRef({ x: 0, y: 0 });
  const smoothMouse = useRef({ x: 0, y: 0 });
  const prevSmooth = useRef({ x: 0, y: 0 });
  const moveSpeed = useRef(0);

  // Warp background shader material
  const warpMaterialRef = useRef<THREE.ShaderMaterial | null>(null);

  const renderTarget = useMemo(() => {
    const { cols, rows } = getGridDims();
    return new THREE.WebGLRenderTarget(cols, rows, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
    });
  }, []);

  useEffect(() => () => renderTarget.dispose(), [renderTarget]);

  // Mouse listener with exact coordinate math
  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const normalizedX = event.clientX / window.innerWidth;
      const normalizedY = 1.0 - event.clientY / window.innerHeight; // INVERTED
      targetMouse.current = {
        x: (normalizedX - 0.5) * 2.0,
        y: (normalizedY - 0.5) * 2.0,
      };
    };
    window.addEventListener("mousemove", onMouseMove);
    return () => window.removeEventListener("mousemove", onMouseMove);
  }, []);

  // Load head.glb
  useEffect(() => {
    const loader = new GLTFLoader();
    loader.load("/head.glb", (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 2.5 / maxDim;
      model.scale.setScalar(scale);
      const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
      model.position.sub(center);
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          (child as THREE.Mesh).material = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            side: THREE.DoubleSide,
            roughness: 0.75,
            metalness: 0.05,
          });
        }
      });
      modelRef.current.add(model);
    });
  }, []);

  // Scene setup
  useEffect(() => {
    const scene = sceneRef.current;
    const cam = cameraRef.current;
    cam.position.set(0, 0, 5);

    // Dramatic lighting: deep shadows with harsh key light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.05);
    scene.add(ambientLight);
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    keyLight.position.set(1, 3, 4);
    scene.add(keyLight);
    const fillLeft = new THREE.DirectionalLight(0xffffff, 0.15);
    fillLeft.position.set(-5, 1, 2);
    scene.add(fillLeft);
    const fillRight = new THREE.DirectionalLight(0xffffff, 0.15);
    fillRight.position.set(5, 1, 2);
    scene.add(fillRight);
    const crownLight = new THREE.DirectionalLight(0xffffff, 2.0);
    crownLight.position.set(0, 5, -2);
    scene.add(crownLight);
    const rimLeft = new THREE.DirectionalLight(0xffffff, 2.0);
    rimLeft.position.set(-5, 3, -4);
    scene.add(rimLeft);
    const rimRight = new THREE.DirectionalLight(0xffffff, 2.0);
    rimRight.position.set(5, 3, -4);
    scene.add(rimRight);
    const chinLight = new THREE.DirectionalLight(0xffffff, 1.5);
    chinLight.position.set(0, -5, -3);
    scene.add(chinLight);

    // Head group — pulled down and scaled
    const group = modelRef.current;
    group.position.set(0, -1.0, 0);
    group.scale.set(2, 2, 2);
    scene.add(group);

    // Warp background plane with custom shader
    const planeGeo = new THREE.PlaneGeometry(40, 40);
    const planeMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: warpVertexShader,
      fragmentShader: warpFragmentShader,
    });
    warpMaterialRef.current = planeMat;
    const plane = new THREE.Mesh(planeGeo, planeMat);
    plane.position.set(0, 0, -15);
    scene.add(plane);

    return () => {
      scene.remove(keyLight);
      scene.remove(fillLeft);
      scene.remove(fillRight);
      scene.remove(crownLight);
      scene.remove(rimLeft);
      scene.remove(rimRight);
      scene.remove(chinLight);
      scene.remove(ambientLight);
      scene.remove(group);
      scene.remove(plane);
      planeGeo.dispose();
      planeMat.dispose();
      warpMaterialRef.current = null;
    };
  }, []);

  // Resize handler
  useEffect(() => {
    const onResize = () => {
      const { cols, rows } = getGridDims();
      cameraRef.current.aspect = window.innerWidth / window.innerHeight;
      cameraRef.current.updateProjectionMatrix();
      renderTarget.setSize(cols, rows);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [renderTarget]);

  // Reusable vector to avoid GC
  const targetVec = useMemo(() => new THREE.Vector3(), []);

  // Pre-allocate bucket arrays once
  const buckets = useRef<Array<Array<{ char: string; x: number; y: number }>>>(
    Array.from({ length: NUM_BUCKETS }, () => [])
  );

  useFrame((_, delta) => {
    // Smooth damping — runs every frame for smooth head tracking
    smoothMouse.current.x += (targetMouse.current.x - smoothMouse.current.x) * 0.2;
    smoothMouse.current.y += (targetMouse.current.y - smoothMouse.current.y) * 0.2;

    const dx = smoothMouse.current.x - prevSmooth.current.x;
    const dy = smoothMouse.current.y - prevSmooth.current.y;
    const speed = Math.sqrt(dx * dx + dy * dy);
    moveSpeed.current += (speed - moveSpeed.current) * 0.1;
    prevSmooth.current.x = smoothMouse.current.x;
    prevSmooth.current.y = smoothMouse.current.y;

    targetVec.set(smoothMouse.current.x * 1.5, smoothMouse.current.y * 1.5, 5);
    if (modelRef.current) {
      modelRef.current.lookAt(targetVec);
    }

    if (warpMaterialRef.current) {
      warpMaterialRef.current.uniforms.uTime.value += delta;
    }

    // Render 3D scene every frame for smooth rotation
    gl.setRenderTarget(renderTarget);
    gl.render(sceneRef.current, cameraRef.current);
    gl.setRenderTarget(null);

    // Throttle ASCII drawing to every 2nd frame (~30fps)
    frameCount.current++;
    if (frameCount.current % 2 !== 0) return;

    const canvas = asciiCanvasRef.current;
    if (!canvas) return;

    const cols = renderTarget.width;
    const rows = renderTarget.height;
    const { scale } = getGridDims();
    const canvasW = Math.floor(window.innerWidth * scale);
    const canvasH = Math.floor(window.innerHeight * scale);

    if (canvas.width !== canvasW || canvas.height !== canvasH) {
      canvas.width = canvasW;
      canvas.height = canvasH;
    }

    const bufSize = cols * rows * 4;
    if (!pixelBuffer.current || pixelBuffer.current.length !== bufSize) {
      pixelBuffer.current = new Uint8Array(bufSize);
    }

    gl.readRenderTargetPixels(renderTarget, 0, 0, cols, rows, pixelBuffer.current);

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.textBaseline = "top";
    ctx.font = `bold ${CELL_SIZE}px "Courier New", monospace`;

    const buf = pixelBuffer.current;
    const grid = getStaticGrid(cols, rows);

    const headRate = Math.min(moveSpeed.current * 20, 1) * (MAX_CHANGE_RATE - BASE_CHANGE_RATE);

    // Clear buckets
    for (let i = 0; i < NUM_BUCKETS; i++) {
      buckets.current[i].length = 0;
    }

    // Classify each cell into a brightness bucket
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = ((rows - 1 - row) * cols + col) * 4;

        const r = buf[idx];
        const g = buf[idx + 1];
        const b = buf[idx + 2];
        const brightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255;

        // Fog density approach: 3-layer additive alpha
        const baseAlpha = 0.05;
        const aura = Math.pow(brightness, 0.35) * 0.2;
        const core = Math.pow(brightness, 1.5) * 0.5;

        // Only flicker characters where smoke is actively touching them
        if ((aura + core) > 0.03) {
          if (brightness > 0.35 && Math.random() < headRate && Math.random() > 0.5) {
            grid[row][col] = HEX_CHARS[Math.floor(Math.random() * HEX_CHARS.length)];
          } else if (Math.random() < BASE_CHANGE_RATE && Math.random() > 0.5) {
            grid[row][col] = HEX_CHARS[Math.floor(Math.random() * HEX_CHARS.length)];
          }
        }

        // Head uses sharper curve; background uses additive fog layers
        let contrastBrightness: number;
        if (brightness > 0.25) {
          contrastBrightness = Math.pow(brightness, 1.8);
        } else {
          contrastBrightness = baseAlpha + aura + core;
        }
        const bucketIdx = Math.min(Math.floor(contrastBrightness * NUM_BUCKETS), NUM_BUCKETS - 1);

        buckets.current[bucketIdx].push({
          char: grid[row][col],
          x: col * CELL_SIZE,
          y: row * CELL_SIZE,
        });
      }
    }

    // Draw batched by bucket — one fillStyle change per bucket
    for (let i = 0; i < NUM_BUCKETS; i++) {
      const bucket = buckets.current[i];
      if (bucket.length === 0) continue;
      ctx.fillStyle = BUCKET_STYLES[i];
      for (let j = 0; j < bucket.length; j++) {
        ctx.fillText(bucket[j].char, bucket[j].x, bucket[j].y);
      }
    }
  });


  return null;
}

/* ─── Main exported component ─── */

export default function AsciiHeadBackground() {
  const asciiCanvasRef = useRef<HTMLCanvasElement | null>(null);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        zIndex: -1,
        background: "#000",
      }}
    >
      <Canvas
        gl={{ preserveDrawingBuffer: true, alpha: false }}
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", opacity: 0 }}
      >
        <SceneInternals asciiCanvasRef={asciiCanvasRef} />
      </Canvas>
      <canvas
        ref={asciiCanvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          pointerEvents: "none",
          zIndex: 1,
        }}
      />
    </div>
  );
}
