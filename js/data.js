/* Balkan Union — fictional alert network data. */
window.BU = window.BU || {};

BU.META = {
  name: 'Balkan Union',
  system: 'Common Alert Network',
  version: '3.0',
  memberCount: 14,
  timeZone: 'Europe/Belgrade'
};

BU.ZONES = {
  Austria: { name: 'Austria', group: 'Central Europe', center: [47.62, 14.32], launch: ['north'], code: 'AT' },
  Hungary: { name: 'Hungary', group: 'Central Europe', center: [47.12, 19.42], launch: ['north', 'east'], code: 'HU' },
  Slovenia: { name: 'Slovenia', group: 'Western Balkans', center: [46.12, 14.88], launch: ['west'], code: 'SI' },
  Croatia: { name: 'Croatia', group: 'Western Balkans', center: [45.32, 16.42], launch: ['west'], code: 'HR' },
  'Bosnia and Herzegovina': { name: 'Bosnia & Herz.', group: 'Western Balkans', center: [44.12, 17.82], launch: ['west', 'east'], code: 'BA' },
  'Republic of Serbia': { name: 'Serbia', group: 'Western Balkans', center: [44.12, 20.82], launch: ['east', 'west'], code: 'RS' },
  Montenegro: { name: 'Montenegro', group: 'Western Balkans', center: [42.82, 19.32], launch: ['west'], code: 'ME' },
  Kosovo: { name: 'Kosovo', group: 'Western Balkans', center: [42.62, 21.02], launch: ['south', 'east'], code: 'XK' },
  Albania: { name: 'Albania', group: 'Western Balkans', center: [41.12, 20.02], launch: ['west', 'south'], code: 'AL' },
  'North Macedonia': { name: 'North Macedonia', group: 'Western Balkans', center: [41.62, 21.72], launch: ['south'], code: 'MK' },
  Greece: { name: 'Greece', group: 'Southern Balkans', center: [39.32, 22.02], launch: ['south'], code: 'GR' },
  Bulgaria: { name: 'Bulgaria', group: 'Southern Balkans', center: [42.72, 25.22], launch: ['east'], code: 'BG' },
  Romania: { name: 'Romania', group: 'Eastern Balkans', center: [45.92, 24.92], launch: ['east'], code: 'RO' },
  Moldova: { name: 'Moldova', group: 'Eastern Balkans', center: [47.22, 28.52], launch: ['east'], code: 'MD' }
};

BU.CITIES = [
  { name: 'Vienna', zone: 'Austria', lat: 48.2082, lon: 16.3738, capital: true },
  { name: 'Graz', zone: 'Austria', lat: 47.0707, lon: 15.4395 },
  { name: 'Linz', zone: 'Austria', lat: 48.3069, lon: 14.2858 },
  { name: 'Budapest', zone: 'Hungary', lat: 47.4979, lon: 19.0402, capital: true },
  { name: 'Debrecen', zone: 'Hungary', lat: 47.5316, lon: 21.6273 },
  { name: 'Szeged', zone: 'Hungary', lat: 46.2530, lon: 20.1414 },
  { name: 'Ljubljana', zone: 'Slovenia', lat: 46.0569, lon: 14.5058, capital: true },
  { name: 'Maribor', zone: 'Slovenia', lat: 46.5547, lon: 15.6459 },
  { name: 'Zagreb', zone: 'Croatia', lat: 45.8150, lon: 15.9819, capital: true },
  { name: 'Split', zone: 'Croatia', lat: 43.5081, lon: 16.4402 },
  { name: 'Rijeka', zone: 'Croatia', lat: 45.3271, lon: 14.4422 },
  { name: 'Sarajevo', zone: 'Bosnia and Herzegovina', lat: 43.8563, lon: 18.4131, capital: true },
  { name: 'Banja Luka', zone: 'Bosnia and Herzegovina', lat: 44.7722, lon: 17.1910 },
  { name: 'Belgrade', zone: 'Republic of Serbia', lat: 44.7866, lon: 20.4489, capital: true },
  { name: 'Novi Sad', zone: 'Republic of Serbia', lat: 45.2671, lon: 19.8335 },
  { name: 'Niš', zone: 'Republic of Serbia', lat: 43.3209, lon: 21.8958 },
  { name: 'Podgorica', zone: 'Montenegro', lat: 42.4304, lon: 19.2594, capital: true },
  { name: 'Bar', zone: 'Montenegro', lat: 42.0931, lon: 19.1003 },
  { name: 'Pristina', zone: 'Kosovo', lat: 42.6629, lon: 21.1655, capital: true },
  { name: 'Tirana', zone: 'Albania', lat: 41.3275, lon: 19.8187, capital: true },
  { name: 'Vlorë', zone: 'Albania', lat: 40.4661, lon: 19.4914 },
  { name: 'Skopje', zone: 'North Macedonia', lat: 41.9981, lon: 21.4254, capital: true },
  { name: 'Bitola', zone: 'North Macedonia', lat: 41.0328, lon: 21.3347 },
  { name: 'Athens', zone: 'Greece', lat: 37.9838, lon: 23.7275, capital: true },
  { name: 'Thessaloniki', zone: 'Greece', lat: 40.6401, lon: 22.9444 },
  { name: 'Patras', zone: 'Greece', lat: 38.2466, lon: 21.7346 },
  { name: 'Heraklion', zone: 'Greece', lat: 35.3387, lon: 25.1442 },
  { name: 'Sofia', zone: 'Bulgaria', lat: 42.6977, lon: 23.3219, capital: true },
  { name: 'Varna', zone: 'Bulgaria', lat: 43.2141, lon: 27.9147 },
  { name: 'Burgas', zone: 'Bulgaria', lat: 42.5048, lon: 27.4626 },
  { name: 'Plovdiv', zone: 'Bulgaria', lat: 42.1354, lon: 24.7453 },
  { name: 'Bucharest', zone: 'Romania', lat: 44.4268, lon: 26.1025, capital: true },
  { name: 'Cluj-Napoca', zone: 'Romania', lat: 46.7712, lon: 23.6236 },
  { name: 'Constanța', zone: 'Romania', lat: 44.1598, lon: 28.6348 },
  { name: 'Iași', zone: 'Romania', lat: 47.1585, lon: 27.6014 },
  { name: 'Timișoara', zone: 'Romania', lat: 45.7489, lon: 21.2087 },
  { name: 'Chișinău', zone: 'Moldova', lat: 47.0105, lon: 28.8638, capital: true },
  { name: 'Bălți', zone: 'Moldova', lat: 47.7615, lon: 27.9289 },
  { name: 'Cahul', zone: 'Moldova', lat: 45.9044, lon: 28.1944 }
];

BU.LAUNCH_SITES = [
  { id: 'baltic', name: 'Baltic Squadron', region: 'north', lat: 56.40, lon: 19.90 },
  { id: 'east-command', name: 'East Command', region: 'north', lat: 52.80, lon: 31.60 },
  { id: 'black-sea', name: 'Black Sea Platform', region: 'east', lat: 43.20, lon: 34.40 },
  { id: 'azov', name: 'Azov Flotilla', region: 'east', lat: 46.30, lon: 37.60 },
  { id: 'caspian', name: 'Caspian Flotilla', region: 'east', lat: 41.50, lon: 49.10 },
  { id: 'mediterranean', name: 'Mediterranean Task Force', region: 'south', lat: 34.50, lon: 23.50 },
  { id: 'anatolia', name: 'Anatolian Range', region: 'south', lat: 38.90, lon: 33.20 },
  { id: 'adriatic', name: 'Adriatic Squadron', region: 'west', lat: 41.40, lon: 18.40 }
];

BU.THREAT_CLASSES = {
  ballistic: {
    id: 'ballistic',
    label: 'Ballistic',
    full: 'Ballistic missile',
    color: '#e11d1d',
    weapons: ['Iskander-M', 'KN-23', 'LORA'],
    duration: [55, 110],
    radiusKm: 230,
    interceptRate: 0.42,
    speedKmh: 7100,
    altKm: [32, 54],
    glyph: 'ballistic'
  },
  cruise: {
    id: 'cruise',
    label: 'Cruise',
    full: 'Cruise missile',
    color: '#f97316',
    weapons: ['Kalibr', 'Kh-101', 'Neptune'],
    duration: [85, 165],
    radiusKm: 170,
    interceptRate: 0.56,
    speedKmh: 880,
    altKm: [0.05, 0.6],
    glyph: 'cruise'
  },
  jet: {
    id: 'jet',
    label: 'Jet drone',
    full: 'Jet-powered drone',
    color: '#d946ef',
    weapons: ['Geran-3', 'Shahed-238'],
    duration: [105, 200],
    radiusKm: 100,
    interceptRate: 0.50,
    speedKmh: 720,
    altKm: [0.8, 3.5],
    glyph: 'jet'
  },
  shahed: {
    id: 'shahed',
    label: 'Shahed',
    full: 'Shahed drone',
    color: '#eab308',
    weapons: ['Shahed-136', 'Geran-2'],
    duration: [150, 275],
    radiusKm: 95,
    interceptRate: 0.62,
    speedKmh: 185,
    altKm: [0.5, 2.4],
    glyph: 'shahed'
  }
};

BU.CLASS_ORDER = ['ballistic', 'cruise', 'jet', 'shahed'];

BU.BORDER_SECTORS = [
  { id: 'north', name: 'Northern Frontier', neighbour: 'Czechia', kind: 'land', lat: 48.72, lon: 16.02 },
  { id: 'carpathian', name: 'Carpathian Frontier', neighbour: 'Ukraine', kind: 'land', lat: 47.92, lon: 24.52 },
  { id: 'eastern', name: 'Eastern Frontier', neighbour: 'Ukraine', kind: 'land', lat: 47.42, lon: 29.10 },
  { id: 'danube', name: 'Danube Delta', neighbour: 'Ukraine', kind: 'river', lat: 45.28, lon: 29.62 },
  { id: 'black-sea', name: 'Black Sea Coast', neighbour: 'Maritime', kind: 'maritime', lat: 43.52, lon: 28.86 },
  { id: 'marmara', name: 'Marmara Frontier', neighbour: 'Türkiye', kind: 'land', lat: 41.72, lon: 26.62 },
  { id: 'aegean', name: 'Aegean Frontier', neighbour: 'Türkiye', kind: 'maritime', lat: 40.62, lon: 25.94 },
  { id: 'ionian', name: 'Ionian Coast', neighbour: 'Maritime', kind: 'maritime', lat: 39.54, lon: 20.12 },
  { id: 'adriatic', name: 'Adriatic Coast', neighbour: 'Maritime', kind: 'maritime', lat: 42.72, lon: 18.02 },
  { id: 'alpine', name: 'Alpine Frontier', neighbour: 'Italy', kind: 'land', lat: 46.02, lon: 13.62 }
];

BU.BORDER_INCIDENTS = [
  {
    code: 'UAV-INCURSION',
    level: 'elevated',
    label: 'Unidentified UAV crossed the frontier',
    detail: 'Radar track lost after 6 km inside Union airspace. Patrol dispatched.',
    weight: 5
  },
  {
    code: 'GPS-JAM',
    level: 'elevated',
    label: 'GPS jamming spike detected',
    detail: 'Navigation degradation reported along a 40 km corridor. Civil traffic advised.',
    weight: 4
  },
  {
    code: 'EW-BURST',
    level: 'elevated',
    label: 'Electronic warfare interference',
    detail: 'Wideband interference on frontier sensors. Network running on backup links.',
    weight: 3
  },
  {
    code: 'CONVOY',
    level: 'elevated',
    label: 'Military convoy detected near crossing',
    detail: 'Twelve vehicles moving toward the boundary lane. Observation resumed.',
    weight: 3
  },
  {
    code: 'CROSSING-SURGE',
    level: 'elevated',
    label: 'Civilian crossing surge',
    detail: 'Queue exceeds four hours. Border detachments reinforced.',
    weight: 2
  },
  {
    code: 'NAVAL-SHADOW',
    level: 'elevated',
    label: 'Naval vessel shadowing patrol',
    detail: 'Unknown corvette maintaining 8 km distance. Maritime patrol keeping station.',
    weight: 3
  },
  {
    code: 'AIRSPACE-VIOLATION',
    level: 'critical',
    label: 'Fast jet airspace violation',
    detail: 'Two interceptors scrambled. Track exited the frontier after 90 seconds.',
    weight: 2
  },
  {
    code: 'LOITERING-MUNITION',
    level: 'critical',
    label: 'Loitering munition crossed frontier',
    detail: 'Object neutralised by point defence 4 km from the boundary.',
    weight: 2
  },
  {
    code: 'BALLISTIC-DEBRIS',
    level: 'critical',
    label: 'Ballistic debris tracked',
    detail: 'Re-entry track over the frontier sector. No impact reported on Union soil.',
    weight: 1
  },
  {
    code: 'SONAR-CONTACT',
    level: 'critical',
    label: 'Sub-surface contact inside patrol box',
    detail: 'Contact classified unknown. ASW asset repositioned to the sector.',
    weight: 1
  }
];

BU.BORDER_LEVELS = {
  calm: { color: '#34d399', label: 'Calm' },
  elevated: { color: '#f59e0b', label: 'Elevated' },
  critical: { color: '#ef4444', label: 'Critical' }
};

BU.BORDER_NEIGHBOUR_LABELS = { Maritime: 'Maritime approach' };
