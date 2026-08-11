/** D.H. Griffin job-cost accounting taxonomy (the "Cat" column on the real
 * "JC Entries by Job" report). This is the single source of truth for the
 * API, the DB write-path validation, and the web UI. It is the COMPLETE DHG
 * Standard Cost Code List (see cost_codes.json), loaded verbatim: {code,
 * description, group} mapped to {section (group human name), code, name
 * (description)}. Stays a plain extensible array (never a rigid DB enum) so
 * DHG can add/adjust codes in this one module with no migration. */
export type CostCodeEntry = {
  section: string;
  code: string;
  name: string;
};

// Order here is the display order (grouped by section, in DHG group order)
// shown throughout the app. To add a code: append an entry to the right
// section — no other change is required anywhere else in the codebase.
export const COST_CODES: CostCodeEntry[] = [
  { section: "Labor & Payroll", code: "01-000", name: "Labor & Payroll" },
  { section: "Labor & Payroll", code: "01-001", name: "Labor/Payroll Estimate" },
  { section: "Labor & Payroll", code: "01-100", name: "Internal Labor" },
  { section: "Labor & Payroll", code: "01-101", name: "Payroll Taxes" },
  { section: "Labor & Payroll", code: "01-102", name: "Labor - Internal OT" },
  { section: "Labor & Payroll", code: "01-103", name: "Riding Time (Labor)" },
  { section: "Labor & Payroll", code: "01-105", name: "Temporary Labor" },
  { section: "Trucking/Hauling", code: "02-000", name: "Trucking/Hauling" },
  { section: "Trucking/Hauling", code: "02-001", name: "Trucking/Hauling Estimate" },
  { section: "Trucking/Hauling", code: "02-100", name: "Trucking/Hauling-Internal" },
  { section: "Trucking/Hauling", code: "02-105", name: "Trucking/Hauling-External" },
  { section: "Trucking/Hauling", code: "02-110", name: "Fuel-Gasoline" },
  { section: "Trucking/Hauling", code: "02-120", name: "Fuel-Diesel" },
  { section: "Trucking/Hauling", code: "02-130", name: "Job Mobilization" },
  { section: "Trucking/Hauling", code: "02-135", name: "Job Demobilization" },
  { section: "Equipment-Internal", code: "03-000", name: "Equipment-Internal" },
  { section: "Equipment-Internal", code: "03-001", name: "Equipment-Internal Estimate" },
  { section: "Equipment-Internal", code: "03-101", name: "Backhoe-Class 1-200" },
  { section: "Equipment-Internal", code: "03-102", name: "BH/22 ton exc w/magnet" },
  { section: "Equipment-Internal", code: "03-103", name: "Backhoe Class 3-300" },
  { section: "Equipment-Internal", code: "03-104", name: "BH 30 ton exc w/8k hammer" },
  { section: "Equipment-Internal", code: "03-105", name: "Backhoe-Class 3-UP/Shear" },
  { section: "Equipment-Internal", code: "03-106", name: "Backhoe-Class 4-400" },
  { section: "Equipment-Internal", code: "03-107", name: "BH 49 ton exc w/UP,shear,hmmr" },
  { section: "Equipment-Internal", code: "03-108", name: "30 Ton Machine Grapple/Magnet" },
  { section: "Equipment-Internal", code: "03-109", name: "BH/80 ton exc w/UP or 15khammr" },
  { section: "Equipment-Internal", code: "03-110", name: "BH 92 Foot Long Arm" },
  { section: "Equipment-Internal", code: "03-111", name: "Bobcat-Class 1-Mini" },
  { section: "Equipment-Internal", code: "03-112", name: "Bobcat-Class 2" },
  { section: "Equipment-Internal", code: "03-113", name: "Crane Hyd 10 Ton" },
  { section: "Equipment-Internal", code: "03-114", name: "15 Metric Tonne Exc. w/ Thumb" },
  { section: "Equipment-Internal", code: "03-115", name: "Excavator w/ 5k Hammer" },
  { section: "Equipment-Internal", code: "03-116", name: "BH 20/22 exc w/thmb,bct,grapl" },
  { section: "Equipment-Internal", code: "03-117", name: "30 Ton Exc. w/ Thb & Bkt" },
  { section: "Equipment-Internal", code: "03-118", name: "30 Ton Exc. w/ Long Arm" },
  { section: "Equipment-Internal", code: "03-119", name: "40 Ton Exc. w/ Long Arm" },
  { section: "Equipment-Internal", code: "03-120", name: "Brock" },
  { section: "Equipment-Internal", code: "03-121", name: "60 Ton Exc. w/ Stk & Boom" },
  { section: "Equipment-Internal", code: "03-122", name: "60 Ton Exc. w/ 130 ft Long Arm" },
  { section: "Equipment-Internal", code: "03-123", name: "High Cab Material Handler" },
  { section: "Equipment-Internal", code: "03-124", name: "BH/80 ton exc w/95-123 longarm" },
  { section: "Equipment-Internal", code: "03-125", name: "40 Ton Excavator w/hammer" },
  { section: "Equipment-Internal", code: "03-126", name: "BH/12 ton exc-shear/grap/thumb" },
  { section: "Equipment-Internal", code: "03-127", name: "Excavator 22 Ton/UP" },
  { section: "Equipment-Internal", code: "03-128", name: "55\" PC290 Long Arm" },
  { section: "Equipment-Internal", code: "03-129", name: "BH120 with shear" },
  { section: "Equipment-Internal", code: "03-130", name: "Can Truck" },
  { section: "Equipment-Internal", code: "03-131", name: "Crane" },
  { section: "Equipment-Internal", code: "03-132", name: "Crane-Manitowoc" },
  { section: "Equipment-Internal", code: "03-133", name: "Crane-All Terrain" },
  { section: "Equipment-Internal", code: "03-134", name: "Crane Conv 3-50 Ton" },
  { section: "Equipment-Internal", code: "03-135", name: "Crane Conv 70 Ton" },
  { section: "Equipment-Internal", code: "03-136", name: "Scrap Handler/Ped. Crane" },
  { section: "Equipment-Internal", code: "03-137", name: "Can Trailer" },
  { section: "Equipment-Internal", code: "03-138", name: "Farm Tractor" },
  { section: "Equipment-Internal", code: "03-139", name: "Air Tugger" },
  { section: "Equipment-Internal", code: "03-140", name: "Dump Hopper" },
  { section: "Equipment-Internal", code: "03-145", name: "300 Ton High Reach Excavator" },
  { section: "Equipment-Internal", code: "03-151", name: "Dump Truck-C 1-2 Ton (S/Axle)" },
  { section: "Equipment-Internal", code: "03-152", name: "Dump Truck-C 2 (Tandem Axle)" },
  { section: "Equipment-Internal", code: "03-160", name: "Forklift" },
  { section: "Equipment-Internal", code: "03-161", name: "Forklift - 8,000 lb" },
  { section: "Equipment-Internal", code: "03-162", name: "Forklift - 5,000 lb" },
  { section: "Equipment-Internal", code: "03-163", name: "Forklift - 15,000 lb" },
  { section: "Equipment-Internal", code: "03-164", name: "Forklift - 30,000 lb" },
  { section: "Equipment-Internal", code: "03-165", name: "6k Telescopic Forklift" },
  { section: "Equipment-Internal", code: "03-166", name: "10k Telescopic Forklift" },
  { section: "Equipment-Internal", code: "03-170", name: "Manlift" },
  { section: "Equipment-Internal", code: "03-175", name: "Military Truck" },
  { section: "Equipment-Internal", code: "03-176", name: "Bus" },
  { section: "Equipment-Internal", code: "03-180", name: "Pickup Truck" },
  { section: "Equipment-Internal", code: "03-181", name: "Walk Behind Skid Steer" },
  { section: "Equipment-Internal", code: "03-185", name: "Portable Rock Crushing Plant" },
  { section: "Equipment-Internal", code: "03-186", name: "Portable Screening Plants" },
  { section: "Equipment-Internal", code: "03-187", name: "Portable Tub Grinder" },
  { section: "Equipment-Internal", code: "03-188", name: "Radial Stacker" },
  { section: "Equipment-Internal", code: "03-190", name: "Road Tractor" },
  { section: "Equipment-Internal", code: "03-191", name: "Roller" },
  { section: "Equipment-Internal", code: "03-192", name: "Farm Tractor W/ Portable RC" },
  { section: "Equipment-Internal", code: "03-195", name: "Service Truck" },
  { section: "Equipment-Internal", code: "03-201", name: "Rubber Tire-Class 1-920" },
  { section: "Equipment-Internal", code: "03-202", name: "Rubber Tire-Class 2-930" },
  { section: "Equipment-Internal", code: "03-203", name: "Rubber tire load 966/972" },
  { section: "Equipment-Internal", code: "03-204", name: "Rubber Tire Loader - Large" },
  { section: "Equipment-Internal", code: "03-206", name: "Articulated Off Road Dump Truck" },
  { section: "Equipment-Internal", code: "03-207", name: "Vacuum Truck" },
  { section: "Equipment-Internal", code: "03-210", name: "Scrap Bailer" },
  { section: "Equipment-Internal", code: "03-215", name: "Portable Bailer" },
  { section: "Equipment-Internal", code: "03-216", name: "Vertical Baler" },
  { section: "Equipment-Internal", code: "03-219", name: "Mini Track Loader" },
  { section: "Equipment-Internal", code: "03-220", name: "Track Loader" },
  { section: "Equipment-Internal", code: "03-221", name: "TL/D7R Track Tractor w/ ripper" },
  { section: "Equipment-Internal", code: "03-222", name: "TL/compact dozer" },
  { section: "Equipment-Internal", code: "03-223", name: "TL/953 Machine" },
  { section: "Equipment-Internal", code: "03-230", name: "Wire Stripper" },
  { section: "Equipment-Internal", code: "03-240", name: "Wrecker" },
  { section: "Equipment-Internal", code: "03-250", name: "Wrecking Ball" },
  { section: "Equipment-Internal", code: "03-275", name: "Sweeper" },
  { section: "Equipment-Internal", code: "03-300", name: "Scrap Bailer" },
  { section: "Equipment-Internal", code: "03-320", name: "Impact Crusher" },
  { section: "Equipment-Internal", code: "03-400", name: "Track Loader" },
  { section: "Equipment-Internal", code: "03-500", name: "Equipment-Internal-Other" },
  { section: "Equipment-Internal", code: "03-501", name: "Other EQ-Air Compressor" },
  { section: "Equipment-Internal", code: "03-510", name: "Generators and Pumps" },
  { section: "Equipment-Internal", code: "03-520", name: "Gators and Mules" },
  { section: "Equipment-Internal", code: "03-525", name: "Radio Controlled Excavator" },
  { section: "Equipment-Internal", code: "03-530", name: "Portable Office" },
  { section: "Equipment-Internal", code: "03-535", name: "Tooth Puller" },
  { section: "Equipment-Internal", code: "03-540", name: "Pressure Washer w/Trailer" },
  { section: "Equipment-Internal", code: "03-550", name: "Other EQ-Welding" },
  { section: "Equipment-Internal", code: "03-600", name: "Portable Scales" },
  { section: "Equipment-Internal", code: "03-610", name: "Water Truck" },
  { section: "Equipment-Internal", code: "03-650", name: "Tile Scraper" },
  { section: "Equipment-Internal", code: "03-700", name: "SeaArk Boat" },
  { section: "Equipment-External", code: "04-000", name: "Equipment-External" },
  { section: "Equipment-External", code: "04-001", name: "Equipment-External Estimate" },
  { section: "Equipment-External", code: "04-101", name: "Backhoe/Excavator Class 1-200" },
  { section: "Equipment-External", code: "04-102", name: "Backhoe/Excavator Class2 W B/G" },
  { section: "Equipment-External", code: "04-103", name: "Backhoe/Excavator Class 3-300" },
  { section: "Equipment-External", code: "04-104", name: "Backhoe Class 3 Hoe Ram" },
  { section: "Equipment-External", code: "04-105", name: "Backhoe/ExcavatorC3 W/UP/Shear" },
  { section: "Equipment-External", code: "04-106", name: "Backhoe/Excavator Class 4-400" },
  { section: "Equipment-External", code: "04-107", name: "Backhoe/ExcavatorC4 W UP/Shear" },
  { section: "Equipment-External", code: "04-110", name: "Bobcat" },
  { section: "Equipment-External", code: "04-111", name: "Bobcat Class 1-Mini" },
  { section: "Equipment-External", code: "04-112", name: "Bobcat Class 2" },
  { section: "Equipment-External", code: "04-120", name: "Crane" },
  { section: "Equipment-External", code: "04-130", name: "Crane Hyd 10 Ton" },
  { section: "Equipment-External", code: "04-131", name: "Crane P&H" },
  { section: "Equipment-External", code: "04-132", name: "Crane Conv 50 Ton" },
  { section: "Equipment-External", code: "04-133", name: "Crane Conv 70 Ton" },
  { section: "Equipment-External", code: "04-140", name: "Job Trailer" },
  { section: "Equipment-External", code: "04-150", name: "Dump Truck (Single Axle)" },
  { section: "Equipment-External", code: "04-151", name: "Dump Truck (Tandem Axle)" },
  { section: "Equipment-External", code: "04-160", name: "Forklift" },
  { section: "Equipment-External", code: "04-170", name: "Manlift" },
  { section: "Equipment-External", code: "04-180", name: "Pickup Truck" },
  { section: "Equipment-External", code: "04-190", name: "Road Tractor" },
  { section: "Equipment-External", code: "04-200", name: "Air Compressor" },
  { section: "Equipment-External", code: "04-201", name: "Rubber Tire Loader C-920" },
  { section: "Equipment-External", code: "04-202", name: "Rubber Tire Loader C2-930" },
  { section: "Equipment-External", code: "04-210", name: "Fencing" },
  { section: "Equipment-External", code: "04-220", name: "Jack Hammers" },
  { section: "Equipment-External", code: "04-230", name: "Scaffolding" },
  { section: "Equipment-External", code: "04-240", name: "Welding" },
  { section: "Equipment-External", code: "04-250", name: "Excavator - EQ Rental" },
  { section: "Equipment-External", code: "04-260", name: "Cylinder Rental" },
  { section: "Equipment-External", code: "04-300", name: "Scrap Bailer" },
  { section: "Equipment-External", code: "04-400", name: "Track Loader" },
  { section: "Equipment-External", code: "04-500", name: "Others" },
  { section: "Equipment-External", code: "04-501", name: "Other EQ-Air Compressor" },
  { section: "Equipment-External", code: "04-505", name: "Other EQ-Cylinder" },
  { section: "Equipment-External", code: "04-560", name: "Other EQ-Welding" },
  { section: "Landfill", code: "05-000", name: "Landfill" },
  { section: "Landfill", code: "05-001", name: "Landfill Estimate" },
  { section: "Landfill", code: "05-100", name: "Landfill-Internal" },
  { section: "Landfill", code: "05-110", name: "Landfill-External" },
  { section: "Materials", code: "06-000", name: "Materials" },
  { section: "Materials", code: "06-001", name: "Materials Estimate" },
  { section: "Materials", code: "06-100", name: "Supplies" },
  { section: "Materials", code: "06-110", name: "Small Tools" },
  { section: "Materials", code: "06-115", name: "Backfill" },
  { section: "Materials", code: "06-120", name: "Warehouse Supplies-Internal" },
  { section: "Subcontracts", code: "07-000", name: "Subcontracts" },
  { section: "Subcontracts", code: "07-001", name: "Subcontract Estimate" },
  { section: "Subcontracts", code: "07-100", name: "DARI-Subcontract" },
  { section: "Subcontracts", code: "07-110", name: "DARI-Subcontract Labor" },
  { section: "Subcontracts", code: "07-115", name: "Other" },
  { section: "Per Diem", code: "08-000", name: "Per Diem" },
  { section: "Per Diem", code: "08-001", name: "Per Diem Estimate" },
  { section: "Per Diem", code: "08-100", name: "Per Diem" },
  { section: "Lodging/Travel", code: "09-000", name: "Lodging/Travel" },
  { section: "Lodging/Travel", code: "09-001", name: "Lodging/Travel Estimate" },
  { section: "Lodging/Travel", code: "09-100", name: "Airfare" },
  { section: "Lodging/Travel", code: "09-105", name: "Apartments" },
  { section: "Lodging/Travel", code: "09-120", name: "Fuel" },
  { section: "Lodging/Travel", code: "09-130", name: "Mileage" },
  { section: "Lodging/Travel", code: "09-135", name: "Motels" },
  { section: "Lodging/Travel", code: "09-150", name: "Rental Cars" },
  { section: "Lodging/Travel", code: "09-900", name: "Freight Charges" },
  { section: "Lodging/Travel", code: "09-990", name: "Freight Charges" },
  { section: "Bonds/Permits", code: "10-000", name: "Bonds/Permits" },
  { section: "Bonds/Permits", code: "10-001", name: "Bonds/Permits Estimate" },
  { section: "Bonds/Permits", code: "10-100", name: "Bonds" },
  { section: "Bonds/Permits", code: "10-105", name: "Permits" },
  { section: "Utilities", code: "11-000", name: "Utilities" },
  { section: "Utilities", code: "11-001", name: "Utilities Estimate" },
  { section: "Utilities", code: "11-110", name: "Electricity" },
  { section: "Utilities", code: "11-125", name: "Telephone" },
  { section: "Utilities", code: "11-140", name: "Water" },
  { section: "Other-Job Cost", code: "12-000", name: "Other-Job Cost" },
  { section: "Other-Job Cost", code: "12-001", name: "Other Estimate" },
  { section: "Other-Job Cost", code: "12-100", name: "Other Job Cost" },
  { section: "Other-Job Cost", code: "12-105", name: "Safety Monitoring" },
  { section: "Other-Job Cost", code: "12-110", name: "Industrial Hygienist" },
  { section: "Other-Job Cost", code: "12-120", name: "Overweight Tickets" },
  { section: "Other-Job Cost", code: "12-125", name: "Union Dues" },
  { section: "Overhead", code: "20-000", name: "Overhead" },
  { section: "Overhead", code: "20-001", name: "General Liability" },
  { section: "Overhead", code: "20-110", name: "Overhead Calculation" },
  { section: "Overhead", code: "20-120", name: "Hand Salvage" },
  { section: "Scrap Sales", code: "50-000", name: "Scrap Sales" },
  { section: "Scrap Sales", code: "50-001", name: "Scrap Sales Estimate" },
  { section: "Scrap Sales", code: "50-100", name: "Scrap Sales" },
  { section: "Estimate Adjustment", code: "99-000", name: "Estimate Adjustment" },
  { section: "Estimate Adjustment", code: "99-999", name: "Estimate Adjustment" },
];

const CODE_LOOKUP = new Map(COST_CODES.map((entry) => [entry.code, entry]));

export function costCodeByCode(code: string | null | undefined): CostCodeEntry | undefined {
  if (!code) return undefined;
  return CODE_LOOKUP.get(code);
}

/** null/undefined is always treated as valid — it means "needs review",
 * never a guess. Only a non-null value must match a known code. */
export function isKnownCostCode(code: string | null | undefined): boolean {
  if (code == null) return true;
  return CODE_LOOKUP.has(code);
}

/** A landfill/disposal cost code — any code in the "05" Landfill group
 * (05-000, 05-001, 05-100, 05-110, …). Used to decide whether the waste
 * C&D/Inert category applies to a ticket. Note "50-xxx" (Scrap Sales) is
 * deliberately NOT matched — it starts with "50", not "05". */
export function isLandfillCostCode(code: string | null | undefined): boolean {
  return typeof code === "string" && code.startsWith("05-");
}

export function formatCostCode(entry: CostCodeEntry | string | null | undefined): string {
  const resolved = typeof entry === "string" ? costCodeByCode(entry) : entry;
  if (!resolved) return "";
  return `${resolved.code} — ${resolved.name}`;
}

export type CostCodeSection = { section: string; codes: CostCodeEntry[] };

export function costCodesBySection(): CostCodeSection[] {
  const sections: CostCodeSection[] = [];
  const bySection = new Map<string, CostCodeEntry[]>();
  for (const entry of COST_CODES) {
    let codes = bySection.get(entry.section);
    if (!codes) {
      codes = [];
      bySection.set(entry.section, codes);
      sections.push({ section: entry.section, codes });
    }
    codes.push(entry);
  }
  return sections;
}

// ─── Conservative vendor/description auto-suggest ──────────────────────────
//
// Only ever fires on an unambiguous, well-known vendor/description match.
// Anything not covered here is left null ("needs review") rather than
// guessed — matching this codebase's classifyWasteCategory() convention.
// Keep this table small and obvious; add entries only for vendors that map
// to exactly one cost code with no reasonable ambiguity.
type SuggestionRule = { pattern: RegExp; code: string };

const VENDOR_RULES: SuggestionRule[] = [
  // Landfill / recycling disposal vendors -> Landfill-External
  { pattern: /metro\s+green/i, code: "05-110" },
  { pattern: /vulcan\s+materials/i, code: "05-110" },
  { pattern: /waste\s+management/i, code: "05-110" },
  { pattern: /willow\s+oak/i, code: "05-110" },
  { pattern: /sa\s+recycling/i, code: "05-110" },
  { pattern: /\bsims\b/i, code: "05-110" },
  // Hardware / auto-parts / small-tools suppliers -> Supplies
  { pattern: /home\s+depot/i, code: "06-100" },
  { pattern: /ace\s+hardware/i, code: "06-100" },
  { pattern: /o'?reilly/i, code: "06-100" },
  { pattern: /\bnapa\b/i, code: "06-100" },
  { pattern: /autozone/i, code: "06-100" },
  { pattern: /advance\s+auto/i, code: "06-100" },
  // Hotels/motels -> Motels
  { pattern: /comfort\s+inn/i, code: "09-135" },
];

const DESCRIPTION_RULES: SuggestionRule[] = [
  // Clearly-subcontractor invoices -> Subcontracts / Other
  { pattern: /subcontract/i, code: "07-115" },
];

/** Suggests a cost code from a ticket's vendor and/or description. Returns
 * null (never a guess) unless a rule confidently matches. This is only ever
 * a suggestion — the UI selector is always manually overridable. */
export function suggestCostCode(
  vendor: string | null | undefined,
  description?: string | null,
): string | null {
  const normalizedVendor = (vendor ?? "").replace(/\s+/g, " ").trim();
  const normalizedDescription = (description ?? "").replace(/\s+/g, " ").trim();

  if (normalizedVendor) {
    for (const rule of VENDOR_RULES) {
      if (rule.pattern.test(normalizedVendor)) return rule.code;
    }
  }

  for (const rule of DESCRIPTION_RULES) {
    if (normalizedVendor && rule.pattern.test(normalizedVendor)) return rule.code;
    if (normalizedDescription && rule.pattern.test(normalizedDescription)) return rule.code;
  }

  return null;
}
