import type { FacilityKind } from "../engine/types";

/**
 * How each facility looks and reads in the UI: its swatch and sprite color and
 * the tool card's description. Presentation only, so it lives outside the
 * engine (#921): prices, sizes and rules come from the tower's catalog.
 */
export interface FacilityPresentation {
  /** Hex color the palette swatch and the procedural sprites use. */
  readonly color: string;
  /** The tool card's one-paragraph description. */
  readonly description: string;
}

export const FACILITY_PRESENTATION: Readonly<Record<FacilityKind, FacilityPresentation>> = {
  lobby: {
    color: "#d8d2b0",
    description: "Ground-floor and sky lobbies. People pass through to reach elevators. Build every 15 floors.",
  },
  floor: {
    color: "#9a9486",
    description: "Structural floor space. Must exist before placing rooms.",
  },
  office: {
    color: "#6fb1d6",
    description: "Rents to a company. Workers arrive mornings, leave evenings. Pays quarterly rent.",
  },
  condo: {
    color: "#7ec97e",
    description: "Sold once to a resident family for a large lump sum. Residents live here permanently.",
  },
  hotelSingle: {
    color: "#e0b15e",
    description: "Hotel single. Guests check in at night, out in the morning. Needs housekeeping.",
  },
  hotelDouble: {
    color: "#e0a94e",
    description: "Hotel double room. Higher nightly income than a single.",
  },
  hotelSuite: {
    color: "#d99a2e",
    description: "Luxury hotel suite. Best nightly income, demanding guests.",
  },
  fastFood: {
    color: "#e87b6e",
    description: "Quick dining. Busy at lunch. Income scales with foot traffic.",
  },
  restaurant: {
    color: "#d4564a",
    description: "Fine dining, busy at lunch and dinner. Needs good elevator access.",
  },
  foodHall: {
    color: "#e0965a",
    description: "Modern: a hall of food stalls. Earns from foot traffic and satisfies many cravings from one spot, so it covers a wide reach of hungry tenants.",
  },
  shop: {
    color: "#b58ad6",
    description: "Retail. Earns from shoppers passing by. Thrives near lobbies and offices.",
  },
  cinema: {
    color: "#8a6fd6",
    description: "A two-story movie theater. Draws large evening crowds; demands heavy transport capacity.",
  },
  partyHall: {
    color: "#cf7fb0",
    description: "A two-story rentable function space for events. Guests enter on the lower floor. Periodic income.",
  },
  amusements: {
    color: "#d24a9c",
    description: "Modern: an arcade and amusements hall (classic cabinets, VR, claw machines, mini-golf). Draws teens and families for games and earns from foot traffic, and is busier on weekends.",
  },
  boutiqueBay: {
    color: "#3aa88c",
    description: "Modern: a bay of small independent trades (florist, barber, phone repair, vintage, tattoo, record store, gallery). Earns from foot traffic and offers the widest variety of any single build, busier on weekends.",
  },
  fitnessClub: {
    color: "#4a86c8",
    description: "Modern: a members' gym (weight floor, yoga, spin, boxing, climbing). Pays a membership lease like an office, and nearby condos are happier for having it close (a capped bonus that fades with distance).",
  },
  clinic: {
    color: "#5ab0c8",
    description: "Modern: a small health clinic (dental, urgent care, optometry, pharmacy, physio). Pays a lease like an office: a quiet, steady tenant.",
  },
  nightclub: {
    color: "#a24ad0",
    description: "Modern: a nightclub that fills after dark, earning when the office crowd is gone. Pays a monthly DJ booking, and its noise makes nearby homes unhappy: keep it away from condos.",
  },
  spa: {
    color: "#5cc0a0",
    description: "Modern: a wellness spa (massage, sauna, hot tubs). Earns from foot traffic, busier on weekends, and hotel rooms on nearby floors rest better for it (a capped bonus that fades with distance).",
  },
  skyBar: {
    color: "#d89050",
    description: "Modern: a rooftop cocktail bar that fills in the evening. Earns from foot traffic, and the higher you place it the more it earns: the skyline view is the draw, so a bar up top pours far more than one down low.",
  },
  aquaticCenter: {
    color: "#33b0c2",
    description: "Modern: a two-story swimming pool complex. Like a cinema it earns from the crowd that comes to swim and lounge, filling with real visitors through the day, so it needs the transport to move them.",
  },
  daycare: {
    color: "#eeb63c",
    description: "Modern: a children's daycare. Earns from parents dropping off and collecting kids, busiest on weekdays when they are at work, and condos on nearby floors are happier for it, most of all the biggest families who lean on childcare the most (a bonus that grows with family size and fades over the next few floors).",
  },
  stairs: {
    color: "#b0a890",
    description: "Cheap two-floor link: one tap places the whole flight. People will only climb a short distance.",
  },
  escalator: {
    color: "#c8c0a0",
    description: "Moves crowds between adjacent floors. Great for lobbies, shops and food courts.",
  },
  elevatorStandard: {
    color: "#5a5a6a",
    description: "Serves up to 30 floors with several cars. The backbone of any tower.",
  },
  elevatorService: {
    color: "#4a4a52",
    description: "Staff-only: housekeepers ride it to reach hotel floors; tenants and visitors never do. Cheap way to link service floors.",
  },
  elevatorExpress: {
    color: "#3a3a8a",
    description: "Stops only at lobbies and sky lobbies. Essential for very tall towers.",
  },
  parkingRamp: {
    color: "#6a6a6a",
    description: "Basement car-ramp. Parking spaces must chain to a ramp to be usable.",
  },
  parking: {
    color: "#888888",
    description: "Basement parking. Must connect to a Parking Ramp. One space serves ~24 office workers (one per four offices), and every hotel suite needs a space of its own (VIPs drive).",
  },
  security: {
    color: "#4f6f9f",
    description: "Security office. Reduces crime/terrorist events and improves evaluation.",
  },
  medical: {
    color: "#e0e0e8",
    description: "Handles illness and emergencies. Required for high ratings in large towers.",
  },
  housekeeping: {
    color: "#c0d0c0",
    description: "Fields 6 maids who clean hotel rooms through the day shift so they can be rented again. Maids reach rooms by service elevator or stairs (never passenger elevators or escalators), so how many rooms they finish depends on placement and staff transport.",
  },
  recycling: {
    color: "#7f9f5f",
    description: "Basement facility that fills with the tower's daily waste: one center processes ~2,500 population; build more as you grow. A garbage truck collects each morning. 4★ requires demand met.",
  },
  metro: {
    color: "#9f7f5f",
    description: "A whole-floor deep-basement subway station. Brings huge numbers of visitors to your tower.",
  },
  weddingHall: {
    color: "#f3ecdc",
    description: "A grand wedding & events hall atop a 5-star tower (floor 100). Triggers the final TOWER evaluation.",
  },
  rentalStudio: {
    color: "#86c5a8",
    description: "Modern: a small rented studio. Pays monthly rent you set; the easygoing tenant stays unless the tower gets truly bad. Modern only.",
  },
  rentalApartment: {
    color: "#a8c06a",
    description: "Modern: a rented apartment for a small household. Higher monthly rent you set, but noise, a bad commute, or over-high rent drives the tenant out. Modern only.",
  },
};

/** The color a facility kind is drawn in. */
export function facilityColor(kind: FacilityKind): string {
  return FACILITY_PRESENTATION[kind].color;
}

/** The description the tool card shows for a facility kind. */
export function facilityDescription(kind: FacilityKind): string {
  return FACILITY_PRESENTATION[kind].description;
}

