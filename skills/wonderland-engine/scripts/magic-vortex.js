import { Component, MeshComponent, Property } from "@wonderlandengine/api";

/**
 * Swirling magic vortex: particles orbit the object on several tilted,
 * counter-rotating rings, spiral upwards and inwards, and pulse in size.
 * All motion is in the object's local space, so the vortex follows it
 * (e.g. the tip of an animated staff).
 */
export class MagicVortex extends Component {
    static TypeName = "magic-vortex";
    static Properties = {
        mesh: Property.mesh(),
        material: Property.material(),
        /** Particles per ring */
        count: Property.int(16),
        /** Number of rings, alternating direction */
        rings: Property.int(2),
        /** Ring radius at the start of a particle's life (m) */
        radius: Property.float(0.18),
        /** Revolutions per second at the start of a particle's life */
        speed: Property.float(0.8),
        /** Height a particle rises during its life (m) */
        height: Property.float(0.35),
        /** Lifetime of one particle (s) */
        life: Property.float(1.6),
        /** Particle size (m) */
        size: Property.float(0.022),
        /** Ring tilt (degrees) */
        tilt: Property.float(25),
    };

    start() {
        this.particles = [];
        const rings = Math.max(1, this.rings);
        for (let r = 0; r < rings; ++r) {
            const dir = r % 2 === 0 ? 1 : -1;
            const tilt = ((this.tilt * Math.PI) / 180) * (r % 2 === 0 ? 1 : -1);
            for (let i = 0; i < this.count; ++i) {
                const o = this.engine.scene.addObject(this.object);
                const m = o.addComponent(MeshComponent);
                m.mesh = this.mesh;
                m.material = this.material;
                this.particles.push({
                    o,
                    dir,
                    tilt,
                    /* Spread phases and ages so the vortex looks continuous */
                    phase: (i / this.count) * Math.PI * 2 + r,
                    age: (i / this.count) * this.life,
                    jitter: 0.85 + Math.random() * 0.3,
                });
            }
        }
        this.time = 0;
    }

    update(dt) {
        this.time += dt;
        const pos = [0, 0, 0];
        for (const p of this.particles) {
            p.age += dt;
            if (p.age > this.life) {
                p.age -= this.life;
                p.jitter = 0.85 + Math.random() * 0.3;
            }
            const t = p.age / this.life;
            /* Spiral: angle accelerates, radius contracts then breathes */
            const angle =
                p.phase + p.dir * this.speed * Math.PI * 2 * (p.age + 0.6 * t * t);
            const breathe = 1 + 0.25 * Math.sin(this.time * 2.3 + p.phase);
            const radius = this.radius * (1 - 0.6 * t) * breathe * p.jitter;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            const y = t * this.height;
            /* Tilt the ring around the local X axis */
            pos[0] = x;
            pos[1] = y * Math.cos(p.tilt) - z * Math.sin(p.tilt);
            pos[2] = y * Math.sin(p.tilt) + z * Math.cos(p.tilt);
            p.o.setPositionLocal(pos);
            /* Grow in, pulse, shrink out */
            const fade = Math.sin(Math.PI * t);
            const pulse = 0.75 + 0.25 * Math.sin(this.time * 9 + p.phase * 3);
            const s = this.size * fade * pulse;
            p.o.setScalingLocal([s, s, s]);
        }
    }
}
