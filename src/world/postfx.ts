import * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  GodRaysEffect,
  BloomEffect,
  VignetteEffect,
  SMAAEffect,
  KernelSize,
} from 'postprocessing';
import type { GameSettings } from '../types';

/**
 * The painterly finishing stack: god rays from the sun disc, soft bloom,
 * gentle vignette, SMAA. Quality tiers rebuild the pass chain.
 */
export class PostFX {
  private composer: EffectComposer;
  private godRays: GodRaysEffect | null = null;
  private quality: GameSettings['quality'] = 'high';

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private sun: THREE.Mesh,
  ) {
    this.composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
    });
    this.buildPasses();
  }

  private buildPasses(): void {
    this.composer.removeAllPasses();
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    if (this.quality === 'low') {
      this.godRays = null;
      this.composer.addPass(new EffectPass(this.camera, new VignetteEffect({ darkness: 0.42 })));
      return;
    }

    this.godRays = new GodRaysEffect(this.camera, this.sun as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>, {
      height: 360,
      kernelSize: KernelSize.SMALL,
      density: 0.96,
      decay: 0.94,
      weight: 0.5,
      exposure: 0.55,
      samples: this.quality === 'high' ? 60 : 36,
      clampMax: 1.0,
    });
    const bloom = new BloomEffect({
      intensity: 0.75,
      luminanceThreshold: 0.72,
      luminanceSmoothing: 0.18,
      mipmapBlur: true,
    });
    const vignette = new VignetteEffect({ darkness: 0.42, offset: 0.28 });
    const effects: Array<GodRaysEffect | BloomEffect | VignetteEffect | SMAAEffect> = [this.godRays, bloom, vignette];
    if (this.quality === 'high') effects.push(new SMAAEffect());
    this.composer.addPass(new EffectPass(this.camera, ...effects));
  }

  setQuality(q: GameSettings['quality']): void {
    if (q === this.quality) return;
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'low' ? Math.min(dpr, 1) * 0.75 : Math.min(dpr, 2));
    this.buildPasses();
    this.setSize(window.innerWidth, window.innerHeight);
  }

  /** Scale god-ray strength with how golden the light is. */
  setGolden(golden: number, sunVisible: boolean): void {
    if (!this.godRays) return;
    const m = this.godRays.godRaysMaterial;
    m.weight = sunVisible ? 0.28 + golden * 0.55 : 0;
    m.exposure = 0.4 + golden * 0.4;
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }
}
