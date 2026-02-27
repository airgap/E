/**
 * WebGL Renderer for ambient effects
 *
 * Uses real astronomical data from Yale Bright Star Catalog with:
 * - Real star positions (RA/Dec) with stereographic projection
 * - Real constellation connections that reveal on touch/hover
 * - Nebulae with lobes
 * - Spiral and elliptical galaxies
 * - Touch/pointer interaction for constellation reveal
 */
import {
  starVertexShader,
  starFragmentShader,
  nebulaVertexShader,
  nebulaFragmentShader,
  lineVertexShader,
  lineFragmentShader,
  galaxyVertexShader,
  galaxyFragmentShader,
  textureVertexShader,
  textureFragmentShader,
  blitVertexShader,
  blitFragmentShader,
  compileShader,
  createProgram,
} from './webgl-shaders';
import { HYPERTHEME_EFFECTS } from './types';
import {
  STAR_CATALOG,
  getStarColor,
  magnitudeToSize,
  magnitudeToBrightness,
  type CatalogStar,
} from './starCatalog';

/**
 * Hypertheme ID string used as theme key.
 * Maps to entries in HYPERTHEME_EFFECTS.
 */
type AmbientTheme = string;

/** Alias — lyku uses THEME_EFFECTS, E uses HYPERTHEME_EFFECTS */
const THEME_EFFECTS = HYPERTHEME_EFFECTS;

interface Star {
  // Celestial sphere coordinates (radians)
  ra: number; // Right Ascension (0 to 2π)
  dec: number; // Declination (-π/2 to π/2)
  // Screen position (computed from projection)
  x: number;
  y: number;
  visible: boolean; // Whether the star is in front of the viewer (not behind the sphere)
  size: number;
  baseSize: number;
  r: number;
  g: number;
  b: number;
  a: number;
  baseOpacity: number;
  opacity: number;
  twinkleSpeed: number;
  twinkleOffset: number;
  layer: number; // 0 = background/filler, 1 = medium, 2 = constellation star
  // Real star data (only for catalog stars)
  catalogStar?: CatalogStar;
  // Indices of connected stars (for constellation lines)
  connectionIndices: number[];
}

interface NebulaLobe {
  offsetX: number;
  offsetY: number;
  radiusA: number;
  radiusB: number;
  rotation: number;
  intensity: number;
}

interface Nebula {
  // Celestial coordinates (radians)
  ra: number;
  dec: number;
  // Screen position (computed from projection)
  x: number;
  y: number;
  visible: boolean; // Whether the object is in front of the viewer
  baseRadius: number; // Radius in field-of-view units
  radius: number; // Screen radius (computed)
  scale: number; // Current projection scale (for lobe sizing)
  r: number;
  g: number;
  b: number;
  a: number;
  baseOpacity: number; // Original opacity from config
  opacity: number; // Current opacity (faded near horizon)
  lobes: NebulaLobe[];
}

interface Galaxy {
  // Celestial coordinates (radians)
  ra: number;
  dec: number;
  // Screen position (computed from projection)
  x: number;
  y: number;
  visible: boolean; // Whether the object is in front of the viewer
  baseRadius: number; // Radius in field-of-view units
  radius: number; // Screen radius (computed)
  r: number;
  g: number;
  b: number;
  baseOpacity: number; // Original opacity from config
  opacity: number; // Current opacity (faded near horizon)
  rotation: number;
  tilt: number;
  type: 'spiral' | 'elliptical';
  arms: number;
}

interface Connection {
  star1: number;
  star2: number;
}

export class WebGLRenderer {
  private gl: WebGLRenderingContext | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private width = 0;
  private height = 0;
  private time = 0;
  private theme: AmbientTheme;
  private connectionDistance = 120;
  private scrollOffset = 0;
  private lastScrollOffset = 0;
  private scrollVelocity = 0;

  // Touch/pointer position for constellation reveal
  private pointerX = -1000;
  private pointerY = -1000;
  private revealRadius = 180; // Radius around touch to reveal constellations

  // Fast render mode (skip nebulae/galaxies during scroll)
  private fastRenderMode = false;

  // Celestial sphere view state
  private viewRa = Math.PI; // Center RA (looking at ~12h)
  private viewDec = 0.3; // Center Dec (slightly above equator)
  private targetViewDec = 0.3;
  private FOV = 2.1; // Field of view in radians (~120°)

  /** Projection scale — uses diagonal so stars fill the entire viewport edge-to-edge */
  private projectionScale(): number {
    const diag = Math.sqrt(this.width * this.width + this.height * this.height);
    return diag / this.FOV;
  }

  // Cached view state to avoid recalculating when unchanged
  private lastViewRa = Math.PI;
  private lastViewDec = 0.3;
  private lastPointerX = -1000;
  private lastPointerY = -1000;
  private viewChanged = true; // Force initial update

  // Star name to index mapping (for constellation connections)
  private starByName: Map<string, number> = new Map();

  // Shader programs
  private starProgram: WebGLProgram | null = null;
  private nebulaProgram: WebGLProgram | null = null;
  private lineProgram: WebGLProgram | null = null;
  private galaxyProgram: WebGLProgram | null = null;
  private textureProgram: WebGLProgram | null = null;

  // Buffers
  private starBuffer: WebGLBuffer | null = null;
  private nebulaBuffer: WebGLBuffer | null = null;
  private lineBuffer: WebGLBuffer | null = null;
  private quadBuffer: WebGLBuffer | null = null;

  // Star data
  private stars: Star[] = [];
  private starData: Float32Array | null = null;

  // Nebula data
  private nebulae: Nebula[] = [];

  // Galaxy data
  private galaxies: Galaxy[] = [];

  // Constellation connections
  private connections: Connection[] = [];
  private lineData: Float32Array | null = null;
  /** All star indices that appear as endpoints in any constellation connection */
  private constellationStarIndices: Set<number> = new Set();

  // Render-to-texture for card viewports
  private framebuffer: WebGLFramebuffer | null = null;
  private renderTexture: WebGLTexture | null = null;

  // Pre-rendered nebula/galaxy texture (only re-rendered when view changes)
  private bgFramebuffer: WebGLFramebuffer | null = null;
  private bgTexture: WebGLTexture | null = null;
  private bgNeedsUpdate = true;
  private lastBgViewRa = 0;
  private lastBgViewDec = 0;

  // Uniform locations (cached)
  private starUniforms: {
    resolution: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
    view: WebGLUniformLocation | null;
    scale: WebGLUniformLocation | null;
  } = { resolution: null, time: null, view: null, scale: null };

  private nebulaUniforms: {
    resolution: WebGLUniformLocation | null;
    center: WebGLUniformLocation | null;
    radius: WebGLUniformLocation | null;
    color: WebGLUniformLocation | null;
    opacity: WebGLUniformLocation | null;
  } = {
    resolution: null,
    center: null,
    radius: null,
    color: null,
    opacity: null,
  };

  private lineUniforms: {
    resolution: WebGLUniformLocation | null;
    color: WebGLUniformLocation | null;
  } = { resolution: null, color: null };

  private galaxyUniforms: {
    resolution: WebGLUniformLocation | null;
    center: WebGLUniformLocation | null;
    radius: WebGLUniformLocation | null;
    color: WebGLUniformLocation | null;
    opacity: WebGLUniformLocation | null;
    rotation: WebGLUniformLocation | null;
    tilt: WebGLUniformLocation | null;
    arms: WebGLUniformLocation | null;
    isSpiral: WebGLUniformLocation | null;
  } = {
    resolution: null,
    center: null,
    radius: null,
    color: null,
    opacity: null,
    rotation: null,
    tilt: null,
    arms: null,
    isSpiral: null,
  };

  // Simple blit program for compositing pre-rendered texture
  private blitProgram: WebGLProgram | null = null;
  private blitUniforms: {
    texture: WebGLUniformLocation | null;
  } = { texture: null };

  constructor(theme: AmbientTheme) {
    this.theme = theme;
  }

  /**
   * Initialize WebGL context and resources
   */
  init(canvas: HTMLCanvasElement, width: number, height: number): boolean {
    this.canvas = canvas;

    // Get WebGL context - alpha: false makes canvas fully opaque (no bleed-through)
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    }) as WebGLRenderingContext | null;

    if (!gl) {
      console.error('WebGL not supported');
      return false;
    }

    this.gl = gl;

    // Use actual drawing buffer size for viewport (critical for NativeScript)
    const bufferWidth = gl.drawingBufferWidth || width;
    const bufferHeight = gl.drawingBufferHeight || height;
    this.width = bufferWidth;
    this.height = bufferHeight;

    console.log(
      `WebGLRenderer: Buffer size ${bufferWidth}x${bufferHeight}, passed ${width}x${height}`,
    );

    // Set up viewport to match drawing buffer
    gl.viewport(0, 0, bufferWidth, bufferHeight);

    // Enable blending for transparency
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Create shader programs
    if (!this.createPrograms()) {
      return false;
    }

    // Create buffers
    this.createBuffers();

    // Initialize particles
    this.initParticles();

    // Set up render-to-texture
    this.setupRenderTexture();

    console.log(`WebGLRenderer: Initialized ${width}x${height}`);
    return true;
  }

  private createPrograms(): boolean {
    const gl = this.gl!;

    // Star program
    const starVS = compileShader(gl, starVertexShader, gl.VERTEX_SHADER);
    const starFS = compileShader(gl, starFragmentShader, gl.FRAGMENT_SHADER);
    if (!starVS || !starFS) return false;

    this.starProgram = createProgram(gl, starVS, starFS);
    if (!this.starProgram) return false;

    // Cache star uniform locations
    this.starUniforms.resolution = gl.getUniformLocation(this.starProgram, 'u_resolution');
    this.starUniforms.time = gl.getUniformLocation(this.starProgram, 'u_time');
    this.starUniforms.view = gl.getUniformLocation(this.starProgram, 'u_view');
    this.starUniforms.scale = gl.getUniformLocation(this.starProgram, 'u_scale');

    // Nebula program
    const nebulaVS = compileShader(gl, nebulaVertexShader, gl.VERTEX_SHADER);
    const nebulaFS = compileShader(gl, nebulaFragmentShader, gl.FRAGMENT_SHADER);
    if (!nebulaVS || !nebulaFS) return false;

    this.nebulaProgram = createProgram(gl, nebulaVS, nebulaFS);
    if (!this.nebulaProgram) return false;

    // Cache nebula uniform locations
    this.nebulaUniforms.resolution = gl.getUniformLocation(this.nebulaProgram, 'u_resolution');
    this.nebulaUniforms.center = gl.getUniformLocation(this.nebulaProgram, 'u_center');
    this.nebulaUniforms.radius = gl.getUniformLocation(this.nebulaProgram, 'u_radius');
    this.nebulaUniforms.color = gl.getUniformLocation(this.nebulaProgram, 'u_color');
    this.nebulaUniforms.opacity = gl.getUniformLocation(this.nebulaProgram, 'u_opacity');

    // Line program (for constellation connections)
    const lineVS = compileShader(gl, lineVertexShader, gl.VERTEX_SHADER);
    const lineFS = compileShader(gl, lineFragmentShader, gl.FRAGMENT_SHADER);
    if (!lineVS || !lineFS) return false;

    this.lineProgram = createProgram(gl, lineVS, lineFS);
    if (!this.lineProgram) return false;

    this.lineUniforms.resolution = gl.getUniformLocation(this.lineProgram, 'u_resolution');
    this.lineUniforms.color = gl.getUniformLocation(this.lineProgram, 'u_color');

    // Galaxy program
    const galaxyVS = compileShader(gl, galaxyVertexShader, gl.VERTEX_SHADER);
    const galaxyFS = compileShader(gl, galaxyFragmentShader, gl.FRAGMENT_SHADER);
    if (!galaxyVS || !galaxyFS) return false;

    this.galaxyProgram = createProgram(gl, galaxyVS, galaxyFS);
    if (!this.galaxyProgram) return false;

    this.galaxyUniforms.resolution = gl.getUniformLocation(this.galaxyProgram, 'u_resolution');
    this.galaxyUniforms.center = gl.getUniformLocation(this.galaxyProgram, 'u_center');
    this.galaxyUniforms.radius = gl.getUniformLocation(this.galaxyProgram, 'u_radius');
    this.galaxyUniforms.color = gl.getUniformLocation(this.galaxyProgram, 'u_color');
    this.galaxyUniforms.opacity = gl.getUniformLocation(this.galaxyProgram, 'u_opacity');
    this.galaxyUniforms.rotation = gl.getUniformLocation(this.galaxyProgram, 'u_rotation');
    this.galaxyUniforms.tilt = gl.getUniformLocation(this.galaxyProgram, 'u_tilt');
    this.galaxyUniforms.arms = gl.getUniformLocation(this.galaxyProgram, 'u_arms');
    this.galaxyUniforms.isSpiral = gl.getUniformLocation(this.galaxyProgram, 'u_isSpiral');

    // Texture program (for card viewports)
    const texVS = compileShader(gl, textureVertexShader, gl.VERTEX_SHADER);
    const texFS = compileShader(gl, textureFragmentShader, gl.FRAGMENT_SHADER);
    if (!texVS || !texFS) return false;

    this.textureProgram = createProgram(gl, texVS, texFS);
    if (!this.textureProgram) return false;

    // Blit program (for compositing pre-rendered nebulae/galaxies)
    const blitVS = compileShader(gl, blitVertexShader, gl.VERTEX_SHADER);
    const blitFS = compileShader(gl, blitFragmentShader, gl.FRAGMENT_SHADER);
    if (!blitVS || !blitFS) return false;

    this.blitProgram = createProgram(gl, blitVS, blitFS);
    if (!this.blitProgram) return false;

    this.blitUniforms.texture = gl.getUniformLocation(this.blitProgram, 'u_texture');

    return true;
  }

  private createBuffers(): void {
    const gl = this.gl!;

    // Star buffer (will be filled with particle data)
    this.starBuffer = gl.createBuffer();

    // Line buffer (for constellation connections)
    this.lineBuffer = gl.createBuffer();

    // Nebula buffer (fullscreen quad vertices)
    this.nebulaBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nebulaBuffer);
    // Fullscreen quad
    const quadVerts = new Float32Array([
      0,
      0,
      this.width,
      0,
      0,
      this.height,
      0,
      this.height,
      this.width,
      0,
      this.width,
      this.height,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

    // Quad buffer for texture sampling
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    // NDC quad with texture coords
    const texQuad = new Float32Array([
      // position (x, y), texCoord (u, v)
      -1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, -1, 1, 0, 1, 1, -1, 1, 0, 1, 1, 1, 1,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, texQuad, gl.STATIC_DRAW);
  }

  /**
   * Seeded random for consistent generation
   */
  private seededRandom(seed: number): () => number {
    return () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }

  /**
   * Stereographic projection of celestial coordinates to screen
   */
  private projectStar(
    starRa: number,
    starDec: number,
    centerRa: number,
    centerDec: number,
    scale: number,
  ): { x: number; y: number; visible: boolean } {
    // Convert to 3D Cartesian coordinates on unit sphere
    const cosStarDec = Math.cos(starDec);
    const starX = cosStarDec * Math.cos(starRa);
    const starY = cosStarDec * Math.sin(starRa);
    const starZ = Math.sin(starDec);

    // Rotate so centerRa/centerDec is at the "front" (positive X axis)
    // First rotate around Z axis by -centerRa
    const cosRa = Math.cos(-centerRa);
    const sinRa = Math.sin(-centerRa);
    const x1 = starX * cosRa - starY * sinRa;
    const y1 = starX * sinRa + starY * cosRa;
    const z1 = starZ;

    // Then rotate around Y axis by -centerDec
    const cosDec = Math.cos(-centerDec);
    const sinDec = Math.sin(-centerDec);
    const x2 = x1 * cosDec + z1 * sinDec;
    const y2 = y1;
    const z2 = -x1 * sinDec + z1 * cosDec;

    // Stars behind the viewer (x2 <= 0) are not visible
    if (x2 <= 0.01) {
      return { x: 0, y: 0, visible: false };
    }

    // Stereographic projection: project onto plane at x=1
    const denom = 1 + x2;
    const projY = (2 * y2) / denom;
    const projZ = (2 * z2) / denom;

    // Convert to screen coordinates
    return {
      x: projY * scale,
      y: -projZ * scale, // Flip Y for screen coordinates
      visible: true,
    };
  }

  /**
   * Like projectStar but with a smooth fade near the horizon instead of a hard cut.
   * Used for nebulae and galaxies which are large enough that a hard visibility
   * toggle causes a visible color flash across the entire screen.
   */
  private projectStarSmooth(
    starRa: number,
    starDec: number,
    centerRa: number,
    centerDec: number,
    scale: number,
  ): { x: number; y: number; visible: boolean; fade: number } {
    const cosStarDec = Math.cos(starDec);
    const starX = cosStarDec * Math.cos(starRa);
    const starY = cosStarDec * Math.sin(starRa);
    const starZ = Math.sin(starDec);

    const cosRa = Math.cos(-centerRa);
    const sinRa = Math.sin(-centerRa);
    const x1 = starX * cosRa - starY * sinRa;
    const y1 = starX * sinRa + starY * cosRa;
    const z1 = starZ;

    const cosDec = Math.cos(-centerDec);
    const sinDec = Math.sin(-centerDec);
    const x2 = x1 * cosDec + z1 * sinDec;
    const y2 = y1;
    const z2 = -x1 * sinDec + z1 * cosDec;

    // Hard cull only when well behind the viewer
    if (x2 <= -0.3) {
      return { x: 0, y: 0, visible: false, fade: 0 };
    }

    // Smooth fade from full opacity (x2 >= 0.4) to zero (x2 <= -0.1)
    // This prevents the color flash when large objects cross the horizon
    const fade = Math.min(1, Math.max(0, (x2 + 0.1) / 0.5));

    const denom = 1 + Math.max(x2, 0.01);
    const projY = (2 * y2) / denom;
    const projZ = (2 * z2) / denom;

    return {
      x: projY * scale,
      y: -projZ * scale,
      visible: fade > 0,
      fade,
    };
  }

  private initParticles(): void {
    const themeConfig = THEME_EFFECTS[this.theme];
    // More stars for the celestial sphere (filler stars)
    const starCount = Math.max(500, themeConfig.config.count * 3);
    const minDim = Math.min(this.width, this.height);

    const colorOptions = [
      themeConfig.colors.particleColor1,
      themeConfig.colors.particleColor2,
      themeConfig.colors.particleColor3,
    ];

    // === Create nebulae at real celestial positions ===
    // Generate 2-4 lobes per nebula (matching webui)
    const generateLobes = (seed: number, baseRadius: number): NebulaLobe[] => {
      const lobeRng = this.seededRandom(seed);
      const lobeCount = 2 + Math.floor(lobeRng() * 3); // 2-4 lobes
      return Array.from({ length: lobeCount }, () => ({
        offsetX: (lobeRng() - 0.5) * baseRadius * 0.8,
        offsetY: (lobeRng() - 0.5) * baseRadius * 0.8,
        radiusA: baseRadius * (0.6 + lobeRng() * 0.6),
        radiusB: baseRadius * (0.4 + lobeRng() * 0.5),
        rotation: lobeRng() * Math.PI,
        intensity: 0.6 + lobeRng() * 0.4,
      }));
    };

    // Nebulae with multiple lobes each, larger sizes (matching webui proportions)
    // baseRadius in FOV units - will be scaled by (minDim / FOV)
    this.nebulae = [
      // Near initial view center (ra ≈ π) - guaranteed visible on load
      {
        ra: 3.0,
        dec: 0.15,
        baseRadius: 0.5,
        color: 'rgba(150, 100, 255,',
        opacity: 0.15,
        lobes: generateLobes(1000, 0.5),
      },
      // Orion Nebula region
      {
        ra: 1.45,
        dec: -0.09,
        baseRadius: 0.45,
        color: 'rgba(255, 100, 150,',
        opacity: 0.12,
        lobes: generateLobes(1001, 0.45),
      },
      // Carina region
      {
        ra: 2.8,
        dec: -0.4,
        baseRadius: 0.55,
        color: 'rgba(255, 120, 100,',
        opacity: 0.12,
        lobes: generateLobes(1002, 0.55),
      },
      // Cygnus region
      {
        ra: 5.35,
        dec: 0.5,
        baseRadius: 0.6,
        color: 'rgba(100, 150, 255,',
        opacity: 0.1,
        lobes: generateLobes(1003, 0.6),
      },
      // Sagittarius (galactic center) - big diffuse glow
      {
        ra: 4.7,
        dec: -0.2,
        baseRadius: 0.7,
        color: 'rgba(255, 200, 150,',
        opacity: 0.1,
        lobes: generateLobes(1004, 0.7),
      },
      // Pleiades area
      {
        ra: 0.98,
        dec: 0.35,
        baseRadius: 0.4,
        color: 'rgba(150, 180, 255,',
        opacity: 0.12,
        lobes: generateLobes(1005, 0.4),
      },
    ].map((n) => {
      const c = this.parseRgba(n.color + '1)') || {
        r: 0.5,
        g: 0.3,
        b: 0.8,
        a: 1,
      };
      return {
        ...n,
        baseOpacity: n.opacity,
        x: 0,
        y: 0,
        visible: true,
        radius: 0,
        scale: 1,
        r: c.r,
        g: c.g,
        b: c.b,
        a: c.a,
      };
    });

    // === Create galaxies at real celestial positions ===
    // Reduced to 6 galaxies for performance (6 draw calls)
    this.galaxies = [
      // M31 - Andromeda Galaxy (the big one!)
      {
        ra: (0.712 * Math.PI) / 12,
        dec: (41.27 * Math.PI) / 180,
        baseRadius: 0.1,
        rotation: 0.65,
        tilt: 0.77,
        type: 'spiral' as const,
        arms: 2,
        color: 'rgba(200, 180, 255,',
        opacity: 0.18,
      },
      // M51 - Whirlpool Galaxy
      {
        ra: (13.498 * Math.PI) / 12,
        dec: (47.2 * Math.PI) / 180,
        baseRadius: 0.03,
        rotation: 2.9,
        tilt: 0.2,
        type: 'spiral' as const,
        arms: 2,
        color: 'rgba(180, 190, 255,',
        opacity: 0.12,
      },
      // M104 - Sombrero Galaxy
      {
        ra: (12.666 * Math.PI) / 12,
        dec: (-11.62 * Math.PI) / 180,
        baseRadius: 0.03,
        rotation: 1.57,
        tilt: 0.84,
        type: 'spiral' as const,
        arms: 2,
        color: 'rgba(255, 240, 200,',
        opacity: 0.14,
      },
      // LMC - Large Magellanic Cloud
      {
        ra: (5.393 * Math.PI) / 12,
        dec: (-69.76 * Math.PI) / 180,
        baseRadius: 0.15,
        rotation: 0,
        tilt: 0.25,
        type: 'elliptical' as const,
        arms: 0,
        color: 'rgba(180, 200, 255,',
        opacity: 0.1,
      },
      // M87 - Virgo A (elliptical)
      {
        ra: (12.514 * Math.PI) / 12,
        dec: (12.39 * Math.PI) / 180,
        baseRadius: 0.04,
        rotation: 0,
        tilt: 0.3,
        type: 'elliptical' as const,
        arms: 0,
        color: 'rgba(255, 220, 180,',
        opacity: 0.12,
      },
      // M101 - Pinwheel Galaxy
      {
        ra: (14.054 * Math.PI) / 12,
        dec: (54.35 * Math.PI) / 180,
        baseRadius: 0.04,
        rotation: 0.8,
        tilt: 0.15,
        type: 'spiral' as const,
        arms: 4,
        color: 'rgba(180, 200, 255,',
        opacity: 0.12,
      },
    ].map((g) => {
      const c = this.parseRgba(g.color + '1)') || {
        r: 0.5,
        g: 0.3,
        b: 0.8,
        a: 1,
      };
      return {
        ...g,
        baseOpacity: g.opacity,
        x: 0,
        y: 0,
        visible: true,
        radius: 0,
        r: c.r,
        g: c.g,
        b: c.b,
      };
    });

    // === Create stars from real catalog + filler stars ===
    this.stars = [];
    this.starByName.clear();
    const rng = this.seededRandom(42);

    // First, add all real catalog stars
    for (const catalogStar of STAR_CATALOG) {
      const colorStr = getStarColor(catalogStar.spectralType);
      const color = this.parseRgba(colorStr) || { r: 1, g: 1, b: 1, a: 1 };
      const baseSize = magnitudeToSize(catalogStar.magnitude);
      const baseOpacity = magnitudeToBrightness(catalogStar.magnitude);

      // Stars with connections are constellation stars (layer 2)
      const isConstellationStar = catalogStar.connections && catalogStar.connections.length > 0;

      const starIndex = this.stars.length;
      this.starByName.set(catalogStar.name, starIndex);

      this.stars.push({
        ra: catalogStar.ra,
        dec: catalogStar.dec,
        x: 0,
        y: 0,
        visible: true,
        size: baseSize,
        baseSize,
        r: color.r,
        g: color.g,
        b: color.b,
        a: color.a,
        baseOpacity: isConstellationStar ? baseOpacity * 1.2 : baseOpacity,
        opacity: baseOpacity,
        twinkleSpeed: 1 + rng() * 2,
        twinkleOffset: rng() * Math.PI * 2,
        layer: isConstellationStar ? 2 : 1,
        catalogStar,
        connectionIndices: [], // Will be filled after all stars are added
      });
    }

    // Build connection indices from star names
    for (let i = 0; i < this.stars.length; i++) {
      const star = this.stars[i];
      if (star.catalogStar?.connections) {
        for (const connName of star.catalogStar.connections) {
          const connIndex = this.starByName.get(connName);
          if (connIndex !== undefined) {
            star.connectionIndices.push(connIndex);
          }
        }
      }
    }

    // Add filler stars for density (dimmer, no connections)
    const fillerCount = Math.max(200, starCount - this.stars.length);
    for (let i = 0; i < fillerCount; i++) {
      const u = rng();
      const v = rng();
      const ra = u * Math.PI * 2;
      const dec = Math.asin(2 * v - 1);

      const color = this.getRandomStarColor();
      const size = 0.3 + rng() * 0.7;
      const baseOpacity = 0.15 + rng() * 0.25;

      this.stars.push({
        ra,
        dec,
        x: 0,
        y: 0,
        visible: true,
        size,
        baseSize: size,
        ...color,
        baseOpacity,
        opacity: baseOpacity,
        twinkleSpeed: 0.5 + rng() * 1.5,
        twinkleOffset: rng() * Math.PI * 2,
        layer: 0, // Background filler
        connectionIndices: [],
      });
    }

    // Pre-allocate star data array for GPU projection:
    // ra, dec, baseSize, r, g, b, a, baseOpacity, twinkleSpeed, twinkleOffset per star
    this.starData = new Float32Array(this.stars.length * 10);

    // Fill buffer with static star data (uploaded once to GPU)
    for (let i = 0; i < this.stars.length; i++) {
      const star = this.stars[i];
      const offset = i * 10;
      this.starData[offset] = star.ra;
      this.starData[offset + 1] = star.dec;
      this.starData[offset + 2] = star.baseSize;
      this.starData[offset + 3] = star.r;
      this.starData[offset + 4] = star.g;
      this.starData[offset + 5] = star.b;
      this.starData[offset + 6] = star.a;
      this.starData[offset + 7] = star.baseOpacity;
      this.starData[offset + 8] = star.twinkleSpeed;
      this.starData[offset + 9] = star.twinkleOffset;
    }

    // Upload static star data to GPU buffer once
    const gl = this.gl!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.starData, gl.STATIC_DRAW);

    // Build connections list from constellation data
    this.buildConnections();
  }

  /**
   * Build constellation connections from star connection data
   */
  private buildConnections(): void {
    this.connections = [];
    this.constellationStarIndices.clear();
    const addedConnections = new Set<string>();

    for (let i = 0; i < this.stars.length; i++) {
      const star = this.stars[i];
      for (const connIndex of star.connectionIndices) {
        // Avoid duplicate connections (A->B and B->A)
        const key = i < connIndex ? `${i}-${connIndex}` : `${connIndex}-${i}`;
        if (!addedConnections.has(key)) {
          addedConnections.add(key);
          this.connections.push({ star1: i, star2: connIndex });
          // Track BOTH endpoints so they get projected for line rendering
          this.constellationStarIndices.add(i);
          this.constellationStarIndices.add(connIndex);
        }
      }
    }

    // Pre-allocate line data
    this.lineData = new Float32Array(this.connections.length * 6);
    console.log(
      `WebGLRenderer: ${STAR_CATALOG.length} catalog stars, ${this.connections.length} constellation connections`,
    );
  }

  private updateLineBuffer(): void {
    if (!this.lineData) return;

    for (let i = 0; i < this.connections.length; i++) {
      const conn = this.connections[i];
      const s1 = this.stars[conn.star1];
      const s2 = this.stars[conn.star2];

      // Only draw line if both stars are in front of the viewer and near the pointer
      let alpha = 0;
      if (s1.visible && s2.visible && this.pointerX > 0) {
        // Check distance from pointer to each star
        const dx1 = s1.x - this.pointerX;
        const dy1 = s1.y - this.pointerY;
        const dist1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);

        const dx2 = s2.x - this.pointerX;
        const dy2 = s2.y - this.pointerY;
        const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

        // Only show line if either star is near the pointer (touch reveal)
        const nearPointer = dist1 < this.revealRadius || dist2 < this.revealRadius;
        if (nearPointer) {
          const minDist = Math.min(dist1, dist2);
          // Alpha based on proximity to pointer (closer = more visible)
          alpha = (1 - minDist / this.revealRadius) * 0.8;
          alpha = Math.max(0, alpha);
        }
      }

      const offset = i * 6;
      this.lineData[offset] = s1.x;
      this.lineData[offset + 1] = s1.y;
      this.lineData[offset + 2] = alpha;
      this.lineData[offset + 3] = s2.x;
      this.lineData[offset + 4] = s2.y;
      this.lineData[offset + 5] = alpha;
    }
  }

  private getRandomStarColor(): { r: number; g: number; b: number; a: number } {
    const themeConfig = THEME_EFFECTS[this.theme];
    const colors = [
      themeConfig.colors.particleColor1,
      themeConfig.colors.particleColor2,
      themeConfig.colors.particleColor3,
    ];
    const colorStr = colors[Math.floor(Math.random() * colors.length)];
    return this.parseRgba(colorStr) || { r: 1, g: 1, b: 1, a: 1 };
  }

  private parseColor(hex: string): {
    r: number;
    g: number;
    b: number;
    a: number;
  } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (result) {
      return {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255,
        a: 1.0,
      };
    }
    return { r: 1, g: 1, b: 1, a: 1 };
  }

  private parseRgba(colorStr: string): { r: number; g: number; b: number; a: number } | null {
    // Parse rgba(r, g, b, a) format
    const rgbaMatch = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/i.exec(
      colorStr,
    );
    if (rgbaMatch) {
      return {
        r: parseInt(rgbaMatch[1], 10) / 255,
        g: parseInt(rgbaMatch[2], 10) / 255,
        b: parseInt(rgbaMatch[3], 10) / 255,
        a: rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1.0,
      };
    }
    // Try hex format
    const hexMatch = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(colorStr);
    if (hexMatch) {
      return {
        r: parseInt(hexMatch[1], 16) / 255,
        g: parseInt(hexMatch[2], 16) / 255,
        b: parseInt(hexMatch[3], 16) / 255,
        a: 1.0,
      };
    }
    return null;
  }

  private setupRenderTexture(): void {
    const gl = this.gl!;

    // Create framebuffer for card viewports
    this.framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);

    // Create texture
    this.renderTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.renderTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      this.width,
      this.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );

    // Set texture parameters
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Attach texture to framebuffer
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.renderTexture,
      0,
    );

    // Create background framebuffer for pre-rendered nebulae/galaxies
    this.bgFramebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bgFramebuffer);

    this.bgTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.bgTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      this.width,
      this.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.bgTexture, 0);

    // Unbind
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.bgNeedsUpdate = true;
  }

  // Profiling counters
  private profileFrame = 0;
  private profileTimes: { [key: string]: number } = {};

  /**
   * Update particle positions
   * Stars are now projected on GPU - only need to update view state and few objects
   */
  update(deltaTime: number): void {
    const t0 = performance.now();
    this.time += deltaTime / 1000;

    // Calculate scroll velocity (smoothed)
    const velocity = Math.abs(this.scrollOffset - this.lastScrollOffset);
    this.lastScrollOffset = this.scrollOffset;
    this.scrollVelocity = this.scrollVelocity * 0.9 + velocity * 0.1;

    // Update view declination based on scroll (rotate through celestial sphere)
    // Endless rotation - no clamping, ~20000px scroll for full rotation
    const scrollToDecRate = 0.0002; // Match webui rate
    this.targetViewDec = 0.3 + this.scrollOffset * scrollToDecRate;

    // Fast interpolation for responsive scrolling
    let dDec = this.targetViewDec - this.viewDec;
    // Normalize to -π to π for shortest path
    while (dDec > Math.PI) dDec -= 2 * Math.PI;
    while (dDec < -Math.PI) dDec += 2 * Math.PI;
    if (Math.abs(dDec) > 0.001) {
      this.viewDec += dDec * 0.25; // Faster response (25% per frame)
    }

    // Very slow RA drift for subtle motion even when not scrolling
    this.viewRa += deltaTime * 0.00001;
    if (this.viewRa > Math.PI * 2) this.viewRa -= Math.PI * 2;

    // Check if view changed (threshold for floating point)
    const viewThreshold = 0.0001;
    const viewChanged =
      Math.abs(this.viewRa - this.lastViewRa) > viewThreshold ||
      Math.abs(this.viewDec - this.lastViewDec) > viewThreshold;

    // Mark background for re-render if view changed significantly
    // Use larger threshold to avoid re-rendering every frame during scroll
    const bgThreshold = 0.02; // ~1 degree change triggers re-render
    if (
      Math.abs(this.viewRa - this.lastBgViewRa) > bgThreshold ||
      Math.abs(this.viewDec - this.lastBgViewDec) > bgThreshold
    ) {
      this.bgNeedsUpdate = true;
    }

    const t1 = performance.now();

    // Always update nebulae/galaxies - only 12 objects, very cheap
    // This ensures they rotate smoothly with the stars
    this.updateNebulaPositions();
    this.updateGalaxyPositions();

    // Only update constellation star positions when view changed
    if (viewChanged || this.viewChanged) {
      this.lastViewRa = this.viewRa;
      this.lastViewDec = this.viewDec;
      this.viewChanged = false;

      // Only project constellation stars for line buffer (~200 vs 3000)
      this.updateConstellationStarPositions();
    }

    const t2 = performance.now();

    // Update line buffer for constellation reveal (uses cached screen positions)
    this.updateLineBuffer();
    const t3 = performance.now();

    this.profileFrame++;
  }

  /**
   * Update only constellation star screen positions (for line rendering)
   * Much faster than projecting all 3000 stars - only ~200 constellation stars
   */
  private updateConstellationStarPositions(): void {
    const scale = this.projectionScale();
    const centerX = this.width / 2;
    const centerY = this.height / 2;

    // Project all stars that appear in any constellation connection (both endpoints)
    for (const idx of this.constellationStarIndices) {
      const star = this.stars[idx];
      const proj = this.projectStar(star.ra, star.dec, this.viewRa, this.viewDec, scale);
      star.visible = proj.visible;
      if (proj.visible) {
        star.x = centerX + proj.x;
        star.y = centerY + proj.y;
      }
    }
  }

  /**
   * Update star screen positions from celestial projection (expensive)
   */
  private updateStarPositions(): void {
    const scale = this.projectionScale();
    const centerX = this.width / 2;
    const centerY = this.height / 2;

    for (const star of this.stars) {
      const proj = this.projectStar(star.ra, star.dec, this.viewRa, this.viewDec, scale);
      star.visible = proj.visible;
      if (proj.visible) {
        star.x = centerX + proj.x;
        star.y = centerY + proj.y;
      }
    }
  }

  /**
   * Update star twinkle/glow and buffer (cheap, runs every frame)
   */
  private updateStarTwinkle(): void {
    if (!this.starData) return;

    const velocityFactor = Math.min(this.scrollVelocity / 50, 1);

    for (let i = 0; i < this.stars.length; i++) {
      const star = this.stars[i];
      const offset = i * 8;

      // Calculate twinkle
      const sinVal = Math.sin(this.time * star.twinkleSpeed + star.twinkleOffset);
      const twinkleFactor = sinVal > 0 ? sinVal : sinVal * 0.3;
      const glowBoost = velocityFactor * 0.25;
      star.opacity = star.baseOpacity * (0.7 + twinkleFactor * 0.3) + glowBoost;

      // Constellation star glow near pointer
      let size = star.baseSize;
      if (star.layer === 2 && star.connectionIndices.length > 0 && this.pointerX > 0) {
        const dx = star.x - this.pointerX;
        const dy = star.y - this.pointerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < this.revealRadius) {
          const proximityFactor = 1 - dist / this.revealRadius;
          size = star.baseSize * (1 + proximityFactor * 0.5);
          star.opacity = star.opacity + proximityFactor * (1 - star.opacity);
        }
      }
      star.size = size;

      // Update buffer
      this.starData[offset] = star.x;
      this.starData[offset + 1] = star.y;
      this.starData[offset + 2] = star.size;
      this.starData[offset + 3] = star.r;
      this.starData[offset + 4] = star.g;
      this.starData[offset + 5] = star.b;
      this.starData[offset + 6] = star.a;
      this.starData[offset + 7] = star.opacity;
    }
  }

  /**
   * Update nebula screen positions from celestial projection
   */
  private updateNebulaPositions(): void {
    const scale = this.projectionScale();
    const centerX = this.width / 2;
    const centerY = this.height / 2;

    for (const nebula of this.nebulae) {
      const proj = this.projectStarSmooth(nebula.ra, nebula.dec, this.viewRa, this.viewDec, scale);
      nebula.visible = proj.visible;
      nebula.opacity = nebula.baseOpacity * proj.fade;
      nebula.x = centerX + proj.x;
      nebula.y = centerY + proj.y;
      // Scale radius based on FOV
      nebula.radius = nebula.baseRadius * scale;
      nebula.scale = scale; // Store scale for lobe sizing
    }
  }

  /**
   * Update galaxy screen positions from celestial projection
   */
  private updateGalaxyPositions(): void {
    const scale = this.projectionScale();
    const centerX = this.width / 2;
    const centerY = this.height / 2;

    for (const galaxy of this.galaxies) {
      const proj = this.projectStarSmooth(galaxy.ra, galaxy.dec, this.viewRa, this.viewDec, scale);
      galaxy.visible = proj.visible;
      galaxy.opacity = galaxy.baseOpacity * proj.fade;
      galaxy.x = centerX + proj.x;
      galaxy.y = centerY + proj.y;
      // Scale radius based on FOV
      galaxy.radius = galaxy.baseRadius * scale;
    }
  }

  /**
   * Render the full effect
   */
  render(): void {
    const t0 = performance.now();
    const gl = this.gl!;

    // Update viewport to current drawing buffer size (may change)
    const bufferWidth = gl.drawingBufferWidth;
    const bufferHeight = gl.drawingBufferHeight;

    // Guard against invalid buffer sizes (can happen during scroll/resize)
    if (bufferWidth <= 0 || bufferHeight <= 0) {
      return;
    }

    // Only reinitialize if size changed significantly (not just rounding differences)
    const sizeDiff = Math.abs(bufferWidth - this.width) + Math.abs(bufferHeight - this.height);
    if (sizeDiff > 2 && this.width > 0 && this.height > 0) {
      console.log(
        `WebGL: Buffer resize ${this.width}x${this.height} -> ${bufferWidth}x${bufferHeight}`,
      );
      this.width = bufferWidth;
      this.height = bufferHeight;
      gl.viewport(0, 0, bufferWidth, bufferHeight);
      // Reinitialize particles at new size
      this.initParticles();
    } else if (this.width === 0) {
      // First init
      this.width = bufferWidth;
      this.height = bufferHeight;
      gl.viewport(0, 0, bufferWidth, bufferHeight);
    }

    // Get background color from theme
    const config = THEME_EFFECTS[this.theme];
    const bgColor = this.parseColor(config.colors.backgroundColor);

    // Clear main buffer with theme background
    gl.clearColor(bgColor.r, bgColor.g, bgColor.b, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const t1 = performance.now();

    // Always render nebulae/galaxies (they're part of the celestial sphere)
    this.renderNebulae();
    this.renderGalaxies();

    // Render dynamic elements: constellation lines -> stars
    this.renderLines();
    this.renderStars();
    const t5 = performance.now();

    // NativeScript canvas requires flush() to display
    if (this.canvas && typeof (this.canvas as any).flush === 'function') {
      (this.canvas as any).flush();
    }
    const t6 = performance.now();

    // Render timing every 300 frames (offset from fps log)
    if (this.profileFrame % 300 === 150) {
      console.log(
        `WebGL Render: ${(t6 - t0).toFixed(1)}ms, stars=${this.stars.length}, fastMode=${this.fastRenderMode}`,
      );
    }
  }

  /**
   * Render the pre-rendered background texture (nebulae/galaxies)
   */
  private renderBackgroundTexture(): void {
    const gl = this.gl!;
    if (!this.blitProgram || !this.bgTexture) return;

    gl.useProgram(this.blitProgram);

    // Bind the pre-rendered texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.bgTexture);
    gl.uniform1i(this.blitUniforms.texture, 0);

    // Create a simple fullscreen quad on the fly
    const quadVerts = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

    const tempBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, tempBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(this.blitProgram, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.deleteBuffer(tempBuffer);
  }

  private renderNebulae(): void {
    const gl = this.gl!;
    if (!this.nebulaProgram) return;

    gl.useProgram(this.nebulaProgram);

    // Set resolution uniform
    gl.uniform2f(this.nebulaUniforms.resolution, this.width, this.height);

    // Bind quad buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nebulaBuffer);

    const posLoc = gl.getAttribLocation(this.nebulaProgram, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // Render each nebula's lobes (skip if behind viewer)
    for (const nebula of this.nebulae) {
      if (!nebula.visible) continue;
      const s = nebula.scale; // Scale factor for lobe sizing
      for (const lobe of nebula.lobes) {
        // Scale lobe offsets and radii by projection scale
        const lobeX = nebula.x + lobe.offsetX * s;
        const lobeY = nebula.y + lobe.offsetY * s;
        const lobeOpacity = nebula.opacity * lobe.intensity;
        const maxLobeRadius = Math.max(lobe.radiusA, lobe.radiusB) * s;

        gl.uniform2f(this.nebulaUniforms.center, lobeX, lobeY);
        gl.uniform1f(this.nebulaUniforms.radius, maxLobeRadius);
        gl.uniform4f(this.nebulaUniforms.color, nebula.r, nebula.g, nebula.b, nebula.a);
        gl.uniform1f(this.nebulaUniforms.opacity, lobeOpacity);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    }
  }

  private renderGalaxies(): void {
    const gl = this.gl!;
    if (!this.galaxyProgram) return;

    gl.useProgram(this.galaxyProgram);
    gl.uniform2f(this.galaxyUniforms.resolution, this.width, this.height);

    // Bind quad buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nebulaBuffer);

    const posLoc = gl.getAttribLocation(this.galaxyProgram, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // Render each galaxy (skip if behind viewer)
    for (const galaxy of this.galaxies) {
      if (!galaxy.visible) continue;
      gl.uniform2f(this.galaxyUniforms.center, galaxy.x, galaxy.y);
      gl.uniform1f(this.galaxyUniforms.radius, galaxy.radius);
      gl.uniform4f(this.galaxyUniforms.color, galaxy.r, galaxy.g, galaxy.b, 1.0);
      gl.uniform1f(this.galaxyUniforms.opacity, galaxy.opacity);
      gl.uniform1f(this.galaxyUniforms.rotation, galaxy.rotation);
      gl.uniform1f(this.galaxyUniforms.tilt, galaxy.tilt);
      gl.uniform1f(this.galaxyUniforms.arms, galaxy.arms);
      gl.uniform1f(this.galaxyUniforms.isSpiral, galaxy.type === 'spiral' ? 1.0 : 0.0);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  private renderLines(): void {
    const gl = this.gl!;
    if (!this.lineProgram || !this.lineData || this.connections.length === 0) return;

    gl.useProgram(this.lineProgram);
    gl.uniform2f(this.lineUniforms.resolution, this.width, this.height);

    // Use glow color for constellation lines
    const config = THEME_EFFECTS[this.theme];
    const glowColor = this.parseRgba(config.colors.glowColor) || {
      r: 0.4,
      g: 0.6,
      b: 1,
      a: 0.6,
    };
    gl.uniform4f(this.lineUniforms.color, glowColor.r, glowColor.g, glowColor.b, 0.6);

    // Upload line data
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.lineData, gl.DYNAMIC_DRAW);

    // Set up attributes (x, y, alpha per vertex)
    const stride = 3 * 4; // 3 floats per vertex

    const posLoc = gl.getAttribLocation(this.lineProgram, 'a_position');
    const alphaLoc = gl.getAttribLocation(this.lineProgram, 'a_alpha');

    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, stride, 0);

    gl.enableVertexAttribArray(alphaLoc);
    gl.vertexAttribPointer(alphaLoc, 1, gl.FLOAT, false, stride, 8);

    // Draw lines
    gl.lineWidth(1.0);
    gl.drawArrays(gl.LINES, 0, this.connections.length * 2);
  }

  private renderStars(): void {
    const gl = this.gl!;
    if (!this.starProgram || !this.starData) return;

    gl.useProgram(this.starProgram);

    // Set uniforms
    gl.uniform2f(this.starUniforms.resolution, this.width, this.height);
    gl.uniform1f(this.starUniforms.time, this.time);
    gl.uniform2f(this.starUniforms.view, this.viewRa, this.viewDec);
    const scale = this.projectionScale();
    gl.uniform1f(this.starUniforms.scale, scale);

    // Bind static star buffer (already uploaded at init)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffer);

    // Set up attributes (interleaved: ra, dec, baseSize, r, g, b, a, baseOpacity, twinkleSpeed, twinkleOffset)
    const stride = 10 * 4; // 10 floats per vertex, 4 bytes per float

    const celestialLoc = gl.getAttribLocation(this.starProgram, 'a_celestial');
    const sizeLoc = gl.getAttribLocation(this.starProgram, 'a_baseSize');
    const colorLoc = gl.getAttribLocation(this.starProgram, 'a_color');
    const opacityLoc = gl.getAttribLocation(this.starProgram, 'a_baseOpacity');
    const twinkleSpeedLoc = gl.getAttribLocation(this.starProgram, 'a_twinkleSpeed');
    const twinkleOffsetLoc = gl.getAttribLocation(this.starProgram, 'a_twinkleOffset');

    gl.enableVertexAttribArray(celestialLoc);
    gl.vertexAttribPointer(celestialLoc, 2, gl.FLOAT, false, stride, 0); // ra, dec

    gl.enableVertexAttribArray(sizeLoc);
    gl.vertexAttribPointer(sizeLoc, 1, gl.FLOAT, false, stride, 8); // baseSize

    gl.enableVertexAttribArray(colorLoc);
    gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, stride, 12); // r, g, b, a

    gl.enableVertexAttribArray(opacityLoc);
    gl.vertexAttribPointer(opacityLoc, 1, gl.FLOAT, false, stride, 28); // baseOpacity

    gl.enableVertexAttribArray(twinkleSpeedLoc);
    gl.vertexAttribPointer(twinkleSpeedLoc, 1, gl.FLOAT, false, stride, 32); // twinkleSpeed

    gl.enableVertexAttribArray(twinkleOffsetLoc);
    gl.vertexAttribPointer(twinkleOffsetLoc, 1, gl.FLOAT, false, stride, 36); // twinkleOffset

    // Draw stars as points
    gl.drawArrays(gl.POINTS, 0, this.stars.length);
  }

  /**
   * Render to the offscreen texture (for card viewports)
   */
  renderToTexture(): void {
    const gl = this.gl!;
    if (!this.framebuffer) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    this.render();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * Get the render texture for card viewports
   */
  getRenderTexture(): WebGLTexture | null {
    return this.renderTexture;
  }

  /**
   * Resize the renderer
   */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;

    if (this.gl) {
      this.gl.viewport(0, 0, width, height);

      // Recreate render texture at new size
      this.setupRenderTexture();

      // Update nebula buffer with new quad size
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.nebulaBuffer);
      const quadVerts = new Float32Array([
        0,
        0,
        width,
        0,
        0,
        height,
        0,
        height,
        width,
        0,
        width,
        height,
      ]);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, quadVerts, this.gl.STATIC_DRAW);
    }
  }

  /**
   * Change the theme
   */
  setTheme(theme: AmbientTheme): void {
    this.theme = theme;
    this.initParticles();
  }

  /**
   * Set scroll offset for parallax effect
   */
  setScrollOffset(offset: number): void {
    this.scrollOffset = offset;
  }

  /**
   * Enable/disable fast render mode (skips nebulae/galaxies for better scroll performance)
   */
  setFastRenderMode(fast: boolean): void {
    this.fastRenderMode = fast;
  }

  /**
   * Set pointer position for constellation reveal effect
   * Pass negative coordinates to hide the reveal effect
   */
  setPointerPosition(x: number, y: number): void {
    this.pointerX = x;
    this.pointerY = y;
  }

  /**
   * Render to a Canvas2D context (for card viewports)
   * Uses the same star/nebula/galaxy data as the WebGL renderer
   *
   * @param skipStars - If true, skip rendering individual stars (for low-res viewports where stars would flicker)
   */
  renderToCanvas2D(
    ctx: CanvasRenderingContext2D,
    viewportX: number,
    viewportY: number,
    viewportWidth: number,
    viewportHeight: number,
    scale: number = 1,
    skipStars: boolean = false,
  ): void {
    const config = THEME_EFFECTS[this.theme];
    const canvasWidth = ctx.canvas.width;
    const canvasHeight = ctx.canvas.height;

    // Fill with background
    ctx.fillStyle = config.colors.backgroundColor;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Add subtle ambient gradient based on viewport position (always visible)
    const ambientHue = ((viewportX + viewportY) * 0.001 + this.time * 0.05) % 1;
    const ambientR = Math.round(20 + Math.sin(ambientHue * Math.PI * 2) * 15);
    const ambientG = Math.round(15 + Math.sin(ambientHue * Math.PI * 2 + 1.5) * 10);
    const ambientB = Math.round(40 + Math.cos(ambientHue * Math.PI) * 20);

    try {
      const cx = canvasWidth / 2;
      const cy = canvasHeight / 2;
      const maxDim = Math.max(canvasWidth, canvasHeight);
      const ambientGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxDim);
      ambientGrad.addColorStop(
        0,
        `rgba(${ambientR + 20}, ${ambientG + 15}, ${ambientB + 30}, 0.4)`,
      );
      ambientGrad.addColorStop(0.5, `rgba(${ambientR}, ${ambientG}, ${ambientB}, 0.2)`);
      ambientGrad.addColorStop(1, `rgba(${ambientR - 10}, ${ambientG - 5}, ${ambientB - 10}, 0.1)`);
      ctx.fillStyle = ambientGrad;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    } catch {
      // Fallback solid
      ctx.fillStyle = `rgba(${ambientR}, ${ambientG}, ${ambientB}, 0.3)`;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }

    ctx.save();

    // Scale for low-res rendering
    if (scale !== 1) {
      ctx.scale(scale, scale);
    }

    // Translate to show this viewport's portion
    ctx.translate(-viewportX, -viewportY);

    // === Render nebulae ===
    for (const nebula of this.nebulae) {
      if (!nebula.visible) continue;
      const s = nebula.scale;
      for (const lobe of nebula.lobes) {
        const lobeX = nebula.x + lobe.offsetX * s;
        const lobeY = nebula.y + lobe.offsetY * s;
        const maxRadius = Math.max(lobe.radiusA, lobe.radiusB) * s;
        const lobeOpacity = nebula.opacity * lobe.intensity;

        try {
          const gradient = ctx.createRadialGradient(lobeX, lobeY, 0, lobeX, lobeY, maxRadius);
          gradient.addColorStop(
            0,
            `rgba(${Math.round(nebula.r * 255)}, ${Math.round(nebula.g * 255)}, ${Math.round(nebula.b * 255)}, ${lobeOpacity})`,
          );
          gradient.addColorStop(
            0.4,
            `rgba(${Math.round(nebula.r * 255)}, ${Math.round(nebula.g * 255)}, ${Math.round(nebula.b * 255)}, ${lobeOpacity * 0.5})`,
          );
          gradient.addColorStop(
            1,
            `rgba(${Math.round(nebula.r * 255)}, ${Math.round(nebula.g * 255)}, ${Math.round(nebula.b * 255)}, 0)`,
          );
          ctx.fillStyle = gradient;
        } catch {
          ctx.fillStyle = `rgba(${Math.round(nebula.r * 255)}, ${Math.round(nebula.g * 255)}, ${Math.round(nebula.b * 255)}, ${lobeOpacity * 0.3})`;
        }
        ctx.beginPath();
        ctx.arc(lobeX, lobeY, maxRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // === Render galaxies ===
    for (const galaxy of this.galaxies) {
      if (!galaxy.visible) continue;
      const r = galaxy.radius;

      ctx.save();
      ctx.translate(galaxy.x, galaxy.y);
      ctx.rotate(galaxy.rotation);
      ctx.scale(1, 1 - galaxy.tilt * 0.7);

      try {
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        gradient.addColorStop(
          0,
          `rgba(${Math.round(galaxy.r * 255)}, ${Math.round(galaxy.g * 255)}, ${Math.round(galaxy.b * 255)}, ${galaxy.opacity})`,
        );
        gradient.addColorStop(
          0.3,
          `rgba(${Math.round(galaxy.r * 255)}, ${Math.round(galaxy.g * 255)}, ${Math.round(galaxy.b * 255)}, ${galaxy.opacity * 0.5})`,
        );
        gradient.addColorStop(
          1,
          `rgba(${Math.round(galaxy.r * 255)}, ${Math.round(galaxy.g * 255)}, ${Math.round(galaxy.b * 255)}, 0)`,
        );
        ctx.fillStyle = gradient;
      } catch {
        ctx.fillStyle = `rgba(${Math.round(galaxy.r * 255)}, ${Math.round(galaxy.g * 255)}, ${Math.round(galaxy.b * 255)}, ${galaxy.opacity * 0.3})`;
      }
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // === Render stars (skip for low-res viewports to avoid flickering) ===
    if (skipStars) {
      ctx.restore();
      return;
    }

    const projScale = this.projectionScale();
    const centerX = this.width / 2;
    const centerY = this.height / 2;

    for (const star of this.stars) {
      // Project star position
      const proj = this.projectStar(star.ra, star.dec, this.viewRa, this.viewDec, projScale);
      if (!proj.visible) continue;

      const x = centerX + proj.x;
      const y = centerY + proj.y;

      // Skip if outside viewport (with margin)
      if (
        x < viewportX - 10 ||
        x > viewportX + viewportWidth + 10 ||
        y < viewportY - 10 ||
        y > viewportY + viewportHeight + 10
      ) {
        continue;
      }

      const size = star.baseSize * 1.5;
      const opacity = star.baseOpacity;

      // Draw star as soft circle
      try {
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, size);
        gradient.addColorStop(
          0,
          `rgba(${Math.round(star.r * 255)}, ${Math.round(star.g * 255)}, ${Math.round(star.b * 255)}, ${opacity})`,
        );
        gradient.addColorStop(
          1,
          `rgba(${Math.round(star.r * 255)}, ${Math.round(star.g * 255)}, ${Math.round(star.b * 255)}, 0)`,
        );
        ctx.fillStyle = gradient;
      } catch {
        ctx.fillStyle = `rgba(${Math.round(star.r * 255)}, ${Math.round(star.g * 255)}, ${Math.round(star.b * 255)}, ${opacity})`;
      }
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Clean up WebGL resources
   */
  destroy(): void {
    const gl = this.gl;
    if (!gl) return;

    if (this.starProgram) gl.deleteProgram(this.starProgram);
    if (this.nebulaProgram) gl.deleteProgram(this.nebulaProgram);
    if (this.lineProgram) gl.deleteProgram(this.lineProgram);
    if (this.galaxyProgram) gl.deleteProgram(this.galaxyProgram);
    if (this.textureProgram) gl.deleteProgram(this.textureProgram);
    if (this.blitProgram) gl.deleteProgram(this.blitProgram);

    if (this.starBuffer) gl.deleteBuffer(this.starBuffer);
    if (this.nebulaBuffer) gl.deleteBuffer(this.nebulaBuffer);
    if (this.lineBuffer) gl.deleteBuffer(this.lineBuffer);
    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);

    if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
    if (this.renderTexture) gl.deleteTexture(this.renderTexture);
    if (this.bgFramebuffer) gl.deleteFramebuffer(this.bgFramebuffer);
    if (this.bgTexture) gl.deleteTexture(this.bgTexture);

    this.gl = null;
    this.canvas = null;
  }
}
