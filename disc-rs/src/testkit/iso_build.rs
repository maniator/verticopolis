//! A minimal ISO9660 image builder: a primary volume descriptor, a
//! terminator, then every directory and every file in allocation order.
//!
//! Layout (fixed so hostile tests can corrupt known offsets): sectors 0 to 15
//! are the empty system area, 16 is the primary volume descriptor, 17 the
//! terminator, the root directory starts at 18, other directories follow in
//! depth-first order, then the files' data.
use crate::iso::SECTOR;

const S: usize = SECTOR as usize;
pub const PVD_SECTOR: usize = 16;
pub const ROOT_SECTOR: usize = 18;

pub enum Node {
    File(String, Vec<u8>),
    Dir(String, Vec<Node>),
}

pub fn file(name: &str, data: &[u8]) -> Node {
    Node::File(name.to_string(), data.to_vec())
}

pub fn dir(name: &str, children: Vec<Node>) -> Node {
    Node::Dir(name.to_string(), children)
}

fn put_both32(rec: &mut [u8], at: usize, v: u32) {
    rec[at..at + 4].copy_from_slice(&v.to_le_bytes());
    rec[at + 4..at + 8].copy_from_slice(&v.to_be_bytes());
}

/// One directory record. `fi` is the raw identifier: `[0]` for ".", `[1]`
/// for "..", or a name such as `b"TOWER1.TDT;1"`.
pub fn dir_record(fi: &[u8], lba: u32, size: u32, is_dir: bool) -> Vec<u8> {
    let mut len = 33 + fi.len();
    if !len.is_multiple_of(2) {
        len += 1;
    }
    let mut rec = vec![0u8; len];
    rec[0] = len as u8;
    put_both32(&mut rec, 2, lba);
    put_both32(&mut rec, 10, size);
    rec[25] = if is_dir { 0x02 } else { 0x00 };
    rec[28] = 1; // volume sequence number, both-endian 16-bit
    rec[31] = 1;
    rec[32] = fi.len() as u8;
    rec[33..33 + fi.len()].copy_from_slice(fi);
    rec
}

struct Planned {
    lba: u32,
    size: u32,
}

/// Pack records into sectors; a record never straddles a sector boundary.
fn pack(records: &[Vec<u8>]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    for r in records {
        let used = out.len() % S;
        if used + r.len() > S {
            out.resize(out.len() + (S - used), 0);
        }
        out.extend_from_slice(r);
    }
    let pad = (S - out.len() % S) % S;
    out.resize(out.len() + pad, 0);
    if out.is_empty() {
        out.resize(S, 0);
    }
    out
}

fn record_count(children: &[Node]) -> Vec<usize> {
    // Record lengths for ".", "..", then each child, used to size a
    // directory before any address is known.
    let mut lens = vec![34, 34];
    for c in children {
        let name = match c {
            Node::File(n, _) => format!("{n};1"),
            Node::Dir(n, _) => n.clone(),
        };
        lens.push((33 + name.len() + 1) & !1);
    }
    lens
}

fn dir_sectors(children: &[Node]) -> u32 {
    let fake: Vec<Vec<u8>> = record_count(children)
        .into_iter()
        .map(|l| vec![1u8; l])
        .collect();
    (pack(&fake).len() / S) as u32
}

/// Build a complete image whose root holds `root`.
pub fn build(root: &[Node]) -> Vec<u8> {
    // Pass 1: give every directory its sectors, depth-first, then every file.
    let mut dirs: Vec<Planned> = Vec::new();
    let mut next = ROOT_SECTOR as u32;
    fn plan_dirs(children: &[Node], dirs: &mut Vec<Planned>, next: &mut u32) {
        let sectors = dir_sectors(children);
        dirs.push(Planned {
            lba: *next,
            size: sectors * S as u32,
        });
        *next += sectors;
        for c in children {
            if let Node::Dir(_, sub) = c {
                plan_dirs(sub, dirs, next);
            }
        }
    }
    plan_dirs(root, &mut dirs, &mut next);
    let mut files: Vec<Planned> = Vec::new();
    fn plan_files(children: &[Node], files: &mut Vec<Planned>, next: &mut u32) {
        for c in children {
            match c {
                Node::File(_, data) => {
                    files.push(Planned {
                        lba: *next,
                        size: data.len() as u32,
                    });
                    *next += (data.len() as u32).div_ceil(S as u32).max(1);
                }
                Node::Dir(_, sub) => plan_files(sub, files, next),
            }
        }
    }
    plan_files(root, &mut files, &mut next);

    let mut image = vec![0u8; next as usize * S];
    // Pass 2: write directories and files at their planned addresses.
    let mut di = 0;
    fn write(
        children: &[Node],
        parent: (u32, u32),
        image: &mut [u8],
        dirs: &[Planned],
        files: &[Planned],
        di: &mut usize,
        first_file: usize,
    ) {
        let me = (dirs[*di].lba, dirs[*di].size);
        *di += 1;
        // Children's addresses: directories in depth-first order, files in
        // order, matching the plan passes.
        let mut records = vec![
            dir_record(&[0], me.0, me.1, true),
            dir_record(&[1], parent.0, parent.1, true),
        ];
        let mut sub_dirs = Vec::new();
        let mut look_di = *di;
        let mut look_fi = first_file;
        fn count_dirs(children: &[Node]) -> usize {
            children
                .iter()
                .map(|c| match c {
                    Node::Dir(_, sub) => 1 + count_dirs(sub),
                    Node::File(..) => 0,
                })
                .sum()
        }
        fn count_files(children: &[Node]) -> usize {
            children
                .iter()
                .map(|c| match c {
                    Node::Dir(_, sub) => count_files(sub),
                    Node::File(..) => 1,
                })
                .sum()
        }
        for c in children {
            match c {
                Node::File(name, data) => {
                    let p = &files[look_fi];
                    records.push(dir_record(
                        format!("{name};1").as_bytes(),
                        p.lba,
                        p.size,
                        false,
                    ));
                    let at = p.lba as usize * S;
                    image[at..at + data.len()].copy_from_slice(data);
                    look_fi += 1;
                }
                Node::Dir(name, sub) => {
                    let p = &dirs[look_di];
                    records.push(dir_record(name.as_bytes(), p.lba, p.size, true));
                    sub_dirs.push((sub, look_fi));
                    look_di += 1 + count_dirs(sub);
                    look_fi += count_files(sub);
                }
            }
        }
        let packed = pack(&records);
        let at = me.0 as usize * S;
        image[at..at + packed.len()].copy_from_slice(&packed);
        for (sub, sub_first_file) in sub_dirs {
            write(sub, me, image, dirs, files, di, sub_first_file);
        }
    }
    let root_addr = (dirs[0].lba, dirs[0].size);
    write(root, root_addr, &mut image, &dirs, &files, &mut di, 0);

    // The primary volume descriptor and the terminator.
    let pvd = PVD_SECTOR * S;
    image[pvd] = 0x01;
    image[pvd + 1..pvd + 6].copy_from_slice(b"CD001");
    image[pvd + 6] = 0x01;
    // Logical block size, both-endian 16-bit.
    image[pvd + 128..pvd + 130].copy_from_slice(&(S as u16).to_le_bytes());
    image[pvd + 130..pvd + 132].copy_from_slice(&(S as u16).to_be_bytes());
    let root_rec = dir_record(&[0], root_addr.0, root_addr.1, true);
    image[pvd + 156..pvd + 156 + root_rec.len()].copy_from_slice(&root_rec);
    let term = (PVD_SECTOR + 1) * S;
    image[term] = 0xff;
    image[term + 1..term + 6].copy_from_slice(b"CD001");
    image[term + 6] = 0x01;
    image
}
