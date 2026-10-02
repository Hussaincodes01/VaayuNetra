"use client";

// The hero Earth (React Three Fiber; the only three.js on the page). A daylight globe turned to India,
// with the five landfills pinned in their status colours. It sways a few degrees, Deonar's T1 pin
// pulses, and scrolling the hero zooms towards India. The canvas stops rendering off screen.
// Texture: public/hero/earth-albedo.webp, baked from NASA Blue Marble by scripts/bake_earth_texture.py.

import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { EARTH_CAMERA } from "./earth-frame";
import { getMapScene, subscribeMapScene, type MapScene } from "./map-bus";

export type EarthPin = {
  slug: string;
  lat: number;
  lon: number;
  colour: string;
  pulse: boolean;
};
type Props = {
  pins: EarthPin[];
  active: boolean;
  reducedMotion: boolean;
  /** Camera height above the globe's centre: drops the globe lower in the frame (0 = centred). */
  lift: number;
  onReady?: () => void;
};

const DEG = Math.PI / 180;
const INDIA = { lat: 22, lon: 79 };
const sceneProgress = (scene: MapScene) =>
  scene.kind === "hero" ? scene.progress : 1;

/** Point on three's SphereGeometry for an equirectangular texture (u = 0 at 180° W). */
function surface(lat: number, lon: number, r = 1): THREE.Vector3 {
  const theta = (90 - lat) * DEG;
  const phi = (lon + 180) * DEG;
  return new THREE.Vector3(
    -r * Math.cos(phi) * Math.sin(theta),
    r * Math.cos(theta),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

const earthVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// Daylight everywhere: the unlit side only falls to 80% so the globe never turns dark. The sun sits
// upper left with a faint warm tint; a pale haze builds towards the limb.
const earthFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uSun;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 col = texture2D(uMap, vUv).rgb;
    float ndl = dot(n, uSun);
    float lit = max(ndl, 0.0);
    col *= 0.8 + 0.28 * lit;
    col *= mix(vec3(1.0), vec3(1.04, 1.02, 0.95), lit);
    float fres = pow(1.0 - max(dot(n, normalize(vView)), 0.0), 2.4);
    col = mix(col, vec3(0.93, 0.97, 0.98), fres * 0.7);
    gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
  }
`;

const haloVertex = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const haloFragment = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    float rim = pow(clamp(0.78 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 2.2);
    gl_FragColor = vec4(0.94, 0.98, 1.0, rim * 1.6);
  }
`;

function Pin({
  pin,
  reducedMotion,
}: {
  pin: EarthPin;
  reducedMotion: boolean;
}) {
  const pulse = useRef<THREE.Mesh>(null);
  const { position, quaternion } = useMemo(() => {
    const p = surface(pin.lat, pin.lon, 1.004);
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      p.clone().normalize(),
    );
    return { position: p, quaternion: q };
  }, [pin.lat, pin.lon]);

  useFrame(({ clock }) => {
    if (!pulse.current) return;
    const t = (clock.elapsedTime % 2.8) / 2.8;
    pulse.current.scale.setScalar(1 + t * 2.4);
    (pulse.current.material as THREE.MeshBasicMaterial).opacity =
      0.55 * (1 - t);
  });

  return (
    <group position={position} quaternion={quaternion}>
      <mesh>
        <circleGeometry args={[0.03, 32]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0, 0, 0.001]}>
        <circleGeometry args={[0.021, 32]} />
        <meshBasicMaterial color={pin.colour} />
      </mesh>
      {pin.pulse && !reducedMotion && (
        <mesh ref={pulse} position={[0, 0, 0.0005]}>
          <ringGeometry args={[0.024, 0.032, 48]} />
          <meshBasicMaterial
            color={pin.colour}
            transparent
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}

function Earth({ pins, reducedMotion, lift, onReady }: Omit<Props, "active">) {
  const tilt = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const progress = useRef(sceneProgress(getMapScene()));
  const ready = useRef(false);
  const { camera, invalidate } = useThree();

  const map = useLoader(THREE.TextureLoader, "/hero/earth-albedo.webp");
  const material = useMemo(() => {
    map.colorSpace = THREE.NoColorSpace; // the shader writes the baked colours as authored
    map.anisotropy = 4;
    return new THREE.ShaderMaterial({
      vertexShader: earthVertex,
      fragmentShader: earthFragment,
      uniforms: {
        uMap: { value: map },
        uSun: { value: new THREE.Vector3(-0.55, 0.6, 0.6).normalize() },
      },
    });
  }, [map]);
  const halo = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: haloVertex,
        fragmentShader: haloFragment,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
      }),
    [],
  );
  useEffect(() => () => (material.dispose(), halo.dispose()), [material, halo]);

  useEffect(
    () =>
      subscribeMapScene((scene) => {
        progress.current = sceneProgress(scene);
        invalidate();
      }),
    [invalidate],
  );

  useFrame(({ clock }) => {
    if (!tilt.current || !spin.current) return;
    const p = Math.min(1, progress.current * 1.4);
    const ease = p * p * (3 - 2 * p);
    // Turn India to face the camera (lon 79° on this sphere sits at -90° - lon about the pole).
    const sway = reducedMotion
      ? 0
      : Math.sin(clock.elapsedTime * 0.12) * 0.12 * (1 - ease);
    spin.current.rotation.y = (-90 - INDIA.lon) * DEG + sway;
    tilt.current.rotation.x = INDIA.lat * DEG * (0.62 + 0.38 * ease);
    camera.position.set(0, lift * (1 - ease), EARTH_CAMERA.z - ease * 1.35);
    camera.updateProjectionMatrix();
    if (!ready.current) {
      ready.current = true;
      onReady?.();
    }
  });

  return (
    <group rotation={[0, 0, -0.18]}>
      <group ref={tilt}>
        <group ref={spin}>
          <mesh material={material}>
            <sphereGeometry args={[1, 128, 96]} />
          </mesh>
          {pins.map((pin) => (
            <Pin key={pin.slug} pin={pin} reducedMotion={reducedMotion} />
          ))}
        </group>
      </group>
      <mesh material={halo} scale={1.07}>
        <sphereGeometry args={[1, 64, 48]} />
      </mesh>
    </group>
  );
}

export default function HeroEarth({
  pins,
  active,
  reducedMotion,
  lift,
  onReady,
}: Props) {
  return (
    <Canvas
      className="!absolute inset-0"
      aria-hidden="true"
      dpr={[1, 2]}
      flat
      camera={{
        position: [0, lift, EARTH_CAMERA.z],
        // Look straight ahead (no lookAt the origin), so the camera's height drops the globe into the clouds.
        rotation: [0, 0, 0],
        fov: EARTH_CAMERA.fov,
        near: 0.1,
        far: 20,
      }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      frameloop={reducedMotion ? "demand" : active ? "always" : "never"}
    >
      <Suspense fallback={null}>
        <Earth
          pins={pins}
          reducedMotion={reducedMotion}
          lift={lift}
          onReady={onReady}
        />
      </Suspense>
    </Canvas>
  );
}
