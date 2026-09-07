// Built-in object presets (all sizes in cm: w = width, d = depth, h = height,
// z = elevation of the underside above the floor). Users can add their own
// presets via the Custom tab; those are stored in localStorage.

export const CATEGORIES = ['Structure', 'Living', 'Bedroom', 'Dining & Kitchen', 'Office', 'Bathroom', 'Storage', 'Misc'];

const P = (cat, name, w, d, h, color, extra = {}) => ({ cat, name, w, d, h, color, shape: 'rect', z: 0, ...extra });

export const PRESETS = [
  // Structure
  P('Structure', 'Wall segment', 200, 12, 260, '#9ca3af'),
  P('Structure', 'Half wall', 150, 12, 110, '#9ca3af'),
  P('Structure', 'Door', 90, 8, 210, '#b45309', { shape: 'door' }),
  P('Structure', 'Double door', 160, 8, 210, '#b45309'),
  P('Structure', 'Window', 120, 12, 120, '#7dd3fc', { z: 90 }),
  P('Structure', 'Column', 30, 30, 260, '#6b7280'),
  P('Structure', 'Round column', 30, 30, 260, '#6b7280', { shape: 'ellipse' }),
  P('Structure', 'Stairs', 100, 300, 260, '#a3a3a3'),
  P('Structure', 'Kitchen island', 200, 90, 90, '#d6d3d1'),
  P('Structure', 'Fireplace', 120, 40, 110, '#78716c'),
  P('Structure', 'Radiator', 100, 10, 60, '#e5e7eb', { z: 12 }),

  // Living
  P('Living', 'Sofa (3 seat)', 220, 95, 85, '#60a5fa', { shape: 'round' }),
  P('Living', 'Sofa (2 seat)', 160, 95, 85, '#60a5fa', { shape: 'round' }),
  P('Living', 'Armchair', 85, 90, 85, '#818cf8', { shape: 'round' }),
  P('Living', 'Corner sofa', 280, 95, 85, '#60a5fa', { shape: 'round' }),
  P('Living', 'Chaise', 100, 95, 85, '#60a5fa', { shape: 'round' }),
  P('Living', 'Coffee table', 120, 60, 45, '#fbbf24'),
  P('Living', 'Round coffee table', 80, 80, 45, '#fbbf24', { shape: 'ellipse' }),
  P('Living', 'Side table', 50, 50, 55, '#fbbf24'),
  P('Living', 'TV stand', 180, 45, 50, '#78716c'),
  P('Living', 'TV (65")', 145, 8, 84, '#1f2937', { z: 60 }),
  P('Living', 'Bookshelf', 80, 30, 200, '#a16207'),
  P('Living', 'Rug', 240, 170, 1, '#fca5a5'),
  P('Living', 'Round rug', 200, 200, 1, '#fca5a5', { shape: 'ellipse' }),
  P('Living', 'Floor lamp', 30, 30, 160, '#fde68a', { shape: 'ellipse' }),
  P('Living', 'Plant', 40, 40, 120, '#4ade80', { shape: 'ellipse' }),
  P('Living', 'Piano (upright)', 150, 60, 125, '#374151'),

  // Bedroom
  P('Bedroom', 'Bed (single)', 90, 200, 55, '#c084fc'),
  P('Bedroom', 'Bed (double)', 140, 200, 55, '#c084fc'),
  P('Bedroom', 'Bed (queen)', 160, 200, 55, '#c084fc'),
  P('Bedroom', 'Bed (king)', 180, 200, 55, '#c084fc'),
  P('Bedroom', 'Bed (US king)', 193, 203, 55, '#c084fc'),
  P('Bedroom', 'Nightstand', 45, 40, 55, '#d8b4fe'),
  P('Bedroom', 'Wardrobe', 150, 60, 220, '#a16207'),
  P('Bedroom', 'Dresser', 120, 50, 85, '#ca8a04'),
  P('Bedroom', 'Crib', 70, 130, 90, '#f9a8d4'),
  P('Bedroom', 'Bench', 120, 40, 45, '#d8b4fe'),

  // Dining & Kitchen
  P('Dining & Kitchen', 'Dining table (4)', 120, 80, 75, '#f59e0b'),
  P('Dining & Kitchen', 'Dining table (6)', 180, 90, 75, '#f59e0b'),
  P('Dining & Kitchen', 'Dining table (8)', 240, 100, 75, '#f59e0b'),
  P('Dining & Kitchen', 'Round table', 110, 110, 75, '#f59e0b', { shape: 'ellipse' }),
  P('Dining & Kitchen', 'Chair', 45, 45, 90, '#fdba74'),
  P('Dining & Kitchen', 'Bar stool', 38, 38, 75, '#fdba74', { shape: 'ellipse' }),
  P('Dining & Kitchen', 'Sideboard', 160, 45, 80, '#a16207'),
  P('Dining & Kitchen', 'Base cabinet', 60, 60, 90, '#e7e5e4'),
  P('Dining & Kitchen', 'Wall cabinet', 60, 35, 70, '#f5f5f4', { z: 140 }),
  P('Dining & Kitchen', 'Fridge', 70, 70, 180, '#e5e7eb'),
  P('Dining & Kitchen', 'Range / oven', 60, 60, 90, '#9ca3af'),
  P('Dining & Kitchen', 'Sink unit', 80, 60, 90, '#cbd5e1'),
  P('Dining & Kitchen', 'Dishwasher', 60, 60, 85, '#d1d5db'),

  // Office
  P('Office', 'Desk', 140, 70, 75, '#34d399'),
  P('Office', 'Desk (large)', 180, 80, 75, '#34d399'),
  P('Office', 'L-desk return', 100, 60, 75, '#34d399'),
  P('Office', 'Standing desk', 160, 80, 110, '#34d399'),
  P('Office', 'Office chair', 60, 60, 110, '#6ee7b7', { shape: 'ellipse' }),
  P('Office', 'Filing cabinet', 45, 60, 130, '#9ca3af'),
  P('Office', 'Whiteboard', 120, 5, 90, '#f3f4f6', { z: 100 }),
  P('Office', 'Monitor', 62, 20, 45, '#1f2937', { z: 75 }),
  P('Office', 'Printer', 45, 40, 25, '#6b7280', { z: 75 }),

  // Bathroom
  P('Bathroom', 'Bathtub', 170, 75, 55, '#a5f3fc', { shape: 'round' }),
  P('Bathroom', 'Shower', 90, 90, 200, '#a5f3fc'),
  P('Bathroom', 'Toilet', 40, 70, 75, '#e0f2fe', { shape: 'round' }),
  P('Bathroom', 'Sink / vanity', 80, 50, 85, '#e0f2fe'),
  P('Bathroom', 'Washing machine', 60, 60, 85, '#e5e7eb'),
  P('Bathroom', 'Towel radiator', 60, 8, 120, '#e5e7eb', { z: 20 }),

  // Storage
  P('Storage', 'Shelf unit', 90, 40, 180, '#a16207'),
  P('Storage', 'Wall shelf', 80, 25, 4, '#a16207', { z: 150 }),
  P('Storage', 'Cabinet', 100, 45, 100, '#ca8a04'),
  P('Storage', 'Chest', 90, 45, 50, '#ca8a04'),
  P('Storage', 'Coat rack', 40, 40, 175, '#78716c', { shape: 'ellipse' }),
  P('Storage', 'Shoe rack', 80, 30, 60, '#a16207'),

  // Misc
  P('Misc', 'Box', 100, 100, 100, '#a78bfa'),
  P('Misc', 'Cylinder', 100, 100, 100, '#a78bfa', { shape: 'ellipse' }),
  P('Misc', 'Treadmill', 80, 180, 140, '#4b5563'),
  P('Misc', 'Exercise bike', 55, 110, 130, '#4b5563'),
  P('Misc', 'Pool table', 254, 140, 80, '#16a34a'),
  P('Misc', 'Ping-pong table', 274, 152, 76, '#2563eb'),
  P('Misc', 'Aquarium', 120, 45, 60, '#38bdf8', { z: 70 }),
  P('Misc', 'Crate / pallet', 120, 80, 15, '#d6d3d1'),
];

export const PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#f43f5e', '#78716c', '#6b7280', '#374151', '#a16207', '#d6d3d1', '#f5f5f4', '#ffffff',
];

/** A demo plan so first launch isn't an empty canvas. */
export function demoPlan() {
  const o = (name, x, y, w, d, h, color, extra = {}) => ({ name, x, y, w, d, h, color, shape: 'rect', rot: 0, z: 0, ...extra });
  return {
    name: 'Studio apartment',
    room: { width: 600, length: 450, height: 260, wallThickness: 15, floorColor: '#e7dcc8', wallColor: '#d1d5db' },
    objects: [
      o('Door', 60, 450, 90, 8, 210, '#b45309', { shape: 'door', id: 'o1' }),
      o('Window', 300, 0, 160, 12, 130, '#7dd3fc', { z: 90, id: 'o2' }),
      o('Rug', 200, 210, 260, 200, 1, '#fca5a5', { id: 'o5', group: 'g1' }),
      o('Sofa', 200, 120, 220, 95, 85, '#60a5fa', { shape: 'round', id: 'o3', group: 'g1' }),
      o('Coffee table', 200, 230, 110, 55, 45, '#fbbf24', { id: 'o4', group: 'g1' }),
      o('TV stand', 200, 425, 180, 45, 50, '#78716c', { id: 'o6' }),
      o('TV', 200, 428, 145, 8, 84, '#1f2937', { z: 60, id: 'o7' }),
      o('Bed (queen)', 500, 130, 160, 200, 55, '#c084fc', { id: 'o8', rot: 90 }),
      o('Nightstand', 550, 32, 45, 40, 55, '#d8b4fe', { id: 'o9' }),
      o('Nightstand', 550, 228, 45, 40, 55, '#d8b4fe', { id: 'o10' }),
      o('Wardrobe', 520, 420, 150, 60, 220, '#a16207', { id: 'o11' }),
      o('Desk', 80, 40, 140, 70, 75, '#34d399', { id: 'o12' }),
      o('Office chair', 80, 105, 60, 60, 110, '#6ee7b7', { shape: 'ellipse', id: 'o13' }),
      o('Plant', 30, 420, 40, 40, 120, '#4ade80', { shape: 'ellipse', id: 'o14' }),
      o('Bookshelf', 380, 435, 80, 30, 200, '#a16207', { id: 'o15' }),
    ],
    groups: { g1: { name: 'Lounge set' } },
  };
}
