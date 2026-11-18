import {Component, MeshComponent, Property} from '@wonderlandengine/api';

/**
 * Small pool of emissive mesh "embers" that rise from the object, shrink and respawn.
 */
export class TorchFlame extends Component {
    static TypeName = 'torch-flame';
    static Properties = {
        mesh: Property.mesh(),
        material: Property.material(),
        count: Property.int(14),
        life: Property.float(0.8),
        rise: Property.float(0.45),
        size: Property.float(0.05),
        spread: Property.float(0.03),
    };

    start() {
        this._p = [];
        for (let i = 0; i < this.count; ++i) {
            const o = this.engine.scene.addObject(this.object);
            o.addComponent(MeshComponent, {mesh: this.mesh, material: this.material});
            this._p.push({o, age: (i / this.count) * this.life, dx: 0, dz: 0, v: 1});
            this._respawn(this._p[i], true);
        }
    }

    _respawn(p, keepAge) {
        if (!keepAge) p.age = 0;
        p.dx = (Math.random() - 0.5) * this.spread * 2;
        p.dz = (Math.random() - 0.5) * this.spread * 2;
        p.v = 0.7 + Math.random() * 0.6;
    }

    update(dt) {
        if (!this._p) return;
        for (const p of this._p) {
            p.age += dt;
            if (p.age >= this.life) this._respawn(p, false);
            const t = p.age / this.life;
            const s = this.size * (1 - t) * (0.6 + 0.4 * p.v);
            p.o.setPositionLocal([p.dx * (1 + t), t * this.rise * this.life * p.v, p.dz * (1 + t)]);
            p.o.setScalingLocal([s, s * 1.5, s]);
        }
    }
}
