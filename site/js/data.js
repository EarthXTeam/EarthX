// EDIT HERE to add regions, variables, mechanism texts and the investigation order.
//
// Four suspects: surface temperature (the driver), then the three water
// variables it acts on — precipitation, evapotranspiration, soil water storage.
//
// `k` on a region and `k` on a variable build the data file names:
//   data/grid_maps/<region.k>_<variable.k>_map.json
//   data/regional_series/<region.k>_<variable.k>_regional.json
// So adding a region is: add an entry here, drop its files into data/.

const REG = {
  med: {
    n: "Mediterranean Basin",
    s: "the Mediterranean",
    k: "mediterranean",
    la: 38.6,
    lo: 15.75,
    b: "Dry summers, wet winters, and a long record of people living on the edge of the water budget.",
  },
  sah: {
    n: "Sahel",
    s: "the Sahel",
    k: "sahel",
    la: 15,
    lo: 11.25,
    b: "The belt between the Sahara and the savanna, where one monsoon decides the year.",
  },
  amz: {
    n: "Amazon Basin",
    s: "the Amazon",
    k: "amazon",
    la: -7.5,
    lo: -61.9,
    b: "The largest body of fresh water moving through land and air anywhere, and the forest that keeps it circulating.",
  },
};

/*
 * Each variable carries:
 *   n, k, u      name, file-name stem, unit
 *   role         where it sits in the chain, shown on its card
 *   q, d, w      the case question, the definition, why it is investigated
 *   mech         the mechanism — stated BEFORE any data is shown
 *   ask          the question the visitor answers before seeing the evidence
 *   opts         labels for the three possible answers
 *
 * SURFACE TEMPERATURE DATA: the file stem is `temperature`, matching the
 * 1981-2025 NASA export. If a later export uses another short name, change
 * `k` here and nothing else — the page builds every path from it.
 */
const VAR = {
  t: {
    n: "Surface Temperature",
    id: "surface_temperature",
    k: "temperature",
    u: "°C",
    role: "The driver",
    q: (r) => `Is the land surface over ${r} getting warmer?`,
    d: "Monthly surface air temperature over land, the heat the rest of the water cycle has to answer to.",
    w: "First: the energy that moves all the water below.",
    mech:
      "Greenhouse gases let sunlight through and slow the escape of heat. More of them means the surface loses energy more slowly than it gains it, so it warms. Nothing in that chain depends on local weather, which is why this is the one suspect the other three answer to.",
    ask: "Before you look at anything: over 45 years, what should temperature here be doing?",
    opts: { up: "Warmer", down: "Cooler", flat: "No clear change" },
  },
  p: {
    n: "Precipitation",
    id: "precipitation",
    k: "ppt",
    u: "mm",
    role: "The supply",
    q: (r) => `Is rainfall in ${r} rising or falling?`,
    d: "Rain and snow reaching the ground each month.",
    w: "Then: the water supply itself.",
    mech:
      "Warmer air holds roughly 7% more water vapour per degree, so there is more water available to fall. But rain lands where air rises, and warming also shifts the belts of rising and sinking air. A warmer world is wetter in total and not wetter everywhere, so the mechanism alone cannot tell you which way one region goes.",
    ask: "Before you look: what should 45 years have done to rainfall here?",
    opts: { up: "More rain", down: "Less rain", flat: "No clear change" },
  },
  e: {
    n: "Evapotranspiration",
    id: "evapotranspiration",
    k: "aet",
    u: "mm",
    role: "The loss",
    q: (r) => `Is more water leaving the land for the air over ${r}?`,
    d: "Water returning to the air from soil (evaporation) and plants (transpiration). Calculated by the model, not observed.",
    w: "Then: where the water goes back to the air.",
    mech:
      "This one has two ceilings. The air's thirst sets how much water it could take — warmer, drier air takes more — and the ground sets how much there is to take. Whichever ceiling is lower wins. In a wet place the thirst decides; in a dry place the supply decides, and extra heat changes nothing because there is nothing left to evaporate.",
    ask: "Before you look: which ceiling do you think this region sits under?",
    opts: {
      up: "Thirst-limited — rising",
      down: "Supply-limited — falling",
      flat: "No clear change",
    },
  },
  s: {
    n: "Soil Water Storage",
    id: "soil_moisture",
    k: "soil",
    u: "% vol",
    role: "What is left",
    q: (r) => `Is the soil in ${r} getting wetter or drier?`,
    d: "The share of the soil column that is water, the supply plants drink from between rains.",
    w: "Last: what is left in the ground.",
    mech:
      "Soil water is a balance sheet — rain in, evaporation and drainage out, plants drawing on the remainder. Because it is a balance, it can fall while rainfall holds perfectly steady. All that takes is for the demand side to grow.",
    ask: "Before you look: is the soil here gaining water or losing it?",
    opts: { up: "Wetter", down: "Drier", flat: "No clear change" },
  },
};

// The order the suspects are investigated in: the driver, then the chain.
const FLOW = ["t", "p", "e", "s"];

/*
 * The reading: what the result means, shown only after the visitor has seen
 * the evidence and committed to a call. Mechanism goes in VAR.mech above —
 * these are about this region in particular.
 */
const READ = {
  med: {
    t: "Warming is the cleanest signal on this site, and it is what makes the next three questions worth asking: extra heat raises the air's thirst whether or not the rain ever changes.",
    p: "Winter storm tracks vary a lot from year to year, and that variance is wide enough to hide a small drift in the totals.",
    e: "Warmer air pulls more water out of soil and plants. The atmosphere's thirst grows even where rain does not shrink.",
    s: "Rain holds roughly steady while evaporation climbs, so the soil loses more than it gains. It dries without any drop in rainfall — the balance sheet at work.",
  },
  sah: {
    t: "Surface heating here is strong and poorly buffered: little cloud, little standing moisture. Read this case next to the rainfall one, because heat and a recovering monsoon pull in opposite directions.",
    p: "Monsoon rains have been rebounding since the drought decades, linked to warmer Atlantic waters and shifting ocean patterns.",
    e: "More rain gives soil and plants more water to release, so evapotranspiration follows rainfall upward. Here the supply ceiling is the one that moved.",
    s: "Wetter seasons recharge the soil. The recovery is visible in the record, but the record is still short.",
  },
  amz: {
    t: "Evaporation from an intact canopy spends energy that would otherwise heat the air, which damps the warming a surface this close to the equator would otherwise show. Where the canopy thins, that damping weakens.",
    p: "Rainfall swings hard with El Niño and La Niña. Those swings are large enough to bury a slow drift in the totals, which is why so many cells come back undecided.",
    e: "The forest returns enormous amounts of water to the air. Where the canopy thins that return weakens, so this variable tracks the state of the forest as much as the weather.",
    s: "Dry-season soil water is where a drying signal tends to surface first: the forest draws on stored moisture to get through the dry months, so losses show there before rainfall totals move.",
  },
};

// What would change each verdict. Shown in the reading, because a verdict you
// cannot imagine overturning is not a finding, it is a belief.
const OVERTURN = {
  confirmed:
    "A second dataset. The test says this record trends; it cannot say the record is right. Running the same test on an independent dataset is the thing that would either confirm this or sink it.",
  case_open:
    "Time, mostly. The direction is in the data; the record is not yet long enough to rule out chance. A finer grid or a seasonal split can also sharpen it, if the signal lives in one season rather than the annual mean.",
  no_evidence:
    "Nothing changing and a change smaller than the year-to-year swings look identical to this test. Separating them needs either a longer record or a less noisy variable — which is why reading the four suspects together beats reading any one of them.",
};
