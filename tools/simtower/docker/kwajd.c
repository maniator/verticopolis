/* Decompress a Microsoft KWAJ-compressed file (as shipped on the SimTower CD)
 * using libmspack. The retail disc stores simtower.exe et al. as KWAJ/LZH,
 * which Wine's `expand` does not handle; libmspack does.
 *
 *   kwajd INPUT OUTPUT
 */
#include <mspack.h>
#include <stdio.h>

int main(int argc, char **argv) {
    if (argc != 3) {
        fprintf(stderr, "usage: kwajd <input.KW_> <output>\n");
        return 2;
    }
    struct mskwaj_decompressor *k = mspack_create_kwaj_decompressor(NULL);
    if (!k) {
        fprintf(stderr, "kwajd: could not create decompressor\n");
        return 3;
    }
    int err = k->decompress(k, argv[1], argv[2]);
    int last = k->last_error(k);
    mspack_destroy_kwaj_decompressor(k);
    if (err != MSPACK_ERR_OK) {
        fprintf(stderr, "kwajd: decompress failed (err=%d last=%d)\n", err, last);
        return 1;
    }
    return 0;
}
