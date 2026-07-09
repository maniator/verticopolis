#!/usr/bin/env python3
"""Independent .TDT validator, written straight from docs/canon/tdt-format.md.

Deliberately does NOT import the engine's own tdtImport code: if our exporter
and importer share a wrong assumption, a self-round-trip would still pass. This
reads the bytes by the spec's offsets so it can catch that class of bug.

Usage: python3 verify-tdt.py <file.TDT> [key=val ...]
       each key=val asserts that a parsed header field equals the value.
"""
import struct
import sys

TDT_FLOOR_OFFSET = 9          # ours = tdt - 9  (canon §4)
FLOOR_MAP_START = 560         # 0x230
FLOOR_SLOTS = 120
UNIT_REC = 18
REMAP_BYTES = 188

# canon §5 type IDs -> label
TYPE = {0:"floor",3:"hotelSingle",4:"hotelDouble",5:"hotelSuite",6:"restaurant",
        7:"office",9:"condo",10:"shop",11:"parking",12:"fastFood",13:"medical",
        14:"security",15:"housekeeping",17:"secom",18:"theatreT",19:"theatreB",
        20:"recyclingT",21:"recyclingB",24:"lobby",29:"partyHallT",30:"partyHallB",
        31:"metroT",32:"metroM",33:"metroB",34:"screenT",35:"screenB",
        36:"cath",37:"cath",38:"cath",39:"cath",40:"cath",42:"struct",
        44:"parkingRamp",45:"metroTunnel",48:"burned"}

def u16(b,o): return struct.unpack_from("<H",b,o)[0]
def i32(b,o): return struct.unpack_from("<i",b,o)[0]

def parse(path):
    with open(path,"rb") as fh:
        b = fh.read()
    h = {}
    h["size"] = len(b)
    h["magic"] = u16(b,0x00)
    h["level"] = u16(b,0x02)
    h["balance"] = i32(b,0x04)
    h["otherIncome"] = i32(b,0x08)
    h["constructionCosts"] = i32(b,0x0C)
    h["lastQuarterMoney"] = i32(b,0x10)
    h["tick"] = u16(b,0x14)
    h["currentDay"] = i32(b,0x16)
    h["lobbyHeight"] = u16(b,0x1C)
    h["recyclingCount"] = u16(b,0x2A)
    h["commercialCount"] = u16(b,0x2E)
    h["securityCount"] = u16(b,0x30)
    h["parkingStallCount"] = u16(b,0x32)
    h["hallCinemaCount"] = u16(b,0x36)
    h["namedUnits"] = u16(b,0x38)
    h["namedPeople"] = u16(b,0x3A)

    # Walk the floor map (variable width; walk, don't seek, per canon §4).
    off = FLOOR_MAP_START
    type_tally = {}
    floors_with_units = 0
    total_units = 0
    walk_ok = True
    detail = []
    for idx in range(FLOOR_SLOTS):
        if off + 6 > len(b):
            walk_ok = False; detail.append(f"floor idx {idx}: ran past EOF"); break
        count = u16(b,off); left = u16(b,off+2); right = u16(b,off+4)
        off += 6
        if count: floors_with_units += 1
        truncated = False
        for _ in range(count):
            if off + UNIT_REC > len(b):
                walk_ok = False; detail.append(f"floor idx {idx}: unit past EOF"); truncated = True; break
            uleft = u16(b,off); uright = u16(b,off+2)
            t = struct.unpack_from("<b",b,off+4)[0]   # signed: neg = under construction
            base = abs(t)
            type_tally[base] = type_tally.get(base,0)+1
            total_units += 1
            off += UNIT_REC
        if truncated:
            break  # stop walking; the map is cut short, don't advance off past EOF
        off += REMAP_BYTES
    h["_floor_map_end"] = off
    h["_floors_with_units"] = floors_with_units
    h["_total_units"] = total_units
    h["_walk_ok"] = walk_ok
    h["_type_tally"] = type_tally
    h["_walk_detail"] = detail
    return h

def main():
    if len(sys.argv) < 2:
        print("usage: python3 verify-tdt.py <file.TDT> [key=value ...]", file=sys.stderr)
        print("  key=value pairs assert a parsed header field equals the value", file=sys.stderr)
        sys.exit(2)
    path = sys.argv[1]
    expects = dict(a.split("=",1) for a in sys.argv[2:] if "=" in a)
    # Truncated / non-.TDT input would otherwise surface as a raw struct.error
    # traceback; this validator is a quick harness check, so report it cleanly.
    try:
        h = parse(path)
    except FileNotFoundError:
        print(f"error: no such file: {path}", file=sys.stderr)
        sys.exit(2)
    except struct.error:
        print(f"error: {path} is too short or corrupt to be a .TDT save "
              "(a field ran past the end of the file).", file=sys.stderr)
        sys.exit(1)
    print(f"== {path} ({h['size']:,} bytes) ==")
    ok = True
    def check(name, got, want=None):
        nonlocal ok
        if want is None:
            print(f"  {name:<20} = {got}")
        else:
            good = str(got) == str(want)
            ok = ok and good
            print(f"  {name:<20} = {got:<12} expect {want:<12} {'OK' if good else 'MISMATCH'}")

    check("magic (hex)", hex(h["magic"]), "0x2400")
    check("level/star", h["level"], expects.get("level"))
    check("balance", h["balance"], expects.get("balance"))
    check("balance x100", h["balance"]*100, expects.get("display"))
    check("tick", h["tick"])
    check("currentDay", h["currentDay"])
    check("lobbyHeight", h["lobbyHeight"])
    check("recyclingCount", h["recyclingCount"], expects.get("recycling"))
    check("commercialCount", h["commercialCount"], expects.get("commercial"))
    check("securityCount", h["securityCount"], expects.get("security"))
    check("parkingStallCount", h["parkingStallCount"], expects.get("parking"))
    check("hallCinemaCount", h["hallCinemaCount"], expects.get("hallcine"))
    check("namedUnits", h["namedUnits"])
    check("namedPeople", h["namedPeople"])
    print(f"  floor-map walk       = {'CLEAN' if h['_walk_ok'] else 'BROKE: '+';'.join(h['_walk_detail'])}")
    print(f"  floors with units    = {h['_floors_with_units']}")
    print(f"  total units in map   = {h['_total_units']}")
    # Sum by label: several type IDs share a label (e.g. 36-40 are all "cath"),
    # so a plain dict comprehension would drop all but the last.
    tal = {}
    for k, v in sorted(h["_type_tally"].items()):
        lbl = TYPE.get(k, f'id{k}')
        tal[lbl] = tal.get(lbl, 0) + v
    print(f"  unit types in map    = {tal}")
    print(f"  floor-map ends at    = {h['_floor_map_end']} (0x{h['_floor_map_end']:x}); {h['size']-h['_floor_map_end']} bytes of trailing structures")
    print("RESULT:", "ALL CHECKS OK" if ok else "MISMATCHES ABOVE")
    return 0 if ok else 1

if __name__ == "__main__":
    sys.exit(main())
