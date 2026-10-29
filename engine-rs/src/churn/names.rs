//! Names for the companies, gyms and clinics that take a lease.

use crate::sim::Simulation;

impl Simulation {
    pub fn company_name(&mut self) -> String {
        const A: [&str; 10] = [
            "Apex", "Nimbus", "Vertex", "Cobalt", "Atlas", "Orion", "Pioneer", "Summit", "Delta",
            "Vista",
        ];
        const B: [&str; 8] = [
            "Holdings",
            "Systems",
            "Partners",
            "Industries",
            "Group",
            "Labs",
            "Trading",
            "Capital",
        ];
        let a = *self.rng.pick(&A);
        let b = *self.rng.pick(&B);
        format!("{a} {b}")
    }

    pub fn gym_name(&mut self) -> String {
        const A: [&str; 10] = [
            "Ironworks",
            "Summit",
            "Pulse",
            "Apex",
            "Vertex",
            "Kinetic",
            "Anvil",
            "Ascend",
            "Cobalt",
            "Momentum",
        ];
        const B: [&str; 6] = [
            "Fitness",
            "Athletic Club",
            "Gym",
            "Strength",
            "Studio",
            "Wellness",
        ];
        let a = *self.rng.pick(&A);
        let b = *self.rng.pick(&B);
        format!("{a} {b}")
    }

    pub fn clinic_name(&mut self) -> String {
        const A: [&str; 10] = [
            "Cedar",
            "Riverside",
            "Parkview",
            "Meridian",
            "Grove",
            "Harbor",
            "Summit",
            "Bayside",
            "Elm",
            "Crestview",
        ];
        const B: [&str; 6] = [
            "Clinic",
            "Health",
            "Medical",
            "Care",
            "Wellness Center",
            "Practice",
        ];
        let a = *self.rng.pick(&A);
        let b = *self.rng.pick(&B);
        format!("{a} {b}")
    }
}
