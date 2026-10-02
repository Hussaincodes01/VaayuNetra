"use client";

// React Three Fiber particle layer for the hero (the only three.js on the page).
//   mode "globe": no Mapbox token, so the particles are the globe: a dotted sphere with the five
//                 landfills glowing and plume particles rising from them.
//   mode "haze":  over the Mapbox globe, a faint drift of methane-ramp particles.
// All motion runs in the vertex shader; the canvas stops rendering when the hero is off screen.

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { getMapScene, subscribeMapScene, type MapScene } from "./map-bus";

/** Hero scroll progress; anything past the hero counts as fully zoomed in. */
const sceneProgress = (scene: MapScene) =>
  scene.kind === "hero" ? scene.progress : 1;

type SitePoint = { lat: number; lon: number };
type Props = {
  mode: "globe" | "haze";
  sites: SitePoint[];
  active: boolean;
  reducedMotion: boolean;
};

const DEG = Math.PI / 180;
const INDIA = { lat: 22.5, lon: 79 };

function toXYZ(lat: number, lon: number, r = 1): [number, number, number] {
  const la = lat * DEG;
  const lo = lon * DEG;
  return [
    r * Math.cos(la) * Math.sin(lo),
    r * Math.sin(la),
    r * Math.cos(la) * Math.cos(lo),
  ];
}

const vertex = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  attribute float aScale;
  attribute float aPhase;
  attribute float aKind;     // 0 globe dot, 1 site, 2 plume particle, 3 haze
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec3 p = position;
    float alpha = 1.0;
    vColor = aColor;
    if (aKind > 1.5 && aKind < 2.5) {
      float h = fract(aPhase + uTime * 0.07);
      p = position * (1.0 + h * 0.16) + vec3(sin(aPhase * 40.0 + uTime) * 0.01 * h, 0.0, 0.0);
      alpha = (1.0 - h) * smoothstep(0.0, 0.08, h);
      vColor = mix(vec3(0.992, 0.902, 0.541), vec3(0.863, 0.149, 0.149), h);
    } else if (aKind > 2.5) {
      float h = fract(aPhase + uTime * 0.02);
      p = position + vec3(0.0, h * 1.6 - 0.8, 0.0);
      alpha = sin(h * 3.14159) * 0.55;
    } else if (aKind > 0.5) {
      alpha = 0.75 + 0.25 * sin(uTime * 2.0 + aPhase * 6.28);
    }
    vec4 world = modelMatrix * vec4(p, 1.0);
    if (aKind < 2.5) {
      float facing = dot(normalize(world.xyz), normalize(cameraPosition));
      alpha *= mix(0.06, 1.0, smoothstep(-0.15, 0.45, facing));
    }
    vec4 mv = viewMatrix * world;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * aScale * uPixelRatio / -mv.z;
    vAlpha = alpha;
  }
`;

// Fresnel rim on a back-face sphere: reads as the atmosphere around the dotted globe.
const atmosphereVertex = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const atmosphereFragment = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    float rim = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
    gl_FragColor = vec4(0.176, 0.831, 0.749, 1.0) * rim;
  }
`;

const fragment = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.5, 0.05, d));
  }
`;

function buildGeometry(
  mode: Props["mode"],
  sites: SitePoint[],
): THREE.BufferGeometry {
  const pos: number[] = [];
  const scale: number[] = [];
  const phase: number[] = [];
  const kind: number[] = [];
  const color: number[] = [];
  const rand = (() => {
    let s = 7;
    return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  })();
  const push = (
    p: [number, number, number],
    sc: number,
    k: number,
    c: [number, number, number],
  ) => {
    pos.push(...p);
    scale.push(sc);
    phase.push(rand());
    kind.push(k);
    color.push(...c);
  };

  if (mode === "globe") {
    const n = 5200;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = golden * i;
      push([Math.cos(th) * r, y, Math.sin(th) * r], 3.0, 0, [0.55, 0.64, 0.78]);
    }
    for (const s of sites) {
      push(toXYZ(s.lat, s.lon, 1.002), 9, 1, [0.961, 0.62, 0.043]);
      for (let j = 0; j < 70; j++) {
        const jitter = (): number => (rand() - 0.5) * 0.6;
        push(
          toXYZ(s.lat + jitter(), s.lon + jitter(), 1.004),
          3.2,
          2,
          [1, 1, 1],
        );
      }
    }
  } else {
    for (let i = 0; i < 900; i++) {
      push(
        [(rand() - 0.5) * 6, (rand() - 0.5) * 1.6, (rand() - 0.5) * 2],
        2.4,
        3,
        [0.961, 0.62, 0.043],
      );
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aScale", new THREE.Float32BufferAttribute(scale, 1));
  g.setAttribute("aPhase", new THREE.Float32BufferAttribute(phase, 1));
  g.setAttribute("aKind", new THREE.Float32BufferAttribute(kind, 1));
  g.setAttribute("aColor", new THREE.Float32BufferAttribute(color, 3));
  return g;
}

function Particles({ mode, sites, reducedMotion }: Omit<Props, "active">) {
  const group = useRef<THREE.Group>(null);
  const progress = useRef(sceneProgress(getMapScene()));
  const spin = useRef(0);
  const { camera, gl, invalidate } = useThree();
  const geometry = useMemo(() => buildGeometry(mode, sites), [mode, sites]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uSize: { value: 2.2 },
          uPixelRatio: { value: gl.getPixelRatio() },
        },
      }),
    [gl],
  );

  const points = useMemo(
    () => new THREE.Points(geometry, material),
    [geometry, material],
  );
  // Globe mode: a dark body that hides the far-side dots, plus the atmosphere rim.
  const body = useMemo(() => {
    if (mode !== "globe") return null;
    const g = new THREE.Group();
    g.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(0.99, 64, 64),
        new THREE.MeshBasicMaterial({ color: "#081120" }),
      ),
    );
    g.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(1.14, 64, 64),
        new THREE.ShaderMaterial({
          vertexShader: atmosphereVertex,
          fragmentShader: atmosphereFragment,
          side: THREE.BackSide,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
        }),
      ),
    );
    return g;
  }, [mode]);

  useEffect(
    () =>
      subscribeMapScene((scene) => {
        progress.current = sceneProgress(scene);
        invalidate();
      }),
    [invalidate],
  );
  useEffect(
    () => () => (geometry.dispose(), material.dispose()),
    [geometry, material],
  );

  useFrame((_, delta) => {
    if (!reducedMotion) material.uniforms.uTime.value += delta;
    if (mode !== "globe" || !group.current) return;
    const p = reducedMotion ? 1 : Math.min(1, progress.current * 1.6);
    if (!reducedMotion && p < 0.02) spin.current += delta * 0.12;
    const targetY = -INDIA.lon * DEG;
    const ry = (1 - p) * (spin.current + targetY - 1.2) + p * targetY;
    group.current.rotation.set(INDIA.lat * DEG * p, ry, 0);
    camera.position.z = 3.3 - p * 1.25;
    camera.updateProjectionMatrix();
  });

  return (
    <group ref={group}>
      {body && <primitive object={body} />}
      <primitive object={points} />
    </group>
  );
}

export default function HeroParticles({
  mode,
  sites,
  active,
  reducedMotion,
}: Props) {
  return (
    <Canvas
      className="!absolute inset-0"
      aria-hidden="true"
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 3.3], fov: 40, near: 0.1, far: 20 }}
      gl={{ antialias: false, alpha: true, powerPreference: "low-power" }}
      frameloop={reducedMotion ? "demand" : active ? "always" : "never"}
    >
      <Particles mode={mode} sites={sites} reducedMotion={reducedMotion} />
    </Canvas>
  );
}
