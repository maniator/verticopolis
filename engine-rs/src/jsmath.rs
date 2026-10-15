//! JavaScript number semantics the engine relies on. Rust's `f64` arithmetic
//! matches a JS double for `+ - * /` and `sqrt`; the helpers here cover the
//! places where the two standard libraries differ.

/// `Math.round`: rounds half toward positive infinity (`floor(x + 0.5)`,
/// with the spec's care for values just below a half).
pub fn round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let f = x.floor();
    if x - f < 0.5 {
        f
    } else {
        f + 1.0
    }
}

/// `Math.sign` for finite inputs.
pub fn sign(x: f64) -> f64 {
    if x > 0.0 {
        1.0
    } else if x < 0.0 {
        -1.0
    } else {
        x
    }
}

/// `Number.prototype.toString()` for a finite double: the shortest digits
/// that round-trip, laid out by ECMA-262 Number::toString (section 6.1.6.1.20).
pub fn number_to_string(x: f64) -> String {
    if x == 0.0 {
        return "0".to_string();
    }
    let mut buf = ryu::Buffer::new();
    let s = buf.format_finite(x);
    let (neg, s) = match s.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, s),
    };
    // ryu writes either "d.ddd", "d.ddde±x" or "ddd.0"; pull out the digit
    // string and the decimal exponent `n` such that value = 0.digits * 10^n.
    let (mantissa, exp) = match s.split_once('e') {
        Some((m, e)) => (m, e.parse::<i32>().unwrap()),
        None => (s, 0),
    };
    let (int_part, frac_part) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    let mut digits = String::with_capacity(int_part.len() + frac_part.len());
    digits.push_str(int_part);
    digits.push_str(frac_part);
    // n: position of the decimal point relative to the start of `digits`.
    let mut n = int_part.len() as i32 + exp;
    // Strip leading zeros (ryu never emits them except for "0.xxx", which it
    // avoids, but be safe) and trailing zeros.
    let trimmed_front = digits.trim_start_matches('0');
    n -= (digits.len() - trimmed_front.len()) as i32;
    let digits: String = trimmed_front.trim_end_matches('0').to_string();
    let k = digits.len() as i32;
    let mut out = String::new();
    if neg {
        out.push('-');
    }
    if k <= n && n <= 21 {
        out.push_str(&digits);
        for _ in 0..(n - k) {
            out.push('0');
        }
    } else if 0 < n && n <= 21 {
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        for _ in 0..(-n) {
            out.push('0');
        }
        out.push_str(&digits);
    } else {
        let e = n - 1;
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        out.push('e');
        out.push(if e < 0 { '-' } else { '+' });
        out.push_str(&e.abs().to_string());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_matches_node() {
        let cases = [
            0.5,
            1.5,
            2.5,
            -0.5,
            -1.5,
            -2.5,
            2.4999999999999996,
            -0.49999999999999994,
        ];
        let got: Vec<String> = cases.iter().map(|&x| number_to_string(round(x))).collect();
        assert_eq!(got.join(","), "1,2,3,0,-1,-2,2,0");
    }

    #[test]
    fn number_to_string_matches_node() {
        let cases = [
            0.0,
            -0.0,
            0.1,
            1e21,
            1e-7,
            123456789.125,
            5.0,
            1e20,
            0.000001,
            1.7976931348623157e308,
            5e-324,
            1.5e-7,
            123e-20,
            0.30000000000000004,
            1.0 / 3.0,
            -1e21,
            100.0,
            1e6,
            1e-6,
            0.1 + 0.7,
        ];
        let got: Vec<String> = cases.iter().map(|&x| number_to_string(x)).collect();
        assert_eq!(
            got.join(" "),
            "0 0 0.1 1e+21 1e-7 123456789.125 5 100000000000000000000 0.000001 1.7976931348623157e+308 5e-324 1.5e-7 1.23e-18 0.30000000000000004 0.3333333333333333 -1e+21 100 1000000 0.000001 0.7999999999999999"
        );
    }
}
