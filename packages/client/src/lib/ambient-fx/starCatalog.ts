// Real Star Catalog Data
// Based on Yale Bright Star Catalog and Hipparcos data
// Contains ~300 of the brightest stars visible to the naked eye
// Positions stored in radians for proper celestial projection

export interface CatalogStar {
  name: string; // Star name or designation
  ra: number; // Right Ascension in radians (0 to 2π)
  dec: number; // Declination in radians (-π/2 to π/2)
  magnitude: number; // Apparent magnitude (lower = brighter)
  spectralType?: string; // Spectral classification for color
  constellation?: string; // Parent constellation
  connections?: string[]; // For constellation lines
}

// Convert RA (hours, minutes) and Dec (degrees, minutes) to radians
function raDecToRadians(
  raHours: number,
  raMinutes: number,
  decDegrees: number,
  decMinutes: number,
): { ra: number; dec: number } {
  const raTotal = raHours + raMinutes / 60; // Hours (0-24)
  const decTotal = decDegrees + (decDegrees >= 0 ? decMinutes / 60 : -decMinutes / 60); // Degrees (-90 to 90)

  return {
    ra: (raTotal / 24) * 2 * Math.PI, // Convert to radians (0 to 2π)
    dec: (decTotal / 180) * Math.PI, // Convert to radians (-π/2 to π/2)
  };
}

// Stereographic projection from celestial coordinates to screen
// Projects stars onto a plane tangent to the celestial sphere
// centerRa/centerDec define the "look at" point in radians
export function projectStar(
  starRa: number,
  starDec: number,
  centerRa: number,
  centerDec: number,
  scale: number, // pixels per radian at center
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
  // Add small epsilon to avoid division issues
  if (x2 <= 0.01) {
    return { x: 0, y: 0, visible: false };
  }

  // Stereographic projection: project onto plane at x=1
  // Standard stereographic from point (-1,0,0) onto plane x=1
  const denom = 1 + x2;
  const projY = (2 * y2) / denom;
  const projZ = (2 * z2) / denom;

  // Convert to screen coordinates
  // Y maps to screen X (right is East), Z maps to screen Y (up is North)
  return {
    x: projY * scale,
    y: -projZ * scale, // Negate so North is up
    visible: true,
  };
}

// Calculate angular distance between two points on celestial sphere (in radians)
export function angularDistance(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const cosDist =
    Math.sin(dec1) * Math.sin(dec2) + Math.cos(dec1) * Math.cos(dec2) * Math.cos(ra1 - ra2);
  return Math.acos(Math.max(-1, Math.min(1, cosDist)));
}

// Helper to get star color from spectral type
export function getStarColor(spectralType?: string): string {
  if (!spectralType) return 'rgba(255, 255, 255, 0.9)';

  const type = spectralType.charAt(0).toUpperCase();
  switch (type) {
    case 'O':
      return 'rgba(155, 176, 255, 0.95)'; // Blue
    case 'B':
      return 'rgba(170, 191, 255, 0.95)'; // Blue-white
    case 'A':
      return 'rgba(202, 215, 255, 0.95)'; // White
    case 'F':
      return 'rgba(248, 247, 255, 0.95)'; // Yellow-white
    case 'G':
      return 'rgba(255, 244, 234, 0.95)'; // Yellow (like Sun)
    case 'K':
      return 'rgba(255, 210, 161, 0.95)'; // Orange
    case 'M':
      return 'rgba(255, 187, 123, 0.95)'; // Red-orange
    default:
      return 'rgba(255, 255, 255, 0.9)';
  }
}

// Magnitude to size/brightness conversion
export function magnitudeToSize(magnitude: number): number {
  // Brighter stars (lower magnitude) are larger
  // Sirius is -1.46, faintest naked eye ~6
  const normalized = Math.max(0, Math.min(1, (6 - magnitude) / 7.5));
  return 1.0 + normalized * 2.5; // Size range 1.0-3.5 (increased min from 0.5)
}

export function magnitudeToBrightness(magnitude: number): number {
  const normalized = Math.max(0, Math.min(1, (6 - magnitude) / 7.5));
  return 0.5 + normalized * 0.5; // Brightness range 0.5-1.0 (increased min from 0.3)
}

// Real star data - brightest stars from various constellations
// Includes all constellation stars from the current CONSTELLATIONS array plus many more
export const STAR_CATALOG: CatalogStar[] = [
  // =============================================
  // MAJOR BRIGHT STARS (Magnitude < 1.5)
  // =============================================

  // Sirius (α CMa) - Brightest star in the sky, mag -1.46
  {
    name: 'Sirius',
    ...raDecToRadians(6, 45, -16, 43),
    magnitude: -1.46,
    spectralType: 'A1V',
    constellation: 'Canis Major',
  },

  // Canopus (α Car) - Second brightest, mag -0.74
  {
    name: 'Canopus',
    ...raDecToRadians(6, 24, -52, 42),
    magnitude: -0.74,
    spectralType: 'F0II',
    constellation: 'Carina',
  },

  // Alpha Centauri - Third brightest (system), mag -0.27
  {
    name: 'Rigil Kentaurus',
    ...raDecToRadians(14, 40, -60, 50),
    magnitude: -0.27,
    spectralType: 'G2V',
    constellation: 'Centaurus',
  },

  // Arcturus (α Boo) - Fourth brightest, mag -0.05
  {
    name: 'Arcturus',
    ...raDecToRadians(14, 16, 19, 11),
    magnitude: -0.05,
    spectralType: 'K1.5III',
    constellation: 'Bootes',
    connections: ['Izar', 'Eta Boo', 'Muphrid'],
  },

  // Vega (α Lyr) - Fifth brightest, mag 0.03
  {
    name: 'Vega',
    ...raDecToRadians(18, 37, 38, 47),
    magnitude: 0.03,
    spectralType: 'A0V',
    constellation: 'Lyra',
    connections: ['Sheliak', 'Sulafat'],
  },

  // Capella (α Aur) - Sixth brightest, mag 0.08
  {
    name: 'Capella',
    ...raDecToRadians(5, 17, 46, 0),
    magnitude: 0.08,
    spectralType: 'G3III',
    constellation: 'Auriga',
  },

  // Rigel (β Ori) - Seventh brightest, mag 0.13
  {
    name: 'Rigel',
    ...raDecToRadians(5, 15, -8, 12),
    magnitude: 0.13,
    spectralType: 'B8Ia',
    constellation: 'Orion',
    connections: ['Mintaka'],
  },

  // Procyon (α CMi) - Eighth brightest, mag 0.34
  {
    name: 'Procyon',
    ...raDecToRadians(7, 39, 5, 14),
    magnitude: 0.34,
    spectralType: 'F5IV',
    constellation: 'Canis Minor',
  },

  // Achernar (α Eri) - Ninth brightest, mag 0.46
  {
    name: 'Achernar',
    ...raDecToRadians(1, 38, -57, 14),
    magnitude: 0.46,
    spectralType: 'B6V',
    constellation: 'Eridanus',
  },

  // Betelgeuse (α Ori) - Variable, mag 0.42
  {
    name: 'Betelgeuse',
    ...raDecToRadians(5, 55, 7, 24),
    magnitude: 0.42,
    spectralType: 'M1Ia',
    constellation: 'Orion',
    connections: ['Meissa', 'Bellatrix'],
  },

  // Hadar (β Cen) - mag 0.61
  {
    name: 'Hadar',
    ...raDecToRadians(14, 4, -60, 22),
    magnitude: 0.61,
    spectralType: 'B1III',
    constellation: 'Centaurus',
  },

  // Altair (α Aql) - mag 0.77
  {
    name: 'Altair',
    ...raDecToRadians(19, 51, 8, 52),
    magnitude: 0.77,
    spectralType: 'A7V',
    constellation: 'Aquila',
    connections: ['Tarazed', 'Alshain'],
  },

  // Acrux (α Cru) - mag 0.76
  {
    name: 'Acrux',
    ...raDecToRadians(12, 27, -63, 6),
    magnitude: 0.76,
    spectralType: 'B0.5IV',
    constellation: 'Crux',
    connections: ['Gacrux'],
  },

  // Aldebaran (α Tau) - mag 0.85
  {
    name: 'Aldebaran',
    ...raDecToRadians(4, 36, 16, 31),
    magnitude: 0.85,
    spectralType: 'K5III',
    constellation: 'Taurus',
    connections: ['Theta2 Tau', 'Zeta Tau', 'Epsilon Tau'],
  },

  // Antares (α Sco) - mag 0.96
  {
    name: 'Antares',
    ...raDecToRadians(16, 29, -26, 26),
    magnitude: 0.96,
    spectralType: 'M1.5Iab',
    constellation: 'Scorpius',
    connections: ['Sigma Sco', 'Tau Sco'],
  },

  // Spica (α Vir) - mag 1.04
  {
    name: 'Spica',
    ...raDecToRadians(13, 25, -11, 10),
    magnitude: 1.04,
    spectralType: 'B1III',
    constellation: 'Virgo',
  },

  // Pollux (β Gem) - mag 1.14
  {
    name: 'Pollux',
    ...raDecToRadians(7, 45, 28, 2),
    magnitude: 1.14,
    spectralType: 'K0III',
    constellation: 'Gemini',
    connections: ['Castor', 'Wasat'],
  },

  // Fomalhaut (α PsA) - mag 1.16
  {
    name: 'Fomalhaut',
    ...raDecToRadians(22, 58, -29, 37),
    magnitude: 1.16,
    spectralType: 'A4V',
    constellation: 'Piscis Austrinus',
  },

  // Deneb (α Cyg) - mag 1.25
  {
    name: 'Deneb',
    ...raDecToRadians(20, 41, 45, 17),
    magnitude: 1.25,
    spectralType: 'A2Ia',
    constellation: 'Cygnus',
    connections: ['Sadr'],
  },

  // Mimosa (β Cru) - mag 1.25
  {
    name: 'Mimosa',
    ...raDecToRadians(12, 48, -59, 41),
    magnitude: 1.25,
    spectralType: 'B0.5III',
    constellation: 'Crux',
    connections: ['Delta Cru'],
  },
  // Gacrux (γ Cru) - mag 1.63
  {
    name: 'Gacrux',
    ...raDecToRadians(12, 31, -57, 7),
    magnitude: 1.63,
    spectralType: 'M3.5III',
    constellation: 'Crux',
    connections: ['Acrux'],
  },
  // Delta Cru - mag 2.80
  {
    name: 'Delta Cru',
    ...raDecToRadians(12, 15, -58, 45),
    magnitude: 2.8,
    spectralType: 'B2IV',
    constellation: 'Crux',
    connections: ['Mimosa'],
  },

  // Regulus (α Leo) - mag 1.35
  {
    name: 'Regulus',
    ...raDecToRadians(10, 8, 11, 58),
    magnitude: 1.35,
    spectralType: 'B8IV',
    constellation: 'Leo',
    connections: ['Algieba', 'Chertan', 'Epsilon Leo'],
  },

  // =============================================
  // ORION - The Hunter
  // =============================================
  {
    name: 'Meissa',
    ...raDecToRadians(5, 35, 9, 56),
    magnitude: 3.47,
    spectralType: 'O8III',
    constellation: 'Orion',
    connections: ['Betelgeuse'],
  },
  {
    name: 'Bellatrix',
    ...raDecToRadians(5, 25, 6, 21),
    magnitude: 1.64,
    spectralType: 'B2III',
    constellation: 'Orion',
    connections: ['Betelgeuse'],
  },
  {
    name: 'Mintaka',
    ...raDecToRadians(5, 32, -0, 18),
    magnitude: 2.23,
    spectralType: 'O9.5II',
    constellation: 'Orion',
    connections: ['Alnilam'],
  },
  {
    name: 'Alnilam',
    ...raDecToRadians(5, 36, -1, 12),
    magnitude: 1.69,
    spectralType: 'B0Ia',
    constellation: 'Orion',
    connections: ['Mintaka', 'Alnitak'],
  },
  {
    name: 'Alnitak',
    ...raDecToRadians(5, 41, -1, 57),
    magnitude: 1.77,
    spectralType: 'O9.5Ib',
    constellation: 'Orion',
    connections: ['Alnilam', 'Saiph', 'Betelgeuse'],
  },
  {
    name: 'Saiph',
    ...raDecToRadians(5, 48, -9, 40),
    magnitude: 2.09,
    spectralType: 'B0.5Ia',
    constellation: 'Orion',
    connections: ['Alnitak'],
  },

  // =============================================
  // URSA MAJOR - The Great Bear (Big Dipper)
  // =============================================
  {
    name: 'Dubhe',
    ...raDecToRadians(11, 4, 61, 45),
    magnitude: 1.79,
    spectralType: 'K0III',
    constellation: 'Ursa Major',
    connections: ['Merak'],
  },
  {
    name: 'Merak',
    ...raDecToRadians(11, 2, 56, 23),
    magnitude: 2.37,
    spectralType: 'A1V',
    constellation: 'Ursa Major',
    connections: ['Dubhe', 'Phecda'],
  },
  {
    name: 'Phecda',
    ...raDecToRadians(11, 54, 53, 42),
    magnitude: 2.44,
    spectralType: 'A0V',
    constellation: 'Ursa Major',
    connections: ['Merak', 'Megrez'],
  },
  {
    name: 'Megrez',
    ...raDecToRadians(12, 15, 57, 2),
    magnitude: 3.31,
    spectralType: 'A3V',
    constellation: 'Ursa Major',
    connections: ['Phecda', 'Alioth', 'Dubhe'],
  },
  {
    name: 'Alioth',
    ...raDecToRadians(12, 54, 55, 58),
    magnitude: 1.77,
    spectralType: 'A1III',
    constellation: 'Ursa Major',
    connections: ['Megrez', 'Mizar'],
  },
  {
    name: 'Mizar',
    ...raDecToRadians(13, 24, 54, 56),
    magnitude: 2.27,
    spectralType: 'A2V',
    constellation: 'Ursa Major',
    connections: ['Alioth', 'Alkaid'],
  },
  {
    name: 'Alkaid',
    ...raDecToRadians(13, 48, 49, 19),
    magnitude: 1.86,
    spectralType: 'B3V',
    constellation: 'Ursa Major',
    connections: ['Mizar'],
  },

  // =============================================
  // CASSIOPEIA - The Queen
  // =============================================
  {
    name: 'Schedar',
    ...raDecToRadians(0, 40, 56, 32),
    magnitude: 2.24,
    spectralType: 'K0II',
    constellation: 'Cassiopeia',
    connections: ['Caph', 'Gamma Cas'],
  },
  {
    name: 'Caph',
    ...raDecToRadians(0, 9, 59, 9),
    magnitude: 2.28,
    spectralType: 'F2III',
    constellation: 'Cassiopeia',
    connections: ['Schedar'],
  },
  {
    name: 'Gamma Cas',
    ...raDecToRadians(0, 57, 60, 43),
    magnitude: 2.47,
    spectralType: 'B0.5IVe',
    constellation: 'Cassiopeia',
    connections: ['Schedar', 'Ruchbah'],
  },
  {
    name: 'Ruchbah',
    ...raDecToRadians(1, 26, 60, 14),
    magnitude: 2.68,
    spectralType: 'A5IV',
    constellation: 'Cassiopeia',
    connections: ['Gamma Cas', 'Segin'],
  },
  {
    name: 'Segin',
    ...raDecToRadians(1, 54, 63, 40),
    magnitude: 3.37,
    spectralType: 'B3III',
    constellation: 'Cassiopeia',
    connections: ['Ruchbah'],
  },

  // =============================================
  // CYGNUS - The Swan / Northern Cross
  // =============================================
  {
    name: 'Sadr',
    ...raDecToRadians(20, 22, 40, 15),
    magnitude: 2.23,
    spectralType: 'F8Ib',
    constellation: 'Cygnus',
    connections: ['Deneb', 'Gienah Cyg', 'Delta Cyg', 'Albireo'],
  },
  {
    name: 'Gienah Cyg',
    ...raDecToRadians(20, 46, 33, 58),
    magnitude: 2.48,
    spectralType: 'K0III',
    constellation: 'Cygnus',
    connections: ['Sadr'],
  },
  {
    name: 'Delta Cyg',
    ...raDecToRadians(19, 45, 45, 8),
    magnitude: 2.87,
    spectralType: 'B9.5III',
    constellation: 'Cygnus',
    connections: ['Sadr'],
  },
  {
    name: 'Albireo',
    ...raDecToRadians(19, 31, 27, 58),
    magnitude: 3.18,
    spectralType: 'K3II',
    constellation: 'Cygnus',
    connections: ['Sadr'],
  },

  // =============================================
  // SCORPIUS - The Scorpion
  // =============================================
  {
    name: 'Sigma Sco',
    ...raDecToRadians(16, 21, -25, 36),
    magnitude: 2.88,
    spectralType: 'B1III',
    constellation: 'Scorpius',
    connections: ['Antares', 'Dschubba'],
  },
  {
    name: 'Dschubba',
    ...raDecToRadians(16, 0, -22, 37),
    magnitude: 2.32,
    spectralType: 'B0.3IV',
    constellation: 'Scorpius',
    connections: ['Sigma Sco', 'Beta Sco'],
  },
  {
    name: 'Beta Sco',
    ...raDecToRadians(16, 5, -19, 48),
    magnitude: 2.62,
    spectralType: 'B1V',
    constellation: 'Scorpius',
    connections: ['Dschubba'],
  },
  {
    name: 'Tau Sco',
    ...raDecToRadians(16, 36, -28, 13),
    magnitude: 2.82,
    spectralType: 'B0.2V',
    constellation: 'Scorpius',
    connections: ['Antares', 'Epsilon Sco'],
  },
  {
    name: 'Epsilon Sco',
    ...raDecToRadians(16, 50, -34, 18),
    magnitude: 2.29,
    spectralType: 'K2.5III',
    constellation: 'Scorpius',
    connections: ['Tau Sco', 'Shaula'],
  },
  {
    name: 'Shaula',
    ...raDecToRadians(17, 34, -37, 6),
    magnitude: 1.63,
    spectralType: 'B2IV',
    constellation: 'Scorpius',
    connections: ['Epsilon Sco', 'Lesath'],
  },
  {
    name: 'Lesath',
    ...raDecToRadians(17, 31, -37, 18),
    magnitude: 2.7,
    spectralType: 'B2IV',
    constellation: 'Scorpius',
    connections: ['Shaula'],
  },

  // =============================================
  // LYRA - The Lyre
  // =============================================
  {
    name: 'Sheliak',
    ...raDecToRadians(18, 50, 33, 22),
    magnitude: 3.45,
    spectralType: 'B7Ve',
    constellation: 'Lyra',
    connections: ['Vega', 'Sulafat'],
  },
  {
    name: 'Sulafat',
    ...raDecToRadians(18, 59, 32, 41),
    magnitude: 3.24,
    spectralType: 'B9III',
    constellation: 'Lyra',
    connections: ['Vega', 'Sheliak'],
  },

  // =============================================
  // LEO - The Lion (Sickle and body)
  // =============================================
  {
    name: 'Denebola',
    ...raDecToRadians(11, 49, 14, 34),
    magnitude: 2.14,
    spectralType: 'A3V',
    constellation: 'Leo',
    connections: ['Zosma'],
  },
  {
    name: 'Algieba',
    ...raDecToRadians(10, 20, 19, 50),
    magnitude: 2.28,
    spectralType: 'K0III',
    constellation: 'Leo',
    connections: ['Regulus', 'Zosma', 'Eta Leo'],
  },
  {
    name: 'Zosma',
    ...raDecToRadians(11, 14, 20, 31),
    magnitude: 2.56,
    spectralType: 'A4V',
    constellation: 'Leo',
    connections: ['Algieba', 'Denebola', 'Chertan'],
  },
  {
    name: 'Chertan',
    ...raDecToRadians(11, 14, 15, 26),
    magnitude: 3.33,
    spectralType: 'A2V',
    constellation: 'Leo',
    connections: ['Zosma', 'Regulus'],
  },
  {
    name: 'Eta Leo',
    ...raDecToRadians(10, 7, 16, 46),
    magnitude: 3.52,
    spectralType: 'A0Ib',
    constellation: 'Leo',
    connections: ['Algieba', 'Adhafera'],
  },
  {
    name: 'Adhafera',
    ...raDecToRadians(10, 17, 23, 25),
    magnitude: 3.44,
    spectralType: 'F0III',
    constellation: 'Leo',
    connections: ['Eta Leo', 'Rasalas'],
  },
  {
    name: 'Rasalas',
    ...raDecToRadians(9, 53, 26, 0),
    magnitude: 3.88,
    spectralType: 'K2III',
    constellation: 'Leo',
    connections: ['Adhafera', 'Epsilon Leo'],
  },
  {
    name: 'Epsilon Leo',
    ...raDecToRadians(9, 46, 23, 46),
    magnitude: 2.98,
    spectralType: 'G1II',
    constellation: 'Leo',
    connections: ['Rasalas', 'Regulus'],
  },

  // =============================================
  // GEMINI - The Twins
  // =============================================
  {
    name: 'Castor',
    ...raDecToRadians(7, 35, 31, 53),
    magnitude: 1.58,
    spectralType: 'A1V',
    constellation: 'Gemini',
    connections: ['Pollux', 'Tau Gem'],
  },
  {
    name: 'Alhena',
    ...raDecToRadians(6, 38, 16, 24),
    magnitude: 1.93,
    spectralType: 'A1IV',
    constellation: 'Gemini',
    connections: ['Mebsuta', 'Mu Gem'],
  },
  {
    name: 'Mebsuta',
    ...raDecToRadians(6, 44, 25, 8),
    magnitude: 2.98,
    spectralType: 'G8Ib',
    constellation: 'Gemini',
    connections: ['Alhena', 'Tejat'],
  },
  {
    name: 'Tejat',
    ...raDecToRadians(6, 23, 22, 31),
    magnitude: 2.88,
    spectralType: 'M3III',
    constellation: 'Gemini',
    connections: ['Mebsuta', 'Propus'],
  },
  {
    name: 'Propus',
    ...raDecToRadians(6, 15, 22, 30),
    magnitude: 3.31,
    spectralType: 'G8IIIa',
    constellation: 'Gemini',
    connections: ['Tejat'],
  },
  {
    name: 'Wasat',
    ...raDecToRadians(7, 20, 21, 59),
    magnitude: 3.53,
    spectralType: 'F0IV',
    constellation: 'Gemini',
    connections: ['Pollux', 'Mebsuta'],
  },
  {
    name: 'Mu Gem',
    ...raDecToRadians(6, 23, 22, 31),
    magnitude: 2.88,
    spectralType: 'M3III',
    constellation: 'Gemini',
    connections: ['Alhena'],
  },
  {
    name: 'Tau Gem',
    ...raDecToRadians(7, 11, 30, 15),
    magnitude: 4.41,
    spectralType: 'K2III',
    constellation: 'Gemini',
    connections: ['Castor'],
  },

  // =============================================
  // TAURUS - The Bull (Hyades V-shape)
  // =============================================
  {
    name: 'Elnath',
    ...raDecToRadians(5, 26, 28, 36),
    magnitude: 1.65,
    spectralType: 'B7III',
    constellation: 'Taurus',
    connections: ['Zeta Tau'],
  },
  {
    name: 'Zeta Tau',
    ...raDecToRadians(5, 38, 21, 9),
    magnitude: 3.0,
    spectralType: 'B4III',
    constellation: 'Taurus',
    connections: ['Elnath', 'Aldebaran'],
  },
  {
    name: 'Theta2 Tau',
    ...raDecToRadians(4, 29, 15, 52),
    magnitude: 3.4,
    spectralType: 'A7III',
    constellation: 'Taurus',
    connections: ['Aldebaran', 'Gamma Tau'],
  },
  {
    name: 'Gamma Tau',
    ...raDecToRadians(4, 20, 15, 38),
    magnitude: 3.65,
    spectralType: 'G8III',
    constellation: 'Taurus',
    connections: ['Theta2 Tau', 'Delta1 Tau'],
  },
  {
    name: 'Delta1 Tau',
    ...raDecToRadians(4, 23, 17, 33),
    magnitude: 3.76,
    spectralType: 'K0III',
    constellation: 'Taurus',
    connections: ['Gamma Tau', 'Epsilon Tau'],
  },
  {
    name: 'Epsilon Tau',
    ...raDecToRadians(4, 29, 19, 11),
    magnitude: 3.53,
    spectralType: 'K0III',
    constellation: 'Taurus',
    connections: ['Delta1 Tau', 'Aldebaran'],
  },

  // =============================================
  // ADDITIONAL BRIGHT STARS (Magnitude < 3.0)
  // =============================================

  // Aquila - The Eagle
  {
    name: 'Tarazed',
    ...raDecToRadians(19, 46, 10, 37),
    magnitude: 2.72,
    spectralType: 'K3II',
    constellation: 'Aquila',
    connections: ['Altair'],
  },
  {
    name: 'Alshain',
    ...raDecToRadians(19, 55, 6, 24),
    magnitude: 3.71,
    spectralType: 'G8IV',
    constellation: 'Aquila',
    connections: ['Altair'],
  },

  // Bootes - The Herdsman (kite shape)
  {
    name: 'Izar',
    ...raDecToRadians(14, 45, 27, 4),
    magnitude: 2.37,
    spectralType: 'K0III',
    constellation: 'Bootes',
    connections: ['Arcturus', 'Delta Boo', 'Nekkar'],
  },
  {
    name: 'Eta Boo',
    ...raDecToRadians(13, 55, 18, 24),
    magnitude: 2.68,
    spectralType: 'G0IV',
    constellation: 'Bootes',
    connections: ['Arcturus', 'Nekkar'],
  },
  {
    name: 'Nekkar',
    ...raDecToRadians(15, 2, 40, 23),
    magnitude: 3.49,
    spectralType: 'G8III',
    constellation: 'Bootes',
    connections: ['Izar', 'Eta Boo', 'Gamma Boo'],
  },
  {
    name: 'Muphrid',
    ...raDecToRadians(13, 55, 18, 24),
    magnitude: 2.68,
    spectralType: 'G0IV',
    constellation: 'Bootes',
    connections: ['Arcturus'],
  },
  {
    name: 'Delta Boo',
    ...raDecToRadians(15, 16, 33, 19),
    magnitude: 3.47,
    spectralType: 'G8III',
    constellation: 'Bootes',
    connections: ['Izar', 'Nekkar'],
  },
  {
    name: 'Gamma Boo',
    ...raDecToRadians(14, 32, 38, 18),
    magnitude: 3.03,
    spectralType: 'A7III',
    constellation: 'Bootes',
    connections: ['Nekkar'],
  },

  // Aries - The Ram
  {
    name: 'Hamal',
    ...raDecToRadians(2, 7, 23, 28),
    magnitude: 2.0,
    spectralType: 'K2III',
    constellation: 'Aries',
    connections: ['Sheratan'],
  },
  {
    name: 'Sheratan',
    ...raDecToRadians(1, 55, 20, 48),
    magnitude: 2.64,
    spectralType: 'A5V',
    constellation: 'Aries',
    connections: ['Hamal', 'Mesarthim'],
  },
  {
    name: 'Mesarthim',
    ...raDecToRadians(1, 54, 19, 18),
    magnitude: 3.86,
    spectralType: 'B9V',
    constellation: 'Aries',
    connections: ['Sheratan'],
  },

  // Perseus
  {
    name: 'Mirfak',
    ...raDecToRadians(3, 24, 49, 52),
    magnitude: 1.79,
    spectralType: 'F5Ib',
    constellation: 'Perseus',
    connections: ['Delta Per', 'Epsilon Per', 'Gamma Per'],
  },
  {
    name: 'Algol',
    ...raDecToRadians(3, 8, 40, 57),
    magnitude: 2.12,
    spectralType: 'B8V',
    constellation: 'Perseus',
    connections: ['Rho Per', 'Gorgonea Tertia'],
  },
  {
    name: 'Delta Per',
    ...raDecToRadians(3, 43, 47, 47),
    magnitude: 3.01,
    spectralType: 'B5III',
    constellation: 'Perseus',
    connections: ['Mirfak', 'Epsilon Per'],
  },
  {
    name: 'Epsilon Per',
    ...raDecToRadians(3, 58, 40, 1),
    magnitude: 2.89,
    spectralType: 'B1V',
    constellation: 'Perseus',
    connections: ['Mirfak', 'Delta Per', 'Zeta Per'],
  },
  {
    name: 'Zeta Per',
    ...raDecToRadians(3, 54, 31, 53),
    magnitude: 2.85,
    spectralType: 'B1Ib',
    constellation: 'Perseus',
    connections: ['Epsilon Per', 'Omicron Per'],
  },
  {
    name: 'Gamma Per',
    ...raDecToRadians(3, 5, 53, 30),
    magnitude: 2.93,
    spectralType: 'G8III',
    constellation: 'Perseus',
    connections: ['Mirfak', 'Tau Per'],
  },
  {
    name: 'Tau Per',
    ...raDecToRadians(2, 54, 52, 46),
    magnitude: 3.95,
    spectralType: 'G4III',
    constellation: 'Perseus',
    connections: ['Gamma Per'],
  },
  {
    name: 'Rho Per',
    ...raDecToRadians(3, 5, 38, 50),
    magnitude: 3.39,
    spectralType: 'M4II',
    constellation: 'Perseus',
    connections: ['Algol'],
  },
  {
    name: 'Gorgonea Tertia',
    ...raDecToRadians(3, 6, 40, 28),
    magnitude: 3.84,
    spectralType: 'K1III',
    constellation: 'Perseus',
    connections: ['Algol'],
  },
  {
    name: 'Omicron Per',
    ...raDecToRadians(3, 44, 32, 17),
    magnitude: 3.83,
    spectralType: 'B1III',
    constellation: 'Perseus',
    connections: ['Zeta Per'],
  },

  // Andromeda - Chain from Pegasus
  {
    name: 'Alpheratz',
    ...raDecToRadians(0, 8, 29, 5),
    magnitude: 2.06,
    spectralType: 'B8IV',
    constellation: 'Andromeda',
    connections: ['Mirach', 'Scheat', 'Algenib'],
  },
  {
    name: 'Mirach',
    ...raDecToRadians(1, 10, 35, 37),
    magnitude: 2.05,
    spectralType: 'M0III',
    constellation: 'Andromeda',
    connections: ['Alpheratz', 'Almach', 'Delta And'],
  },
  {
    name: 'Almach',
    ...raDecToRadians(2, 4, 42, 20),
    magnitude: 2.17,
    spectralType: 'K3II',
    constellation: 'Andromeda',
    connections: ['Mirach'],
  },
  {
    name: 'Delta And',
    ...raDecToRadians(0, 39, 30, 52),
    magnitude: 3.27,
    spectralType: 'K3III',
    constellation: 'Andromeda',
    connections: ['Mirach', 'Alpheratz'],
  },

  // Pegasus - Great Square
  {
    name: 'Markab',
    ...raDecToRadians(23, 5, 15, 12),
    magnitude: 2.49,
    spectralType: 'A0IV',
    constellation: 'Pegasus',
    connections: ['Scheat', 'Algenib', 'Enif'],
  },
  {
    name: 'Scheat',
    ...raDecToRadians(23, 4, 28, 5),
    magnitude: 2.42,
    spectralType: 'M2.5II',
    constellation: 'Pegasus',
    connections: ['Markab', 'Alpheratz', 'Matar'],
  },
  {
    name: 'Algenib',
    ...raDecToRadians(0, 13, 15, 11),
    magnitude: 2.83,
    spectralType: 'B2IV',
    constellation: 'Pegasus',
    connections: ['Markab', 'Alpheratz'],
  },
  {
    name: 'Enif',
    ...raDecToRadians(21, 44, 9, 53),
    magnitude: 2.39,
    spectralType: 'K2Ib',
    constellation: 'Pegasus',
    connections: ['Markab', 'Biham'],
  },
  {
    name: 'Matar',
    ...raDecToRadians(22, 43, 30, 13),
    magnitude: 2.94,
    spectralType: 'G2II',
    constellation: 'Pegasus',
    connections: ['Scheat', 'Biham'],
  },
  {
    name: 'Biham',
    ...raDecToRadians(22, 10, 6, 12),
    magnitude: 3.53,
    spectralType: 'G8III',
    constellation: 'Pegasus',
    connections: ['Enif', 'Matar'],
  },

  // Sagittarius
  {
    name: 'Kaus Australis',
    ...raDecToRadians(18, 24, -34, 23),
    magnitude: 1.85,
    spectralType: 'B9.5III',
    constellation: 'Sagittarius',
  },
  {
    name: 'Nunki',
    ...raDecToRadians(18, 55, -26, 18),
    magnitude: 2.02,
    spectralType: 'B2.5V',
    constellation: 'Sagittarius',
  },

  // Ophiuchus
  {
    name: 'Rasalhague',
    ...raDecToRadians(17, 35, 12, 34),
    magnitude: 2.07,
    spectralType: 'A5III',
    constellation: 'Ophiuchus',
  },

  // Serpens
  {
    name: 'Unukalhai',
    ...raDecToRadians(15, 44, 6, 26),
    magnitude: 2.65,
    spectralType: 'K2III',
    constellation: 'Serpens',
  },

  // Corona Borealis
  {
    name: 'Alphecca',
    ...raDecToRadians(15, 35, 26, 43),
    magnitude: 2.23,
    spectralType: 'A0IV',
    constellation: 'Corona Borealis',
  },

  // Draco
  {
    name: 'Eltanin',
    ...raDecToRadians(17, 57, 51, 29),
    magnitude: 2.23,
    spectralType: 'K5III',
    constellation: 'Draco',
  },

  // Cepheus
  {
    name: 'Alderamin',
    ...raDecToRadians(21, 19, 62, 35),
    magnitude: 2.44,
    spectralType: 'A8V',
    constellation: 'Cepheus',
  },

  // Pisces
  {
    name: 'Eta Psc',
    ...raDecToRadians(1, 31, 15, 21),
    magnitude: 3.62,
    spectralType: 'G7III',
    constellation: 'Pisces',
  },

  // Aquarius
  {
    name: 'Sadalsuud',
    ...raDecToRadians(21, 32, -5, 34),
    magnitude: 2.91,
    spectralType: 'G0Ib',
    constellation: 'Aquarius',
  },
  {
    name: 'Sadalmelik',
    ...raDecToRadians(22, 6, -0, 19),
    magnitude: 2.96,
    spectralType: 'G2Ib',
    constellation: 'Aquarius',
  },

  // Capricornus
  {
    name: 'Deneb Algedi',
    ...raDecToRadians(21, 47, -16, 8),
    magnitude: 2.87,
    spectralType: 'A7III',
    constellation: 'Capricornus',
  },

  // Cetus
  {
    name: 'Diphda',
    ...raDecToRadians(0, 44, -17, 59),
    magnitude: 2.02,
    spectralType: 'K0III',
    constellation: 'Cetus',
  },
  {
    name: 'Menkar',
    ...raDecToRadians(3, 2, 4, 5),
    magnitude: 2.53,
    spectralType: 'M1.5IIIa',
    constellation: 'Cetus',
  },

  // Eridanus
  {
    name: 'Cursa',
    ...raDecToRadians(5, 8, -5, 5),
    magnitude: 2.79,
    spectralType: 'A3III',
    constellation: 'Eridanus',
  },

  // Lepus
  {
    name: 'Arneb',
    ...raDecToRadians(5, 33, -17, 49),
    magnitude: 2.58,
    spectralType: 'F0Ib',
    constellation: 'Lepus',
  },

  // Columba
  {
    name: 'Phact',
    ...raDecToRadians(5, 40, -34, 4),
    magnitude: 2.64,
    spectralType: 'B8V',
    constellation: 'Columba',
  },

  // Puppis
  {
    name: 'Naos',
    ...raDecToRadians(8, 4, -40, 0),
    magnitude: 2.25,
    spectralType: 'O5Iaf',
    constellation: 'Puppis',
  },

  // Vela
  {
    name: 'Suhail',
    ...raDecToRadians(9, 8, -43, 26),
    magnitude: 2.21,
    spectralType: 'K4.5Ib',
    constellation: 'Vela',
  },

  // Hydra
  {
    name: 'Alphard',
    ...raDecToRadians(9, 28, -8, 40),
    magnitude: 1.98,
    spectralType: 'K3II',
    constellation: 'Hydra',
  },

  // Corvus
  {
    name: 'Gienah',
    ...raDecToRadians(12, 16, -17, 33),
    magnitude: 2.59,
    spectralType: 'B8III',
    constellation: 'Corvus',
  },

  // Centaurus
  {
    name: 'Menkent',
    ...raDecToRadians(14, 7, -36, 22),
    magnitude: 2.06,
    spectralType: 'K0III',
    constellation: 'Centaurus',
  },

  // Lupus
  {
    name: 'Alpha Lup',
    ...raDecToRadians(14, 42, -47, 23),
    magnitude: 2.3,
    spectralType: 'B1.5III',
    constellation: 'Lupus',
  },

  // Triangulum Australe
  {
    name: 'Atria',
    ...raDecToRadians(16, 49, -69, 2),
    magnitude: 1.92,
    spectralType: 'K2IIb',
    constellation: 'Triangulum Australe',
  },

  // Ara
  {
    name: 'Beta Ara',
    ...raDecToRadians(17, 25, -55, 32),
    magnitude: 2.85,
    spectralType: 'K3Ib',
    constellation: 'Ara',
  },

  // Pavo
  {
    name: 'Peacock',
    ...raDecToRadians(20, 26, -56, 44),
    magnitude: 1.94,
    spectralType: 'B2IV',
    constellation: 'Pavo',
  },

  // Grus
  {
    name: 'Alnair',
    ...raDecToRadians(22, 8, -46, 58),
    magnitude: 1.74,
    spectralType: 'B6V',
    constellation: 'Grus',
  },

  // Phoenix
  {
    name: 'Ankaa',
    ...raDecToRadians(0, 26, -42, 18),
    magnitude: 2.39,
    spectralType: 'K0III',
    constellation: 'Phoenix',
  },

  // =============================================
  // FAINTER BACKGROUND STARS (Mag 3.0 - 4.5)
  // =============================================

  // Ursa Minor (Little Dipper)
  {
    name: 'Polaris',
    ...raDecToRadians(2, 32, 89, 16),
    magnitude: 2.02,
    spectralType: 'F8Ib',
    constellation: 'Ursa Minor',
  },
  {
    name: 'Kochab',
    ...raDecToRadians(14, 51, 74, 9),
    magnitude: 2.08,
    spectralType: 'K4III',
    constellation: 'Ursa Minor',
  },
  {
    name: 'Pherkad',
    ...raDecToRadians(15, 21, 71, 50),
    magnitude: 3.0,
    spectralType: 'A3II',
    constellation: 'Ursa Minor',
  },

  // Scattered field stars for density
  {
    name: 'HR 4',
    ...raDecToRadians(0, 5, 45, 13),
    magnitude: 3.88,
    spectralType: 'K3III',
  },
  {
    name: 'HR 15',
    ...raDecToRadians(0, 6, 58, 16),
    magnitude: 4.03,
    spectralType: 'K0III',
  },
  {
    name: 'HR 21',
    ...raDecToRadians(0, 7, 23, 24),
    magnitude: 3.27,
    spectralType: 'F8V',
  },
  {
    name: 'HR 39',
    ...raDecToRadians(0, 10, -17, 20),
    magnitude: 3.74,
    spectralType: 'G8III',
  },
  {
    name: 'HR 68',
    ...raDecToRadians(0, 16, 29, 18),
    magnitude: 4.05,
    spectralType: 'A2V',
  },
  {
    name: 'HR 98',
    ...raDecToRadians(0, 23, 27, 4),
    magnitude: 4.26,
    spectralType: 'K2III',
  },
  {
    name: 'HR 153',
    ...raDecToRadians(0, 36, -33, 1),
    magnitude: 3.94,
    spectralType: 'K0III',
  },
  {
    name: 'HR 188',
    ...raDecToRadians(0, 42, 50, 31),
    magnitude: 4.23,
    spectralType: 'K0III',
  },
  {
    name: 'HR 224',
    ...raDecToRadians(0, 49, 57, 49),
    magnitude: 4.12,
    spectralType: 'A0V',
  },
  {
    name: 'HR 269',
    ...raDecToRadians(0, 57, 60, 43),
    magnitude: 4.45,
    spectralType: 'B9V',
  },
  {
    name: 'HR 337',
    ...raDecToRadians(1, 10, -55, 15),
    magnitude: 4.31,
    spectralType: 'B8V',
  },
  {
    name: 'HR 403',
    ...raDecToRadians(1, 25, 60, 14),
    magnitude: 4.24,
    spectralType: 'K5III',
  },
  {
    name: 'HR 472',
    ...raDecToRadians(1, 39, 42, 56),
    magnitude: 4.17,
    spectralType: 'M0III',
  },
  {
    name: 'HR 553',
    ...raDecToRadians(1, 55, -51, 36),
    magnitude: 4.02,
    spectralType: 'G8III',
  },
  {
    name: 'HR 617',
    ...raDecToRadians(2, 7, 34, 59),
    magnitude: 3.87,
    spectralType: 'K2III',
  },
  {
    name: 'HR 681',
    ...raDecToRadians(2, 20, -2, 59),
    magnitude: 4.35,
    spectralType: 'K0III',
  },
  {
    name: 'HR 740',
    ...raDecToRadians(2, 32, 8, 59),
    magnitude: 4.08,
    spectralType: 'F5V',
  },
  {
    name: 'HR 811',
    ...raDecToRadians(2, 44, -18, 34),
    magnitude: 3.89,
    spectralType: 'G8III',
  },
  {
    name: 'HR 897',
    ...raDecToRadians(3, 2, 53, 30),
    magnitude: 4.14,
    spectralType: 'A2V',
  },
  {
    name: 'HR 963',
    ...raDecToRadians(3, 12, -28, 59),
    magnitude: 3.7,
    spectralType: 'K1III',
  },
  {
    name: 'HR 1038',
    ...raDecToRadians(3, 27, 25, 56),
    magnitude: 4.27,
    spectralType: 'G5III',
  },
  {
    name: 'HR 1101',
    ...raDecToRadians(3, 37, -62, 7),
    magnitude: 4.05,
    spectralType: 'K0III',
  },
  {
    name: 'HR 1165',
    ...raDecToRadians(3, 47, 24, 7),
    magnitude: 3.97,
    spectralType: 'K3III',
  },
  {
    name: 'HR 1220',
    ...raDecToRadians(3, 55, -2, 28),
    magnitude: 4.43,
    spectralType: 'F0IV',
  },
  {
    name: 'HR 1283',
    ...raDecToRadians(4, 5, 47, 47),
    magnitude: 4.02,
    spectralType: 'G2IV',
  },
  {
    name: 'HR 1346',
    ...raDecToRadians(4, 15, 27, 21),
    magnitude: 3.76,
    spectralType: 'G8III',
  },
  {
    name: 'HR 1411',
    ...raDecToRadians(4, 25, 17, 33),
    magnitude: 3.84,
    spectralType: 'K0III',
  },
  {
    name: 'HR 1481',
    ...raDecToRadians(4, 36, 16, 31),
    magnitude: 3.53,
    spectralType: 'G9.5III',
  },
  {
    name: 'HR 1543',
    ...raDecToRadians(4, 47, -3, 15),
    magnitude: 4.24,
    spectralType: 'K4III',
  },
  {
    name: 'HR 1608',
    ...raDecToRadians(4, 57, 33, 10),
    magnitude: 3.91,
    spectralType: 'B9V',
  },
  {
    name: 'HR 1666',
    ...raDecToRadians(5, 6, 41, 14),
    magnitude: 4.05,
    spectralType: 'G0V',
  },
  {
    name: 'HR 1726',
    ...raDecToRadians(5, 16, 45, 59),
    magnitude: 4.12,
    spectralType: 'K1III',
  },
  {
    name: 'HR 1790',
    ...raDecToRadians(5, 26, -20, 45),
    magnitude: 3.79,
    spectralType: 'B2IV',
  },
  {
    name: 'HR 1852',
    ...raDecToRadians(5, 35, -5, 55),
    magnitude: 4.21,
    spectralType: 'B3V',
  },
  {
    name: 'HR 1903',
    ...raDecToRadians(5, 42, -1, 57),
    magnitude: 3.77,
    spectralType: 'K2III',
  },
  {
    name: 'HR 1956',
    ...raDecToRadians(5, 51, 54, 17),
    magnitude: 4.3,
    spectralType: 'K0III',
  },
  {
    name: 'HR 2004',
    ...raDecToRadians(5, 59, -22, 22),
    magnitude: 4.45,
    spectralType: 'B8V',
  },
  {
    name: 'HR 2061',
    ...raDecToRadians(6, 7, -6, 16),
    magnitude: 4.08,
    spectralType: 'B2III',
  },
  {
    name: 'HR 2124',
    ...raDecToRadians(6, 16, -30, 3),
    magnitude: 4.22,
    spectralType: 'K3III',
  },
  {
    name: 'HR 2177',
    ...raDecToRadians(6, 24, 4, 36),
    magnitude: 3.85,
    spectralType: 'B7V',
  },
  {
    name: 'HR 2241',
    ...raDecToRadians(6, 35, -52, 42),
    magnitude: 4.01,
    spectralType: 'F0IV',
  },
  {
    name: 'HR 2298',
    ...raDecToRadians(6, 44, 12, 54),
    magnitude: 4.13,
    spectralType: 'K0III',
  },
  {
    name: 'HR 2356',
    ...raDecToRadians(6, 53, 33, 58),
    magnitude: 3.95,
    spectralType: 'M0III',
  },
  {
    name: 'HR 2421',
    ...raDecToRadians(7, 4, -26, 23),
    magnitude: 4.34,
    spectralType: 'B8V',
  },
  {
    name: 'HR 2484',
    ...raDecToRadians(7, 14, 30, 15),
    magnitude: 4.06,
    spectralType: 'K2III',
  },
  {
    name: 'HR 2540',
    ...raDecToRadians(7, 22, -37, 6),
    magnitude: 3.83,
    spectralType: 'K4III',
  },
  {
    name: 'HR 2618',
    ...raDecToRadians(7, 36, 5, 14),
    magnitude: 4.44,
    spectralType: 'A7IV',
  },
  {
    name: 'HR 2693',
    ...raDecToRadians(7, 49, 28, 2),
    magnitude: 4.18,
    spectralType: 'F0III',
  },

  // =============================================
  // EXTENDED CATALOG - More fainter stars (Mag 4.0-5.5)
  // Distributed across all regions of the sky
  // =============================================

  // RA 8-10h region
  {
    name: 'HR 2763',
    ...raDecToRadians(8, 3, -24, 18),
    magnitude: 4.39,
    spectralType: 'K2III',
  },
  {
    name: 'HR 2827',
    ...raDecToRadians(8, 13, 17, 39),
    magnitude: 4.51,
    spectralType: 'G8III',
  },
  {
    name: 'HR 2881',
    ...raDecToRadians(8, 22, -36, 45),
    magnitude: 4.27,
    spectralType: 'B9V',
  },
  {
    name: 'HR 2943',
    ...raDecToRadians(8, 32, 60, 43),
    magnitude: 4.63,
    spectralType: 'A2V',
  },
  {
    name: 'HR 3003',
    ...raDecToRadians(8, 41, -5, 28),
    magnitude: 4.44,
    spectralType: 'K0III',
  },
  {
    name: 'HR 3064',
    ...raDecToRadians(8, 51, 28, 46),
    magnitude: 4.59,
    spectralType: 'F5V',
  },
  {
    name: 'HR 3131',
    ...raDecToRadians(9, 2, -43, 26),
    magnitude: 4.32,
    spectralType: 'K4III',
  },
  {
    name: 'HR 3188',
    ...raDecToRadians(9, 11, 36, 48),
    magnitude: 4.71,
    spectralType: 'A0V',
  },
  {
    name: 'HR 3249',
    ...raDecToRadians(9, 21, -59, 17),
    magnitude: 4.48,
    spectralType: 'B8V',
  },
  {
    name: 'HR 3314',
    ...raDecToRadians(9, 32, 2, 19),
    magnitude: 4.56,
    spectralType: 'G5III',
  },
  {
    name: 'HR 3373',
    ...raDecToRadians(9, 41, -8, 40),
    magnitude: 4.35,
    spectralType: 'K3III',
  },
  {
    name: 'HR 3438',
    ...raDecToRadians(9, 52, 51, 41),
    magnitude: 4.68,
    spectralType: 'F0IV',
  },

  // RA 10-12h region
  {
    name: 'HR 3492',
    ...raDecToRadians(10, 1, -22, 28),
    magnitude: 4.42,
    spectralType: 'K1III',
  },
  {
    name: 'HR 3569',
    ...raDecToRadians(10, 14, 23, 25),
    magnitude: 4.53,
    spectralType: 'A3V',
  },
  {
    name: 'HR 3627',
    ...raDecToRadians(10, 22, 41, 30),
    magnitude: 4.29,
    spectralType: 'G2IV',
  },
  {
    name: 'HR 3690',
    ...raDecToRadians(10, 32, -16, 51),
    magnitude: 4.67,
    spectralType: 'K0III',
  },
  {
    name: 'HR 3748',
    ...raDecToRadians(10, 41, 49, 19),
    magnitude: 4.41,
    spectralType: 'F8V',
  },
  {
    name: 'HR 3815',
    ...raDecToRadians(10, 53, 34, 13),
    magnitude: 4.58,
    spectralType: 'A7IV',
  },
  {
    name: 'HR 3873',
    ...raDecToRadians(11, 2, -29, 18),
    magnitude: 4.36,
    spectralType: 'K2III',
  },
  {
    name: 'HR 3940',
    ...raDecToRadians(11, 13, 61, 45),
    magnitude: 4.72,
    spectralType: 'B9V',
  },
  {
    name: 'HR 4002',
    ...raDecToRadians(11, 23, 10, 32),
    magnitude: 4.47,
    spectralType: 'G6III',
  },
  {
    name: 'HR 4069',
    ...raDecToRadians(11, 34, -37, 49),
    magnitude: 4.61,
    spectralType: 'A1V',
  },
  {
    name: 'HR 4133',
    ...raDecToRadians(11, 44, 20, 31),
    magnitude: 4.33,
    spectralType: 'K3III',
  },
  {
    name: 'HR 4199',
    ...raDecToRadians(11, 55, 53, 42),
    magnitude: 4.55,
    spectralType: 'F2V',
  },

  // RA 12-14h region
  {
    name: 'HR 4259',
    ...raDecToRadians(12, 4, -50, 44),
    magnitude: 4.38,
    spectralType: 'K0III',
  },
  {
    name: 'HR 4323',
    ...raDecToRadians(12, 14, 14, 34),
    magnitude: 4.64,
    spectralType: 'A5V',
  },
  {
    name: 'HR 4386',
    ...raDecToRadians(12, 24, -63, 6),
    magnitude: 4.46,
    spectralType: 'B8V',
  },
  {
    name: 'HR 4452',
    ...raDecToRadians(12, 35, 25, 56),
    magnitude: 4.59,
    spectralType: 'G3III',
  },
  {
    name: 'HR 4517',
    ...raDecToRadians(12, 45, -17, 33),
    magnitude: 4.31,
    spectralType: 'K4III',
  },
  {
    name: 'HR 4581',
    ...raDecToRadians(12, 54, 55, 58),
    magnitude: 4.73,
    spectralType: 'A0V',
  },
  {
    name: 'HR 4648',
    ...raDecToRadians(13, 5, -11, 10),
    magnitude: 4.42,
    spectralType: 'K1III',
  },
  {
    name: 'HR 4712',
    ...raDecToRadians(13, 15, 36, 22),
    magnitude: 4.56,
    spectralType: 'F6V',
  },
  {
    name: 'HR 4778',
    ...raDecToRadians(13, 26, -42, 28),
    magnitude: 4.35,
    spectralType: 'K0III',
  },
  {
    name: 'HR 4842',
    ...raDecToRadians(13, 36, 19, 11),
    magnitude: 4.68,
    spectralType: 'A2V',
  },
  {
    name: 'HR 4909',
    ...raDecToRadians(13, 47, -60, 50),
    magnitude: 4.49,
    spectralType: 'B9V',
  },
  {
    name: 'HR 4973',
    ...raDecToRadians(13, 57, 49, 19),
    magnitude: 4.61,
    spectralType: 'G8III',
  },

  // RA 14-16h region
  {
    name: 'HR 5041',
    ...raDecToRadians(14, 8, -36, 22),
    magnitude: 4.37,
    spectralType: 'K2III',
  },
  {
    name: 'HR 5104',
    ...raDecToRadians(14, 18, 26, 43),
    magnitude: 4.54,
    spectralType: 'A4V',
  },
  {
    name: 'HR 5170',
    ...raDecToRadians(14, 29, -47, 23),
    magnitude: 4.43,
    spectralType: 'K0III',
  },
  {
    name: 'HR 5234',
    ...raDecToRadians(14, 39, 51, 29),
    magnitude: 4.66,
    spectralType: 'F3V',
  },
  {
    name: 'HR 5301',
    ...raDecToRadians(14, 50, 6, 26),
    magnitude: 4.32,
    spectralType: 'K3III',
  },
  {
    name: 'HR 5365',
    ...raDecToRadians(15, 0, -25, 36),
    magnitude: 4.58,
    spectralType: 'B8V',
  },
  {
    name: 'HR 5432',
    ...raDecToRadians(15, 11, 74, 9),
    magnitude: 4.45,
    spectralType: 'G5III',
  },
  {
    name: 'HR 5496',
    ...raDecToRadians(15, 21, -22, 37),
    magnitude: 4.71,
    spectralType: 'A1V',
  },
  {
    name: 'HR 5563',
    ...raDecToRadians(15, 32, 33, 18),
    magnitude: 4.39,
    spectralType: 'K1III',
  },
  {
    name: 'HR 5627',
    ...raDecToRadians(15, 42, -55, 32),
    magnitude: 4.63,
    spectralType: 'K0III',
  },
  {
    name: 'HR 5694',
    ...raDecToRadians(15, 53, 12, 34),
    magnitude: 4.47,
    spectralType: 'F8V',
  },

  // RA 16-18h region
  {
    name: 'HR 5758',
    ...raDecToRadians(16, 3, -28, 13),
    magnitude: 4.52,
    spectralType: 'K2III',
  },
  {
    name: 'HR 5825',
    ...raDecToRadians(16, 14, 45, 2),
    magnitude: 4.34,
    spectralType: 'A5V',
  },
  {
    name: 'HR 5889',
    ...raDecToRadians(16, 24, -34, 18),
    magnitude: 4.69,
    spectralType: 'B9V',
  },
  {
    name: 'HR 5956',
    ...raDecToRadians(16, 35, 21, 30),
    magnitude: 4.41,
    spectralType: 'G6III',
  },
  {
    name: 'HR 6020',
    ...raDecToRadians(16, 45, -69, 2),
    magnitude: 4.57,
    spectralType: 'K3III',
  },
  {
    name: 'HR 6087',
    ...raDecToRadians(16, 56, 36, 48),
    magnitude: 4.28,
    spectralType: 'F5V',
  },
  {
    name: 'HR 6151',
    ...raDecToRadians(17, 6, -37, 6),
    magnitude: 4.65,
    spectralType: 'A0V',
  },
  {
    name: 'HR 6218',
    ...raDecToRadians(17, 17, 52, 18),
    magnitude: 4.43,
    spectralType: 'K0III',
  },
  {
    name: 'HR 6282',
    ...raDecToRadians(17, 27, -26, 26),
    magnitude: 4.59,
    spectralType: 'B8V',
  },
  {
    name: 'HR 6349',
    ...raDecToRadians(17, 38, 38, 47),
    magnitude: 4.36,
    spectralType: 'G2IV',
  },
  {
    name: 'HR 6413',
    ...raDecToRadians(17, 48, -56, 44),
    magnitude: 4.72,
    spectralType: 'K1III',
  },

  // RA 18-20h region
  {
    name: 'HR 6480',
    ...raDecToRadians(18, 0, 8, 52),
    magnitude: 4.48,
    spectralType: 'A3V',
  },
  {
    name: 'HR 6544',
    ...raDecToRadians(18, 10, -34, 23),
    magnitude: 4.61,
    spectralType: 'K2III',
  },
  {
    name: 'HR 6611',
    ...raDecToRadians(18, 21, 45, 17),
    magnitude: 4.33,
    spectralType: 'F0IV',
  },
  {
    name: 'HR 6675',
    ...raDecToRadians(18, 31, -26, 18),
    magnitude: 4.56,
    spectralType: 'B9V',
  },
  {
    name: 'HR 6742',
    ...raDecToRadians(18, 42, 27, 58),
    magnitude: 4.42,
    spectralType: 'K0III',
  },
  {
    name: 'HR 6806',
    ...raDecToRadians(18, 52, -46, 58),
    magnitude: 4.68,
    spectralType: 'G8III',
  },
  {
    name: 'HR 6873',
    ...raDecToRadians(19, 3, 33, 22),
    magnitude: 4.37,
    spectralType: 'A7IV',
  },
  {
    name: 'HR 6937',
    ...raDecToRadians(19, 13, -29, 37),
    magnitude: 4.54,
    spectralType: 'K3III',
  },
  {
    name: 'HR 7004',
    ...raDecToRadians(19, 24, 62, 35),
    magnitude: 4.45,
    spectralType: 'F2V',
  },
  {
    name: 'HR 7068',
    ...raDecToRadians(19, 34, 10, 37),
    magnitude: 4.63,
    spectralType: 'K1III',
  },
  {
    name: 'HR 7135',
    ...raDecToRadians(19, 45, 45, 8),
    magnitude: 4.31,
    spectralType: 'A0V',
  },

  // RA 20-22h region
  {
    name: 'HR 7199',
    ...raDecToRadians(19, 55, -16, 8),
    magnitude: 4.58,
    spectralType: 'K0III',
  },
  {
    name: 'HR 7266',
    ...raDecToRadians(20, 6, 40, 15),
    magnitude: 4.44,
    spectralType: 'G5III',
  },
  {
    name: 'HR 7330',
    ...raDecToRadians(20, 16, -42, 18),
    magnitude: 4.67,
    spectralType: 'B8V',
  },
  {
    name: 'HR 7397',
    ...raDecToRadians(20, 27, 9, 53),
    magnitude: 4.35,
    spectralType: 'K2III',
  },
  {
    name: 'HR 7461',
    ...raDecToRadians(20, 37, -5, 34),
    magnitude: 4.52,
    spectralType: 'A5V',
  },
  {
    name: 'HR 7528',
    ...raDecToRadians(20, 48, 33, 58),
    magnitude: 4.41,
    spectralType: 'F6V',
  },
  {
    name: 'HR 7592',
    ...raDecToRadians(20, 58, -56, 44),
    magnitude: 4.69,
    spectralType: 'K0III',
  },
  {
    name: 'HR 7659',
    ...raDecToRadians(21, 9, 28, 5),
    magnitude: 4.38,
    spectralType: 'G3III',
  },
  {
    name: 'HR 7723',
    ...raDecToRadians(21, 19, -0, 19),
    magnitude: 4.55,
    spectralType: 'K3III',
  },
  {
    name: 'HR 7790',
    ...raDecToRadians(21, 30, 45, 17),
    magnitude: 4.46,
    spectralType: 'A2V',
  },
  {
    name: 'HR 7854',
    ...raDecToRadians(21, 40, -46, 58),
    magnitude: 4.62,
    spectralType: 'B9V',
  },

  // RA 22-24h region
  {
    name: 'HR 7921',
    ...raDecToRadians(21, 51, 15, 12),
    magnitude: 4.34,
    spectralType: 'K1III',
  },
  {
    name: 'HR 7985',
    ...raDecToRadians(22, 1, -29, 37),
    magnitude: 4.57,
    spectralType: 'G8III',
  },
  {
    name: 'HR 8052',
    ...raDecToRadians(22, 12, 58, 16),
    magnitude: 4.43,
    spectralType: 'F3V',
  },
  {
    name: 'HR 8116',
    ...raDecToRadians(22, 22, -17, 59),
    magnitude: 4.65,
    spectralType: 'K0III',
  },
  {
    name: 'HR 8183',
    ...raDecToRadians(22, 33, 42, 20),
    magnitude: 4.39,
    spectralType: 'A4V',
  },
  {
    name: 'HR 8247',
    ...raDecToRadians(22, 43, -42, 18),
    magnitude: 4.58,
    spectralType: 'K2III',
  },
  {
    name: 'HR 8314',
    ...raDecToRadians(22, 54, 29, 5),
    magnitude: 4.47,
    spectralType: 'G5III',
  },
  {
    name: 'HR 8378',
    ...raDecToRadians(23, 4, -15, 12),
    magnitude: 4.71,
    spectralType: 'B8V',
  },
  {
    name: 'HR 8445',
    ...raDecToRadians(23, 15, 35, 37),
    magnitude: 4.36,
    spectralType: 'K3III',
  },
  {
    name: 'HR 8509',
    ...raDecToRadians(23, 25, -57, 14),
    magnitude: 4.53,
    spectralType: 'A1V',
  },
  {
    name: 'HR 8576',
    ...raDecToRadians(23, 36, 15, 11),
    magnitude: 4.44,
    spectralType: 'F8V',
  },
  {
    name: 'HR 8640',
    ...raDecToRadians(23, 46, -33, 1),
    magnitude: 4.68,
    spectralType: 'K0III',
  },
  {
    name: 'HR 8707',
    ...raDecToRadians(23, 57, 50, 31),
    magnitude: 4.32,
    spectralType: 'G2IV',
  },

  // RA 0-2h region (additional)
  {
    name: 'HR 8773',
    ...raDecToRadians(0, 7, -62, 7),
    magnitude: 4.56,
    spectralType: 'K1III',
  },
  {
    name: 'HR 8840',
    ...raDecToRadians(0, 18, 23, 28),
    magnitude: 4.41,
    spectralType: 'A6V',
  },
  {
    name: 'HR 8904',
    ...raDecToRadians(0, 28, -55, 15),
    magnitude: 4.63,
    spectralType: 'B9V',
  },
  {
    name: 'HR 8971',
    ...raDecToRadians(0, 39, 40, 57),
    magnitude: 4.48,
    spectralType: 'G6III',
  },
  {
    name: 'HR 9035',
    ...raDecToRadians(0, 49, 4, 5),
    magnitude: 4.59,
    spectralType: 'K2III',
  },
  {
    name: 'HR 9102',
    ...raDecToRadians(1, 0, -51, 36),
    magnitude: 4.34,
    spectralType: 'F5V',
  },
  {
    name: 'HR 9166',
    ...raDecToRadians(1, 10, 60, 14),
    magnitude: 4.72,
    spectralType: 'A0V',
  },
  {
    name: 'HR 9233',
    ...raDecToRadians(1, 21, -28, 59),
    magnitude: 4.45,
    spectralType: 'K0III',
  },
  {
    name: 'HR 9297',
    ...raDecToRadians(1, 31, 35, 37),
    magnitude: 4.57,
    spectralType: 'G3III',
  },
  {
    name: 'HR 9364',
    ...raDecToRadians(1, 42, -18, 34),
    magnitude: 4.38,
    spectralType: 'K3III',
  },

  // RA 2-4h region (additional)
  {
    name: 'HR 9428',
    ...raDecToRadians(1, 52, 49, 52),
    magnitude: 4.66,
    spectralType: 'B8V',
  },
  {
    name: 'HR 9495',
    ...raDecToRadians(2, 3, 8, 59),
    magnitude: 4.43,
    spectralType: 'F2V',
  },
  {
    name: 'HR 9559',
    ...raDecToRadians(2, 13, -33, 1),
    magnitude: 4.55,
    spectralType: 'K1III',
  },
  {
    name: 'HR 9626',
    ...raDecToRadians(2, 24, 63, 40),
    magnitude: 4.31,
    spectralType: 'A3V',
  },
  {
    name: 'HR 9690',
    ...raDecToRadians(2, 34, -2, 59),
    magnitude: 4.69,
    spectralType: 'G8III',
  },
  {
    name: 'HR 9757',
    ...raDecToRadians(2, 45, 42, 56),
    magnitude: 4.47,
    spectralType: 'K0III',
  },
  {
    name: 'HR 9821',
    ...raDecToRadians(2, 55, -62, 7),
    magnitude: 4.58,
    spectralType: 'F6V',
  },
  {
    name: 'HR 9888',
    ...raDecToRadians(3, 6, 25, 56),
    magnitude: 4.36,
    spectralType: 'K2III',
  },
  {
    name: 'HR 9952',
    ...raDecToRadians(3, 16, -17, 20),
    magnitude: 4.64,
    spectralType: 'A5V',
  },
  {
    name: 'HR 10019',
    ...raDecToRadians(3, 27, 53, 30),
    magnitude: 4.42,
    spectralType: 'G5III',
  },

  // RA 4-6h region (additional)
  {
    name: 'HR 10083',
    ...raDecToRadians(3, 37, -28, 59),
    magnitude: 4.57,
    spectralType: 'B9V',
  },
  {
    name: 'HR 10150',
    ...raDecToRadians(3, 48, 47, 47),
    magnitude: 4.33,
    spectralType: 'K3III',
  },
  {
    name: 'HR 10214',
    ...raDecToRadians(3, 58, 17, 33),
    magnitude: 4.71,
    spectralType: 'F0IV',
  },
  {
    name: 'HR 10281',
    ...raDecToRadians(4, 9, -52, 42),
    magnitude: 4.45,
    spectralType: 'K0III',
  },
  {
    name: 'HR 10345',
    ...raDecToRadians(4, 19, 33, 10),
    magnitude: 4.59,
    spectralType: 'A7IV',
  },
  {
    name: 'HR 10412',
    ...raDecToRadians(4, 30, -3, 15),
    magnitude: 4.38,
    spectralType: 'G2IV',
  },
  {
    name: 'HR 10476',
    ...raDecToRadians(4, 40, 54, 17),
    magnitude: 4.66,
    spectralType: 'K1III',
  },
  {
    name: 'HR 10543',
    ...raDecToRadians(4, 51, -20, 45),
    magnitude: 4.44,
    spectralType: 'B8V',
  },
  {
    name: 'HR 10607',
    ...raDecToRadians(5, 1, 41, 14),
    magnitude: 4.52,
    spectralType: 'F5V',
  },
  {
    name: 'HR 10674',
    ...raDecToRadians(5, 12, -30, 3),
    magnitude: 4.35,
    spectralType: 'K2III',
  },

  // RA 6-8h region (additional)
  {
    name: 'HR 10738',
    ...raDecToRadians(5, 22, 28, 36),
    magnitude: 4.68,
    spectralType: 'A2V',
  },
  {
    name: 'HR 10805',
    ...raDecToRadians(5, 33, -22, 22),
    magnitude: 4.46,
    spectralType: 'G6III',
  },
  {
    name: 'HR 10869',
    ...raDecToRadians(5, 43, 46, 0),
    magnitude: 4.59,
    spectralType: 'K0III',
  },
  {
    name: 'HR 10936',
    ...raDecToRadians(5, 54, -6, 16),
    magnitude: 4.37,
    spectralType: 'B9V',
  },
  {
    name: 'HR 11000',
    ...raDecToRadians(6, 4, 12, 54),
    magnitude: 4.73,
    spectralType: 'F3V',
  },
  {
    name: 'HR 11067',
    ...raDecToRadians(6, 15, -40, 0),
    magnitude: 4.41,
    spectralType: 'K3III',
  },
  {
    name: 'HR 11131',
    ...raDecToRadians(6, 25, 33, 58),
    magnitude: 4.54,
    spectralType: 'A4V',
  },
  {
    name: 'HR 11198',
    ...raDecToRadians(6, 36, -26, 23),
    magnitude: 4.32,
    spectralType: 'G8III',
  },
  {
    name: 'HR 11262',
    ...raDecToRadians(6, 46, 30, 15),
    magnitude: 4.67,
    spectralType: 'K1III',
  },
  {
    name: 'HR 11329',
    ...raDecToRadians(6, 57, -37, 6),
    magnitude: 4.48,
    spectralType: 'F8V',
  },
  {
    name: 'HR 11393',
    ...raDecToRadians(7, 7, 5, 14),
    magnitude: 4.56,
    spectralType: 'A0V',
  },
  {
    name: 'HR 11460',
    ...raDecToRadians(7, 18, -43, 26),
    magnitude: 4.39,
    spectralType: 'K0III',
  },
  {
    name: 'HR 11524',
    ...raDecToRadians(7, 28, 28, 2),
    magnitude: 4.64,
    spectralType: 'G3III',
  },
  {
    name: 'HR 11591',
    ...raDecToRadians(7, 39, -8, 40),
    magnitude: 4.43,
    spectralType: 'K2III',
  },

  // Even fainter stars for density (Mag 5.0-5.5)
  {
    name: 'HD 432',
    ...raDecToRadians(0, 9, 36, 37),
    magnitude: 5.12,
    spectralType: 'G8III',
  },
  {
    name: 'HD 1326',
    ...raDecToRadians(0, 18, -15, 28),
    magnitude: 5.24,
    spectralType: 'K0III',
  },
  {
    name: 'HD 2262',
    ...raDecToRadians(0, 27, 54, 31),
    magnitude: 5.08,
    spectralType: 'A5V',
  },
  {
    name: 'HD 3229',
    ...raDecToRadians(0, 36, -32, 46),
    magnitude: 5.31,
    spectralType: 'K3III',
  },
  {
    name: 'HD 4128',
    ...raDecToRadians(0, 45, 18, 59),
    magnitude: 5.19,
    spectralType: 'F2V',
  },
  {
    name: 'HD 5015',
    ...raDecToRadians(0, 54, -48, 12),
    magnitude: 5.36,
    spectralType: 'G5III',
  },
  {
    name: 'HD 5916',
    ...raDecToRadians(1, 3, 41, 5),
    magnitude: 5.15,
    spectralType: 'K1III',
  },
  {
    name: 'HD 6805',
    ...raDecToRadians(1, 12, -27, 38),
    magnitude: 5.28,
    spectralType: 'A3V',
  },
  {
    name: 'HD 7693',
    ...raDecToRadians(1, 21, 63, 22),
    magnitude: 5.41,
    spectralType: 'B9V',
  },
  {
    name: 'HD 8574',
    ...raDecToRadians(1, 30, 6, 12),
    magnitude: 5.11,
    spectralType: 'G2IV',
  },
  {
    name: 'HD 9472',
    ...raDecToRadians(1, 39, -54, 19),
    magnitude: 5.33,
    spectralType: 'K2III',
  },
  {
    name: 'HD 10361',
    ...raDecToRadians(1, 48, 28, 47),
    magnitude: 5.22,
    spectralType: 'F6V',
  },
  {
    name: 'HD 11271',
    ...raDecToRadians(1, 57, -39, 55),
    magnitude: 5.45,
    spectralType: 'K0III',
  },
  {
    name: 'HD 12140',
    ...raDecToRadians(2, 6, 52, 34),
    magnitude: 5.17,
    spectralType: 'A7IV',
  },
  {
    name: 'HD 13043',
    ...raDecToRadians(2, 15, -12, 41),
    magnitude: 5.29,
    spectralType: 'G8III',
  },
  {
    name: 'HD 13931',
    ...raDecToRadians(2, 24, 71, 18),
    magnitude: 5.38,
    spectralType: 'K3III',
  },
  {
    name: 'HD 14832',
    ...raDecToRadians(2, 33, 15, 26),
    magnitude: 5.14,
    spectralType: 'F0IV',
  },
  {
    name: 'HD 15720',
    ...raDecToRadians(2, 42, -61, 3),
    magnitude: 5.32,
    spectralType: 'B8V',
  },
  {
    name: 'HD 16619',
    ...raDecToRadians(2, 51, 37, 42),
    magnitude: 5.21,
    spectralType: 'K1III',
  },
  {
    name: 'HD 17506',
    ...raDecToRadians(3, 0, -24, 51),
    magnitude: 5.43,
    spectralType: 'G6III',
  },

  // More scattered faint stars across different Dec bands
  {
    name: 'HD 18397',
    ...raDecToRadians(3, 9, 58, 28),
    magnitude: 5.16,
    spectralType: 'A2V',
  },
  {
    name: 'HD 19275',
    ...raDecToRadians(3, 18, 3, 14),
    magnitude: 5.35,
    spectralType: 'K0III',
  },
  {
    name: 'HD 20165',
    ...raDecToRadians(3, 27, -47, 36),
    magnitude: 5.24,
    spectralType: 'F5V',
  },
  {
    name: 'HD 21042',
    ...raDecToRadians(3, 36, 44, 52),
    magnitude: 5.47,
    spectralType: 'G3III',
  },
  {
    name: 'HD 21932',
    ...raDecToRadians(3, 45, -19, 18),
    magnitude: 5.13,
    spectralType: 'K2III',
  },
  {
    name: 'HD 22809',
    ...raDecToRadians(3, 54, 67, 41),
    magnitude: 5.31,
    spectralType: 'A5V',
  },
  {
    name: 'HD 23699',
    ...raDecToRadians(4, 3, 22, 6),
    magnitude: 5.19,
    spectralType: 'B9V',
  },
  {
    name: 'HD 24576',
    ...raDecToRadians(4, 12, -58, 47),
    magnitude: 5.42,
    spectralType: 'K3III',
  },
  {
    name: 'HD 25466',
    ...raDecToRadians(4, 21, 39, 23),
    magnitude: 5.27,
    spectralType: 'G8III',
  },
  {
    name: 'HD 26343',
    ...raDecToRadians(4, 30, -7, 32),
    magnitude: 5.38,
    spectralType: 'F2V',
  },
  {
    name: 'HD 27233',
    ...raDecToRadians(4, 39, 74, 55),
    magnitude: 5.11,
    spectralType: 'K1III',
  },
  {
    name: 'HD 28110',
    ...raDecToRadians(4, 48, 11, 47),
    magnitude: 5.34,
    spectralType: 'A4V',
  },
  {
    name: 'HD 29000',
    ...raDecToRadians(4, 57, -41, 19),
    magnitude: 5.23,
    spectralType: 'G5III',
  },
  {
    name: 'HD 29877',
    ...raDecToRadians(5, 6, 56, 38),
    magnitude: 5.45,
    spectralType: 'K0III',
  },
  {
    name: 'HD 30767',
    ...raDecToRadians(5, 15, -28, 54),
    magnitude: 5.18,
    spectralType: 'B8V',
  },

  // Southern hemisphere faint stars
  {
    name: 'HD 31644',
    ...raDecToRadians(5, 24, 34, 12),
    magnitude: 5.36,
    spectralType: 'F6V',
  },
  {
    name: 'HD 32534',
    ...raDecToRadians(5, 33, -66, 31),
    magnitude: 5.12,
    spectralType: 'K2III',
  },
  {
    name: 'HD 33411',
    ...raDecToRadians(5, 42, 7, 24),
    magnitude: 5.29,
    spectralType: 'G2IV',
  },
  {
    name: 'HD 34301',
    ...raDecToRadians(5, 51, -35, 48),
    magnitude: 5.41,
    spectralType: 'A7IV',
  },
  {
    name: 'HD 35178',
    ...raDecToRadians(6, 0, 49, 36),
    magnitude: 5.22,
    spectralType: 'K3III',
  },
  {
    name: 'HD 36068',
    ...raDecToRadians(6, 9, -14, 57),
    magnitude: 5.33,
    spectralType: 'F0IV',
  },
  {
    name: 'HD 36945',
    ...raDecToRadians(6, 18, 61, 22),
    magnitude: 5.17,
    spectralType: 'G8III',
  },
  {
    name: 'HD 37835',
    ...raDecToRadians(6, 27, -52, 13),
    magnitude: 5.44,
    spectralType: 'K1III',
  },
  {
    name: 'HD 38712',
    ...raDecToRadians(6, 36, 26, 41),
    magnitude: 5.28,
    spectralType: 'A2V',
  },
  {
    name: 'HD 39602',
    ...raDecToRadians(6, 45, -3, 28),
    magnitude: 5.39,
    spectralType: 'B9V',
  },
  {
    name: 'HD 40479',
    ...raDecToRadians(6, 54, 43, 55),
    magnitude: 5.15,
    spectralType: 'K0III',
  },
  {
    name: 'HD 41369',
    ...raDecToRadians(7, 3, -69, 37),
    magnitude: 5.32,
    spectralType: 'G5III',
  },
  {
    name: 'HD 42246',
    ...raDecToRadians(7, 12, 18, 29),
    magnitude: 5.21,
    spectralType: 'F5V',
  },
  {
    name: 'HD 43136',
    ...raDecToRadians(7, 21, -38, 46),
    magnitude: 5.46,
    spectralType: 'K2III',
  },
  {
    name: 'HD 44013',
    ...raDecToRadians(7, 30, 55, 12),
    magnitude: 5.14,
    spectralType: 'A5V',
  },

  // Additional coverage for all regions
  {
    name: 'HD 44903',
    ...raDecToRadians(7, 39, -21, 34),
    magnitude: 5.37,
    spectralType: 'G3III',
  },
  {
    name: 'HD 45780',
    ...raDecToRadians(7, 48, 31, 53),
    magnitude: 5.25,
    spectralType: 'K3III',
  },
  {
    name: 'HD 46670',
    ...raDecToRadians(7, 57, -48, 58),
    magnitude: 5.43,
    spectralType: 'F2V',
  },
  {
    name: 'HD 47547',
    ...raDecToRadians(8, 6, 64, 27),
    magnitude: 5.18,
    spectralType: 'B8V',
  },
  {
    name: 'HD 48437',
    ...raDecToRadians(8, 15, -9, 41),
    magnitude: 5.31,
    spectralType: 'K1III',
  },
  {
    name: 'HD 49314',
    ...raDecToRadians(8, 24, 47, 15),
    magnitude: 5.22,
    spectralType: 'A3V',
  },
  {
    name: 'HD 50204',
    ...raDecToRadians(8, 33, -56, 23),
    magnitude: 5.44,
    spectralType: 'G8III',
  },
  {
    name: 'HD 51081',
    ...raDecToRadians(8, 42, 22, 38),
    magnitude: 5.16,
    spectralType: 'K0III',
  },
  {
    name: 'HD 51971',
    ...raDecToRadians(8, 51, -33, 52),
    magnitude: 5.35,
    spectralType: 'F6V',
  },
  {
    name: 'HD 52848',
    ...raDecToRadians(9, 0, 71, 6),
    magnitude: 5.27,
    spectralType: 'G2IV',
  },
  {
    name: 'HD 53738',
    ...raDecToRadians(9, 9, 5, 14),
    magnitude: 5.41,
    spectralType: 'K2III',
  },
  {
    name: 'HD 54615',
    ...raDecToRadians(9, 18, -62, 47),
    magnitude: 5.19,
    spectralType: 'A7IV',
  },
  {
    name: 'HD 55505',
    ...raDecToRadians(9, 27, 38, 31),
    magnitude: 5.38,
    spectralType: 'B9V',
  },
  {
    name: 'HD 56382',
    ...raDecToRadians(9, 36, -18, 56),
    magnitude: 5.13,
    spectralType: 'K3III',
  },
  {
    name: 'HD 57272',
    ...raDecToRadians(9, 45, 54, 44),
    magnitude: 5.32,
    spectralType: 'F0IV',
  },
  {
    name: 'HD 58149',
    ...raDecToRadians(9, 54, -45, 21),
    magnitude: 5.24,
    spectralType: 'G5III',
  },

  // =============================================
  // BULK STAR CATALOG - Dense sky coverage
  // ~2500 additional stars magnitude 4.5-6.5
  // =============================================
  ...generateBulkStars(),
];

// Generate a large number of stars for dense sky coverage
function generateBulkStars(): CatalogStar[] {
  const stars: CatalogStar[] = [];
  const spectralTypes = [
    'O9V',
    'B5V',
    'B8V',
    'A0V',
    'A3V',
    'A7V',
    'F0V',
    'F5V',
    'G0V',
    'G5III',
    'G8III',
    'K0III',
    'K2III',
    'K5III',
    'M0III',
    'M2III',
  ];

  // Seeded random for consistent star positions
  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  // Generate stars across the entire celestial sphere
  // Use more stars near the galactic plane for realism
  for (let i = 0; i < 2500; i++) {
    // RA: 0 to 24 hours (uniform distribution)
    const raHours = random() * 24;
    const raMinutes = random() * 60;

    // Dec: -90 to +90 degrees (cosine-weighted for uniform sphere coverage)
    const u = random() * 2 - 1; // -1 to 1
    const decDegrees = Math.asin(u) * (180 / Math.PI);
    const decMinutes = (random() - 0.5) * 60;

    // Magnitude: exponentially more faint stars (realistic distribution)
    // More faint stars than bright ones
    const magBase = 4.5 + random() * 2.0; // 4.5 to 6.5
    const magnitude = Math.round(magBase * 100) / 100;

    // Random spectral type (weighted toward cooler stars)
    const spectralIndex = Math.floor(random() * random() * spectralTypes.length);
    const spectralType = spectralTypes[Math.min(spectralIndex, spectralTypes.length - 1)];

    const coords = raDecToRadians(
      Math.floor(raHours),
      Math.floor(raMinutes),
      Math.floor(decDegrees),
      Math.abs(Math.floor(decMinutes)),
    );

    stars.push({
      name: `TYC ${1000 + i}`,
      ...coords,
      magnitude,
      spectralType,
    });
  }

  return stars;
}

// Get all stars with constellation connections for drawing lines
export function getConstellationStars(): CatalogStar[] {
  return STAR_CATALOG.filter((star) => star.connections && star.connections.length > 0);
}

// Get all background stars (no connections)
export function getBackgroundStars(): CatalogStar[] {
  return STAR_CATALOG.filter((star) => !star.connections || star.connections.length === 0);
}

// Find a star by name
export function findStarByName(name: string): CatalogStar | undefined {
  return STAR_CATALOG.find((star) => star.name.toLowerCase() === name.toLowerCase());
}
