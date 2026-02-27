/**
 * WebGL Shaders for ambient effects
 */

// Vertex shader for point sprites (stars) - with GPU celestial projection
export const starVertexShader = `
attribute vec2 a_celestial;  // ra, dec in radians
attribute float a_baseSize;
attribute vec4 a_color;
attribute float a_baseOpacity;
attribute float a_twinkleSpeed;
attribute float a_twinkleOffset;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_view;  // viewRa, viewDec
uniform float u_scale;  // projection scale

varying vec4 v_color;
varying float v_opacity;

void main() {
  // Stereographic projection from celestial to screen coordinates
  float ra = a_celestial.x;
  float dec = a_celestial.y;
  float viewRa = u_view.x;
  float viewDec = u_view.y;

  // Angular distance from view center
  float cosDec = cos(dec);
  float cosViewDec = cos(viewDec);
  float sinDec = sin(dec);
  float sinViewDec = sin(viewDec);
  float cosRaDiff = cos(ra - viewRa);

  float cosC = sinViewDec * sinDec + cosViewDec * cosDec * cosRaDiff;

  // Skip stars behind the view (more than 90 degrees away)
  if (cosC < 0.0) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);  // Off screen
    gl_PointSize = 0.0;
    return;
  }

  float k = 2.0 / (1.0 + cosC);  // Stereographic scale factor (matches CPU projection)

  float projX = k * cosDec * sin(ra - viewRa);
  float projY = k * (cosViewDec * sinDec - sinViewDec * cosDec * cosRaDiff);

  // Convert to screen coordinates
  vec2 center = u_resolution * 0.5;
  vec2 screenPos = center + vec2(projX, projY) * u_scale;

  // Convert to clip space
  vec2 clipSpace = (screenPos / u_resolution) * 2.0 - 1.0;
  clipSpace.y *= -1.0;

  gl_Position = vec4(clipSpace, 0.0, 1.0);

  // Twinkle animation
  float twinkle = sin(u_time * a_twinkleSpeed + a_twinkleOffset);
  float twinkleFactor = twinkle > 0.0 ? twinkle : twinkle * 0.3;
  float opacity = a_baseOpacity * (0.7 + twinkleFactor * 0.3);

  gl_PointSize = a_baseSize * 2.0;
  v_color = a_color;
  v_opacity = opacity;
}
`;

// Fragment shader for stars with glow
export const starFragmentShader = `
precision mediump float;

varying vec4 v_color;
varying float v_opacity;

void main() {
  // Distance from center of point sprite
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);

  // Soft circle with glow falloff
  float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
  alpha *= v_opacity;

  gl_FragColor = vec4(v_color.rgb, v_color.a * alpha);
}
`;

// Vertex shader for nebulae (fullscreen quad per nebula)
export const nebulaVertexShader = `
attribute vec2 a_position;

uniform vec2 u_resolution;
uniform vec2 u_center;
uniform float u_radius;

varying vec2 v_texCoord;
varying vec2 v_center;
varying float v_radius;

void main() {
  vec2 clipSpace = (a_position / u_resolution) * 2.0 - 1.0;
  clipSpace.y *= -1.0;

  gl_Position = vec4(clipSpace, 0.0, 1.0);
  v_texCoord = a_position;
  v_center = u_center;
  v_radius = u_radius;
}
`;

// Fragment shader for nebulae with radial gradient
export const nebulaFragmentShader = `
precision mediump float;

varying vec2 v_texCoord;
varying vec2 v_center;
varying float v_radius;

uniform vec4 u_color;
uniform float u_opacity;

void main() {
  float dist = length(v_texCoord - v_center);
  float t = dist / v_radius;

  // Radial falloff
  float alpha = 1.0 - smoothstep(0.0, 1.0, t);
  alpha = alpha * alpha; // Softer falloff
  alpha *= u_opacity;

  gl_FragColor = vec4(u_color.rgb, u_color.a * alpha);
}
`;

// Line shader for constellation connections
export const lineVertexShader = `
attribute vec2 a_position;
attribute float a_alpha;

uniform vec2 u_resolution;

varying float v_alpha;

void main() {
  vec2 clipSpace = (a_position / u_resolution) * 2.0 - 1.0;
  clipSpace.y *= -1.0;

  gl_Position = vec4(clipSpace, 0.0, 1.0);
  v_alpha = a_alpha;
}
`;

export const lineFragmentShader = `
precision mediump float;

uniform vec4 u_color;

varying float v_alpha;

void main() {
  gl_FragColor = vec4(u_color.rgb, u_color.a * v_alpha);
}
`;

// Galaxy shader for spiral galaxies
export const galaxyVertexShader = `
attribute vec2 a_position;

uniform vec2 u_resolution;

varying vec2 v_texCoord;

void main() {
  vec2 clipSpace = (a_position / u_resolution) * 2.0 - 1.0;
  clipSpace.y *= -1.0;

  gl_Position = vec4(clipSpace, 0.0, 1.0);
  v_texCoord = a_position;
}
`;

export const galaxyFragmentShader = `
precision mediump float;

varying vec2 v_texCoord;

uniform vec2 u_center;
uniform float u_radius;
uniform vec4 u_color;
uniform float u_opacity;
uniform float u_rotation;
uniform float u_tilt;
uniform float u_arms;
uniform float u_isSpiral;

void main() {
  vec2 pos = v_texCoord - u_center;

  // Apply tilt (compress Y)
  pos.y /= (1.0 - u_tilt * 0.85);

  // Rotate
  float c = cos(-u_rotation);
  float s = sin(-u_rotation);
  pos = vec2(pos.x * c - pos.y * s, pos.x * s + pos.y * c);

  float dist = length(pos);
  float angle = atan(pos.y, pos.x);

  float alpha = 0.0;

  if (u_isSpiral > 0.5) {
    // Spiral galaxy
    // Outer halo
    float haloAlpha = 1.0 - smoothstep(0.0, u_radius * 1.2, dist);
    haloAlpha *= haloAlpha * 0.4;

    // Spiral arms
    float normalizedDist = dist / u_radius;
    float spiralAngle = angle - normalizedDist * 3.14159 * 1.8;
    float armPattern = 0.0;
    for (float i = 0.0; i < 4.0; i++) {
      if (i < u_arms) {
        float armAngle = spiralAngle + i * 6.28318 / u_arms;
        float arm = cos(armAngle);
        arm = smoothstep(0.5, 1.0, arm);
        armPattern += arm;
      }
    }
    armPattern = min(armPattern, 1.0);
    float spiralAlpha = armPattern * (1.0 - normalizedDist) * 0.3;

    // Central bulge
    float bulgeAlpha = 1.0 - smoothstep(0.0, u_radius * 0.3, dist);
    bulgeAlpha *= bulgeAlpha * 0.8;

    alpha = max(max(haloAlpha, spiralAlpha), bulgeAlpha) * u_opacity;
  } else {
    // Elliptical galaxy
    float t = dist / u_radius;
    alpha = 1.0 - smoothstep(0.0, 1.0, t);
    alpha = alpha * alpha * alpha * u_opacity * 0.6;
  }

  // Bright center
  float centerBright = 1.0 - smoothstep(0.0, u_radius * 0.15, dist);
  vec3 color = mix(u_color.rgb, vec3(1.0, 0.98, 0.94), centerBright * 0.6);

  gl_FragColor = vec4(color, alpha);
}
`;

// Simple passthrough for texture sampling (card viewports)
export const textureVertexShader = `
attribute vec2 a_position;
attribute vec2 a_texCoord;

varying vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

export const textureFragmentShader = `
precision mediump float;

uniform sampler2D u_texture;
uniform vec2 u_viewportOffset;
uniform vec2 u_viewportSize;
uniform vec2 u_textureSize;

varying vec2 v_texCoord;

void main() {
  // Sample from the portion of the texture that corresponds to this viewport
  vec2 texCoord = u_viewportOffset / u_textureSize + v_texCoord * (u_viewportSize / u_textureSize);
  gl_FragColor = texture2D(u_texture, texCoord);
}
`;

// Simple blit shader for compositing pre-rendered textures
export const blitVertexShader = `
attribute vec2 a_position;
varying vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  // Convert from clip space (-1 to 1) to texture coords (0 to 1)
  // Flip Y because framebuffer texture is upside down
  v_texCoord = vec2(a_position.x * 0.5 + 0.5, a_position.y * 0.5 + 0.5);
}
`;

export const blitFragmentShader = `
precision mediump float;

uniform sampler2D u_texture;
varying vec2 v_texCoord;

void main() {
  gl_FragColor = texture2D(u_texture, v_texCoord);
}
`;

// Compile shader helper
export function compileShader(
  gl: WebGLRenderingContext,
  source: string,
  type: number,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

// Create program helper
export function createProgram(
  gl: WebGLRenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader,
): WebGLProgram | null {
  const program = gl.createProgram();
  if (!program) return null;

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  return program;
}
