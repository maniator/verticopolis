/**
 * Canon look table for the retail trades, split out of `shop.ts` so the interior
 * draw code has room to grow under the 500-line ceiling without touching this
 * data. Re-exported through `shop.ts` and the `pixelSprites.ts` barrel, so
 * `subtypeVisuals` and every importer keep resolving `SHOP_LOOKS` from there.
 * Values are byte-identical to their former home in `shop.ts`; an undefined
 * subtype still falls back to the legacy generic shop.
 */

export interface ShopLook {
  awning: string;
  wall: string;
  goods: string[];
  /** Full interior composition per trade: racks, cages, bookcases, a teller
   *  counter... The striped awning above is the one shape every shop keeps. */
  interior:
    | "racks"
    | "pets"
    | "florist"
    | "books"
    | "pharmacy"
    | "boutique"
    | "screens"
    | "bank"
    | "salon"
    | "post"
    | "sports";
}
export const SHOP_LOOKS: Record<string, ShopLook> = {
  "Men's Clothing": { awning: "#5A6E8C", wall: "#ECEEF2", goods: ["#3E4654", "#5A6E8C", "#6E5A4A", "#F4F0E4"], interior: "racks" },
  "Pet Store": { awning: "#8C6E50", wall: "#F0EEE2", goods: ["#C99A6E", "#E8C14A", "#5AA85A", "#F4F0E4"], interior: "pets" },
  "Flower Shop": { awning: "#E88AB0", wall: "#F2F5EC", goods: ["#e85d5d", "#E88AB0", "#e8c14a", "#F4F0E4"], interior: "florist" },
  "Book Store": { awning: "#3E4654", wall: "#F0EAD8", goods: ["#8C3A32", "#3E5A8C", "#4A7A4A", "#B08A3E", "#5A4A6E"], interior: "books" },
  "Drug Store": { awning: "#3A8A4A", wall: "#F4F7F2", goods: ["#FFFFFF", "#9FD0C8", "#5db4e8", "#E8E4D0"], interior: "pharmacy" },
  "Boutique": { awning: "#9A5FB0", wall: "#F5EFF7", goods: ["#E8B8CC", "#C8A8E0", "#F0E0B8", "#F4F0E4"], interior: "boutique" },
  "Electronics": { awning: "#2A2E38", wall: "#3E4654", goods: ["#4FA0C8", "#8FB6FF", "#5db4e8", "#2A2E38"], interior: "screens" },
  "Bank": { awning: "#D8B05A", wall: "#EDE9E2", goods: ["#D8B05A", "#B89040", "#EDE9E2"], interior: "bank" },
  "Hair Salon": { awning: "#B84848", wall: "#F2ECF0", goods: ["#8FB6D8", "#C8DCE8", "#F4F0E4"], interior: "salon" },
  "Post Office": { awning: "#4F6EC8", wall: "#EFEDE4", goods: ["#F4F0E4", "#E0CFA8", "#FFFFFF", "#C8B890"], interior: "post" },
  "Sports Gear": { awning: "#E88F4A", wall: "#EEF2F0", goods: ["#e85d5d", "#5db4e8", "#6bd47a", "#e8c14a"], interior: "sports" },
};
