import { Vector3, Quaternion } from 'three';

// Solve each bone in world space, then undo the current parent rotation.
// Preserving the bind orientation avoids assumptions about glTF bone axes.
export class RobotRetargeter {
  constructor(root) {
    this.root = root;
    root.updateMatrixWorld(true);
    this.rootBindQ = root.getWorldQuaternion(new Quaternion());
    this.bind = new Map();
    root.traverse(b => {
      if (!b.isBone) return;
      const child = b.children.find(c => c.isBone);
      const q = b.getWorldQuaternion(new Quaternion());
      this.bind.set(b.name, { bone:b, local:b.quaternion.clone(), world:q,
        direction:child ? child.getWorldPosition(new Vector3()).sub(b.getWorldPosition(new Vector3())).normalize() : null });
    });
  }
  point(boneName, direction, alpha) {
    const bind = this.bind.get(boneName);
    if (!bind?.direction || direction.lengthSq() < .00001) return;
    const currentRootQ = this.root.getWorldQuaternion(new Quaternion());
    const deltaQ = currentRootQ.clone().multiply(this.rootBindQ.clone().invert());
    const restDir = bind.direction.clone().applyQuaternion(deltaQ);
    const restWorldQ = deltaQ.clone().multiply(bind.world);

    const desired = new Quaternion().setFromUnitVectors(restDir, direction.clone().normalize()).multiply(restWorldQ);
    const parent = bind.bone.parent.getWorldQuaternion(new Quaternion());
    const local = parent.invert().multiply(desired);
    bind.bone.quaternion.slerp(local, alpha);
    bind.bone.updateWorldMatrix(false, true);
  }
  reset(alpha=1) {
    for (const {bone,local} of this.bind.values()) bone.quaternion.slerp(local,alpha);
    this.root.updateMatrixWorld(true);
  }
  apply(points, dt, legs=false, mirror=false) {
    const alpha=1-Math.exp(-12*dt);
    const valid=(i)=>points[i] && (points[i].visibility??1)>.55;
    // Flip horizontal pose coordinates; arm sides are mapped independently below.
    const p=i=>new Vector3((mirror ? -1 : 1)*points[i].x,-points[i].y,-points[i].z);
    const segment=(name,a,b)=>{
      if(valid(a)&&valid(b)) this.point(name,p(b).sub(p(a)),alpha);
      else {const bind=this.bind.get(name);if(bind)bind.bone.quaternion.slerp(bind.local,alpha);}
    };
    if([11,12,23,24].every(valid)) {
      const up=p(11).add(p(12)).sub(p(23)).sub(p(24));
      this.point('chest',up,alpha);
    }
    const sides = mirror
      ? [['L',12,14,16,24,26,28],['R',11,13,15,23,25,27]]
      : [['L',11,13,15,23,25,27],['R',12,14,16,24,26,28]];
    for(const [side,shoulder,elbow,wrist,hip,knee,ankle] of sides) {
      segment('upper_arm'+side,shoulder,elbow);
      segment('forearm'+side,elbow,wrist);
      if(legs){segment('thigh'+side,hip,knee);segment('shin'+side,knee,ankle);}
      else for(const prefix of ['thigh','shin']) {const b=this.bind.get(prefix+side);if(b)b.bone.quaternion.slerp(b.local,alpha);}
    }
    this.root.updateMatrixWorld(true);
  }
  demo(time,dt) {
    this.reset(1-Math.exp(-7*dt));
    const lift=.45+.45*Math.sin(time*1.4);
    this.point('upper_armL',new Vector3(.8,.1+lift,0),.15);
    this.point('forearmL',new Vector3(.35,.9,Math.sin(time*3)*.15),.15);
    this.point('upper_armR',new Vector3(-.85,.2+lift*.6,0),.15);
    this.point('forearmR',new Vector3(-.5,.65,0),.15);
  }
  wave(time,dt) {
    this.reset(1-Math.exp(-7*dt));
    const waveSweep = Math.sin(time * 3.5) * 0.32;
    this.point('upper_armL', new Vector3(0.65, 0.75, 0.05), 0.18);
    this.point('forearmL', new Vector3(0.2 + waveSweep, 0.88, 0.12), 0.22);
    this.point('upper_armR', new Vector3(-0.45, -0.65, 0), 0.15);
    this.point('forearmR', new Vector3(-0.35, -0.65, 0.1), 0.15);
  }
}
