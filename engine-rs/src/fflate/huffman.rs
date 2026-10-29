//! Huffman trees: the node lengths, the tree builder and the length-code packer.

struct Node {
    s: i32,
    f: u32,
    l: usize,
    r: usize,
}

/// `ln`: depth of every leaf under `n`, and the deepest.
fn ln(nodes: &[Node], n: usize, tr: &mut [u16], d: u32) -> u32 {
    let node = &nodes[n];
    if node.s == -1 {
        let (l, r) = (node.l, node.r);
        ln(nodes, l, tr, d + 1).max(ln(nodes, r, tr, d + 1))
    } else {
        tr[node.s as usize] = d as u16;
        d
    }
}

/// `hTree(d, mb)`: code lengths from frequencies, at most `mb` bits.
pub(super) fn h_tree(d: &[u16], mb: u32) -> (Vec<u8>, u32) {
    let mut nodes: Vec<Node> = Vec::new();
    let mut t: Vec<usize> = Vec::new();
    for (i, &f) in d.iter().enumerate() {
        if f != 0 {
            nodes.push(Node {
                s: i as i32,
                f: f as u32,
                l: 0,
                r: 0,
            });
            t.push(nodes.len() - 1);
        }
    }
    let s = t.len();
    let mut t2 = t.clone();
    if s == 0 {
        return (Vec::new(), 0);
    }
    if s == 1 {
        let sym = nodes[t[0]].s as usize;
        let mut v = vec![0u8; sym + 1];
        v[sym] = 1;
        return (v, 1);
    }
    // Array.prototype.sort is stable, as is sort_by.
    t.sort_by(|&a, &b| nodes[a].f.cmp(&nodes[b].f));
    nodes.push(Node {
        s: -1,
        f: 25001,
        l: 0,
        r: 0,
    });
    t.push(nodes.len() - 1);
    let (mut i0, mut i1, mut i2) = (0usize, 1usize, 2usize);
    let (l, r) = (t[0], t[1]);
    nodes.push(Node {
        s: -1,
        f: nodes[l].f + nodes[r].f,
        l,
        r,
    });
    t[0] = nodes.len() - 1;
    while i1 != s - 1 {
        let pick = if nodes[t[i0]].f < nodes[t[i2]].f {
            i0 += 1;
            i0 - 1
        } else {
            i2 += 1;
            i2 - 1
        };
        let l = t[pick];
        let pick = if i0 != i1 && nodes[t[i0]].f < nodes[t[i2]].f {
            i0 += 1;
            i0 - 1
        } else {
            i2 += 1;
            i2 - 1
        };
        let r = t[pick];
        nodes.push(Node {
            s: -1,
            f: nodes[l].f + nodes[r].f,
            l,
            r,
        });
        t[i1] = nodes.len() - 1;
        i1 += 1;
    }
    let max_sym = t2.iter().map(|&n| nodes[n].s).max().unwrap_or(0) as usize;
    let mut tr = vec![0u16; max_sym + 1];
    let mut mbt = ln(&nodes, t[i1 - 1], &mut tr, 0);
    if mbt > mb {
        let mut i = 0usize;
        let mut dt: i32 = 0;
        let lft = mbt - mb;
        let cst = 1i32.wrapping_shl(lft);
        t2.sort_by(|&a, &b| {
            let (sa, sb) = (nodes[a].s as usize, nodes[b].s as usize);
            tr[sb].cmp(&tr[sa]).then(nodes[a].f.cmp(&nodes[b].f))
        });
        while i < s {
            let sym = nodes[t2[i]].s as usize;
            if tr[sym] as u32 > mb {
                dt += cst - 1i32.wrapping_shl(mbt - tr[sym] as u32);
                tr[sym] = mb as u16;
            } else {
                break;
            }
            i += 1;
        }
        dt = dt.wrapping_shr(lft);
        while dt > 0 {
            let sym = nodes[t2[i]].s as usize;
            if (tr[sym] as u32) < mb {
                dt -= 1i32.wrapping_shl(mb - tr[sym] as u32 - 1);
                tr[sym] += 1;
            } else {
                i += 1;
            }
        }
        let mut j = i as isize;
        while j >= 0 && dt != 0 {
            let sym = nodes[t2[j as usize]].s as usize;
            if tr[sym] as u32 == mb {
                tr[sym] -= 1;
                dt += 1;
            }
            j -= 1;
        }
        mbt = mb;
    }
    (tr.iter().map(|&x| x as u8).collect(), mbt)
}

/// `lc(c)`: the code length codes for a tree, and how many lengths it sends.
pub(super) fn lc(c: &[u8]) -> (Vec<u16>, usize) {
    let mut s = c.len();
    while s != 0 {
        s -= 1;
        if c[s] != 0 {
            break;
        }
    }
    s += 1;
    let mut cl: Vec<u16> = Vec::with_capacity(s);
    let mut cln = c.first().copied().unwrap_or(0);
    let mut cls: i32 = 1;
    for i in 1..=s {
        if i != s && c[i] == cln {
            cls += 1;
        } else {
            if cln == 0 && cls > 2 {
                while cls > 138 {
                    cl.push(32754);
                    cls -= 138;
                }
                if cls > 2 {
                    cl.push(if cls > 10 {
                        (((cls - 11) << 5) | 28690) as u16
                    } else {
                        (((cls - 3) << 5) | 12305) as u16
                    });
                    cls = 0;
                }
            } else if cls > 3 {
                cl.push(cln as u16);
                cls -= 1;
                while cls > 6 {
                    cl.push(8304);
                    cls -= 6;
                }
                if cls > 2 {
                    cl.push((((cls - 3) << 5) | 8208) as u16);
                    cls = 0;
                }
            }
            while cls > 0 {
                cls -= 1;
                cl.push(cln as u16);
            }
            cls = 1;
            cln = c.get(i).copied().unwrap_or(0);
        }
    }
    (cl, s)
}

/// `clen(cf, cl)`: bits to send `cf` with lengths `cl`.
pub(super) fn clen(cf: &[u16], cl: &[u8]) -> i64 {
    cl.iter().zip(cf).map(|(&l, &f)| l as i64 * f as i64).sum()
}
