"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

/**
 * A GLB model on a light ground, turned with the mouse or a finger. It loads when it scrolls
 * into view and turns slowly on its own unless the visitor asks for reduced motion.
 */
export function ModelViewer({
  src,
  label,
  loadingText,
  height = 420,
}: {
  src: string;
  label: string;
  loadingText: string;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "failed">(
    "idle",
  );

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    let disposed = false;
    let cleanup = () => undefined as void;

    const start = () => {
      setState("loading");
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
      });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      host.appendChild(renderer.domElement);
      renderer.domElement.style.display = "block";
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0xcdefc0, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 2.2);
      sun.position.set(2, 3, 2);
      scene.add(sun);
      const camera = new THREE.PerspectiveCamera(35, 1, 0.001, 1000);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.autoRotate = !window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      controls.autoRotateSpeed = 0.8;

      const resize = () => {
        const w = host.clientWidth;
        renderer.setSize(w, height);
        camera.aspect = w / height;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(host);

      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      loader.load(
        src,
        (gltf) => {
          if (disposed) return;
          const model = gltf.scene;
          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3()).length();
          const center = box.getCenter(new THREE.Vector3());
          model.position.sub(center);
          scene.add(model);
          camera.near = size / 100;
          camera.far = size * 100;
          camera.position.set(size * 0.55, size * 0.35, size * 0.75);
          camera.updateProjectionMatrix();
          controls.target.set(0, 0, 0);
          controls.update();
          setState("ready");
        },
        undefined,
        () => !disposed && setState("failed"),
      );

      let raf = 0;
      const tick = () => {
        controls.update();
        renderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
      };
      tick();
      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        controls.dispose();
        scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          mesh.geometry?.dispose();
          const mats = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          mats.forEach((m) => m?.dispose());
        });
        renderer.dispose();
        renderer.domElement.remove();
      };
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          start();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(host);
    return () => {
      disposed = true;
      io.disconnect();
      cleanup();
    };
  }, [src, height]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-b from-sky to-cloud"
      style={{ height }}
    >
      {state !== "ready" && (
        <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          {state === "failed" ? "–" : loadingText}
        </p>
      )}
    </div>
  );
}
