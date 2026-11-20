// Bag-making formulas, taken from the client's spec (Software[1].docx).
// Units: bag & roll dimensions in inches, roll length in metres, weight in kg, GSM in g/m².
// 39.37 = inches per metre; 1550 = square inches per square metre.

export const BAG_TYPES = {
  dcut: { name: "D-Cut", hasLoop: false },
  loop: { name: "Loop handle", hasLoop: true },
  box: { name: "Box", hasLoop: true },
  ucut: { name: "U-Cut", hasLoop: false },
};

export const LOOP_WEIGHT_G = 3.4; // grams of handle per loop/box bag (spec)

/** Width of fabric one bag consumes along the roll (inches). */
function repeatLength(type, { w, l, g = 0 }) {
  if (type === "box") return w + g;
  if (type === "ucut") return l;
  return w; // dcut, loop
}

/** Printing cylinder size: W+G for D-cut/loop/box, L for U-cut. */
export function cylinderSize(type, bag) {
  return type === "ucut" ? bag.l : bag.w + (bag.g || 0);
}

/** Roll width (inches) the bag needs, as a [min, max] range. */
export function rollSizeRange(type, { w, l, g = 0 }) {
  switch (type) {
    case "dcut": return [l * 2 + 5, l * 2 + 6];
    case "loop": return [l * 2 + 2, l * 2 + 4];
    case "box": return [l * 2 + g + 2, l * 2 + g + 4];
    case "ucut": return [w * 2 + 1, w * 2 + 2];
    default: return [0, 0];
  }
}

/** Weight of a single bag in grams. */
export function bagWeightGrams(type, bag, rollSize, gsm) {
  const fabric = (repeatLength(type, bag) * rollSize * gsm) / 1550;
  if (type === "ucut") return fabric * 0.9; // U-cut loses ~10% to the cut-out
  return fabric + (BAG_TYPES[type]?.hasLoop ? LOOP_WEIGHT_G : 0);
}

/** How many bags one roll yields, by length and by weight; we trust the lower. */
export function bagsFromRoll(type, bag, roll) {
  const rep = repeatLength(type, bag);
  if (!rep) return 0;
  const byLength = (roll.length_m * 39.37) / rep;
  // Spec writes (kg × 1550)/(rep × size × gsm); ×1000 converts kg→g so the result is pieces.
  const byWeight = (roll.net_kg * 1000 * 1550) / (rep * roll.size_in * roll.gsm);
  return Math.floor(Math.min(byLength || Infinity, byWeight || Infinity));
}

/** Fabric (kg) an order needs. */
export function fabricKgForOrder(type, bag, rollSize, gsm, pieces) {
  const fabricOnly = (repeatLength(type, bag) * rollSize * gsm) / 1550;
  return (fabricOnly * pieces) / 1000;
}

/** Everything the order form shows live. */
export function orderPreview({ bag_type, w, l, g, gsm, qty }) {
  const bag = { w: +w || 0, l: +l || 0, g: +g || 0 };
  if (!bag_type || !bag.w || !bag.l) return null;
  const [rmin, rmax] = rollSizeRange(bag_type, bag);
  const rollSize = rmin;
  return {
    cylinder: cylinderSize(bag_type, bag),
    rollSize: [rmin, rmax],
    bagWeightG: gsm ? +bagWeightGrams(bag_type, bag, rollSize, +gsm).toFixed(1) : null,
    fabricKg: gsm && qty ? Math.ceil(fabricKgForOrder(bag_type, bag, rollSize, +gsm, +qty)) : null,
  };
}
