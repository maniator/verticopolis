---
app: minor
crate: minor
---
## Player
- Exported `.vctower` files are now binary and about a quarter smaller. They open in this version and newer; an older version says the file was made by a newer version. Older `.vctower` files still open.
## Engine
- The binary `.vctower` file: the line `VCTOWER2`, a newline, then the raw deflate bytes of the same stamped save (`TOWER_FILE_MAGIC_BINARY`). `load::encode_simulation_vctower_binary` and the binding's `exportVctowerBytes(appVersion, savedAtMs)` write one.
- `load::decode_vctower_bytes`, `Engine.fromVctowerBytes(bytes, mode?)` and the port's `loadVctowerBytes(bytes)` read a file's bytes of either kind. The text readers refuse a `VCTOWER2` file as damaged, since decoding one as text changes its bytes, and a later version (`VCTOWER3`, or a number that starts with 2 such as `VCTOWER21`) still asks for an update.
- View layout version 25: the port's `loadVctowerBytes` entry moves the exported layout pin.
